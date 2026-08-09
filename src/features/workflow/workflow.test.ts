import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe,expect,it} from 'vitest'
import {buildPipelineColumns,buildTodayWorkItems,columnKeyForStage,groupPipelineStages,phaseForStage,recommendedCandidateAction,resolveStageForColumn,type TodayConsent,type TodayFeedback} from './workflow'
import type {Interview,Job,Offer,Task} from '../../shared/types/domain'

const stage=(stage_key:string,stage_type='active')=>({id:stage_key,pipeline_id:'p1',name:stage_key,stage_key,stage_type,position:0,color:null,phase_key:null})

/* Legacy and imported pipelines can still hold several detailed stages inside one operating phase.
 * The simplified default is smaller, but those existing records must continue to render safely. */
const board=[
  stage('sourced'),stage('contacted'),stage('screening'),stage('shortlisted'),stage('assessment'),
  stage('submitted_to_client'),stage('client_reviewing'),stage('interview_scheduled'),
  stage('interview_completed'),stage('offer'),stage('placed','placed'),
  stage('rejected','rejected'),stage('on_hold','on_hold'),
]

describe('pipeline board columns',()=>{
  /* The regression guard. A candidate at interview_completed rendered in the Interview column while
   * the dropdown read "Sourcing", because the column and the <select> value were derived separately
   * and the options only held each phase's first stage id. Card and column must agree for EVERY
   * stage, not just the first of each phase. */
  it('renders every active stage under a phase whose key the card can display',()=>{
    const columns=buildPipelineColumns(board)
    const options=columns.map((column)=>column.key)
    for(const item of board.filter((entry)=>!['rejected','on_hold'].includes(entry.stage_type))){
      const key=columnKeyForStage(columns,item.id)
      expect(key,`${item.stage_key} belongs to no column`).toBeDefined()
      expect(options,`${item.stage_key} would display a foreign option`).toContain(key)
    }
  })

  it('keeps outcome stages off the board so they cannot become columns',()=>{
    expect(buildPipelineColumns(board).map((column)=>column.label)).toEqual(['Sourcing','Screening','Shortlist','Client review','Interview','Offer','Placed'])
    expect(columnKeyForStage(buildPipelineColumns(board),'rejected')).toBeUndefined()
  })

  it('enters a phase at its first stage but never demotes a candidate already inside it',()=>{
    const columns=buildPipelineColumns(board)
    // The demotion half of the bug: choosing "Interview" for someone already at interview_completed
    // used to send them back to interview_scheduled.
    expect(resolveStageForColumn(columns,'interview','interview_completed')).toBeNull()
    expect(resolveStageForColumn(columns,'interview','screening')).toBe('interview_scheduled')
    expect(resolveStageForColumn(columns,'sourcing','contacted')).toBeNull()
    expect(resolveStageForColumn(columns,'nonexistent','contacted')).toBeNull()
  })

})

/* The stage->phase mapping exists twice: once here in TS (keyPhase, read through phaseForStage) and
 * once in SQL, as the CASE inside assign_pipeline_phase(). Both are real -- the trigger stamps
 * phase_key on write, the TS resolves stages the trigger never saw -- but nothing makes them agree,
 * and they sit in different directories with no comment linking them.
 *
 * Drift here is not cosmetic: a stage the two disagree about lands in one column while resolving to
 * another phase, which is exactly the contradiction the board columns above exist to prevent. So the
 * SQL is the fixture: this reads the migration and holds the TS to it. */
describe('phase mapping parity with the database trigger',()=>{
  // Resolved from the vitest root rather than import.meta.url: this suite runs under jsdom, where
  // import.meta.url is an http:// URL and readFileSync rejects it.
  const sql=readFileSync(resolve(process.cwd(),'supabase/migrations/20260716090000_consultant_first_pipeline_phases.sql'),'utf8')
  const trigger=sql.slice(sql.indexOf('create or replace function public.assign_pipeline_phase()'))
  const body=trigger.slice(0,trigger.indexOf('end $$;'))

  it('maps every stage_key the trigger names to the same phase',()=>{
    // `when new.stage_key in ('a','b') then 'phase'` and `when new.stage_key='a' then 'phase'`.
    const clauses=[...body.matchAll(/when new\.stage_key\s*(?:in\s*\(([^)]*)\)|=\s*'([^']+)')\s*then\s*'([a-z_]+)'/g)]
    const fromSql=new Map<string,string>()
    for(const [,list,single,phase] of clauses){
      const keys=list?[...list.matchAll(/'([^']+)'/g)].map((match)=>match[1]!):[single!]
      for(const key of keys)fromSql.set(key,phase!)
    }
    // Guard the parser itself: if the migration is reformatted and this stops matching, an empty map
    // would vacuously pass and the drift test would be silently dead.
    expect(fromSql.size,'parsed no mappings out of the migration -- the regex has gone stale').toBeGreaterThanOrEqual(13)

    for(const [stageKey,phase] of fromSql){
      expect(phaseForStage({stage_key:stageKey,stage_type:'active',phase_key:null}),`${stageKey} disagrees with the SQL trigger`).toBe(phase)
    }
  })

  it('agrees that a placed stage_type is the placed phase regardless of its key',()=>{
    expect(body).toContain("new.stage_type='placed' then 'placed'")
    expect(phaseForStage({stage_key:'some_custom_key',stage_type:'placed',phase_key:null})).toBe('placed')
  })

  it('defers to a stored phase_key, as the trigger does when one is already set',()=>{
    expect(body).toContain('if new.phase_key is null then')
    expect(phaseForStage({stage_key:'sourced',stage_type:'active',phase_key:'offer'})).toBe('offer')
  })
})

describe('consultant workflow model',()=>{
  it('maps detailed stages to seven operating phases without losing unknown stages',()=>{
    expect(phaseForStage(stage('submitted_to_client'))).toBe('client_review')
    expect(phaseForStage(stage('custom_client_gate'))).toBe('other')
    expect(groupPipelineStages([stage('sourced'),stage('screening'),stage('offer')]).map((item)=>item.label)).toEqual(['Sourcing','Screening','Offer'])
  })

  it('recommends the next human-controlled milestone',()=>{
    expect(recommendedCandidateAction({stage:stage('shortlisted'),hasSubmission:false,interviews:[],offers:[],hasPlacement:false}).key).toBe('submit')
    expect(recommendedCandidateAction({stage:stage('offer'),hasSubmission:true,interviews:[],offers:[],hasPlacement:false}).key).toBe('record_offer')
  })

  it('describes a new offer without contradicting a withdrawn previous offer',()=>{
    const withdrawn={id:'o1',job_candidate_id:'jc1',salary:0,currency:'IDR',offered_at:'2026-07-14T10:00:00Z',start_date:null,status:'withdrawn' as const,notes:null}
    expect(recommendedCandidateAction({stage:stage('offer'),hasSubmission:true,interviews:[],offers:[withdrawn],hasPlacement:false})).toEqual({key:'record_offer',label:'Record a new offer',reason:'The previous offer was withdrawn. Record a new offer only when the candidate and client are ready.'})
  })

  it('ranks blocked work before overdue and recommended work',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),currentMemberId:'m1',jobs:[],tasks:[{id:'t1',title:'Call client',description:null,status:'open',priority:'normal',due_at:'2026-07-15T10:00:00Z',owner_member_id:'m1',created_at:'2026-07-14T10:00:00Z',task_links:[]}],offers:[],interviews:[{id:'i1',job_candidate_id:'jc1',interview_type:null,stage_label:null,starts_at:'2026-07-17T10:00:00Z',ends_at:'2026-07-17T11:00:00Z',timezone:'UTC',location:null,meeting_url:null,status:'scheduled',organizer_member_id:'m1',attendee_emails:[],create_google_meet:false,calendar_event_id:null,calendar_event_url:null,calendar_sync_status:'failed',calendar_last_error:'Reconnect Calendar',calendar_last_synced_at:null,calendar_retry_count:1,calendar_sync_version:1,calendar_synced_version:0}]})
    expect(items.map((item)=>item.kind)).toEqual(['blocked','overdue'])
  })

  it('surfaces failed delivery once even when its submission link is also expired',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],tasks:[],offers:[],interviews:[],deliveryIssues:[{id:'d1',status:'bounced',email_type:'client_submission',related_entity_id:'p1',error_message:'Mailbox rejected the message',updated_at:'2026-07-15T10:00:00Z'}],submissions:[{id:'p1',job_id:'j1',title:'Engineer shortlist',public_submission_links:[{id:'l1',expires_at:'2026-07-14T10:00:00Z',revoked_at:null}]}]})
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({kind:'blocked',title:'Resolve bounced delivery',href:'/app/northstar/jobs/j1'})
  })

  it('routes a failed cancellation notice back to one retry action on the candidate',()=>{
    const cancelled:Interview={id:'i1',job_candidate_id:'jc1',interview_type:null,stage_label:null,starts_at:'2026-07-15T10:00:00Z',ends_at:'2026-07-15T11:00:00Z',timezone:'UTC',location:null,meeting_url:null,status:'cancelled',organizer_member_id:'m1',attendee_emails:['one@example.com','two@example.com'],create_google_meet:false,calendar_event_id:null,calendar_event_url:null,calendar_sync_status:'cancelled',calendar_last_error:null,calendar_last_synced_at:null,calendar_retry_count:0,calendar_sync_version:1,calendar_synced_version:0,cancellation_delivery_issues:2,job_candidates:{jobs:{id:'j1',title:'Engineering Manager',owner_member_id:'m1'}}}
    const issues=[
      {id:'d1',status:'failed',email_type:'interview_cancellation',related_entity_id:'i1',error_message:'Mailbox rejected the message',updated_at:'2026-07-15T10:00:00Z'},
      {id:'d2',status:'pending',email_type:'interview_cancellation',related_entity_id:'i1',error_message:null,updated_at:'2026-07-15T10:01:00Z'},
    ]
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],tasks:[],offers:[],interviews:[cancelled],deliveryIssues:issues})
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({kind:'blocked',title:'Retry 2 cancellation notices',cta:'Retry notices',href:'/app/northstar/jobs/j1?candidate=jc1&action=retry_cancel'})
  })

  const task=(id:string,overrides:Partial<Task> ={}):Task=>({id,title:'Follow up on candidate availability',description:null,status:'open',priority:'normal',due_at:null,owner_member_id:null,created_at:'2026-07-14T10:00:00Z',task_links:[],...overrides})

  /* Regression guard for the second half of the repetition bug: fixing the six identical "assign an
   * owner" rows just exposed that a batch of follow-up tasks all share one task title too. The bold
   * title must be the thing that actually differs between rows -- the linked candidate/job/company --
   * not the generic task title every row in the batch shares. */
  it('leads a linked task with the candidate/job/company name, not the shared task title',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],offers:[],interviews:[],tasks:[
      task('t1',{task_links:[{candidate_id:'c1',company_id:null,contact_id:null,job_id:null,candidates:{full_name:'Aditya Nugroho'}}]}),
    ]})
    expect(items.map((item)=>item.title)).toEqual(['Aditya Nugroho'])
    expect(items.map((item)=>item.reason)).toEqual(['Follow up on candidate availability'])
  })

  /* The other half of the same repetition problem: once a batch shares one task title, N rows of it
   * drown the genuinely distinct actions. The differentiating name still leads -- it just leads each
   * row of the group list rather than N top-level rows. */
  it('collapses repeated linked tasks that share a title into one group',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],offers:[],interviews:[],tasks:[
      task('t1',{task_links:[{candidate_id:'c1',company_id:null,contact_id:null,job_id:null,candidates:{full_name:'Aditya Nugroho'}}]}),
      task('t2',{task_links:[{candidate_id:'c2',company_id:null,contact_id:null,job_id:null,candidates:{full_name:'Alya Maharani'}}]}),
    ]})
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({title:'Follow up on candidate availability · 2 records',groupNoun:'records'})
    expect(items[0]!.group?.map((entry)=>entry.label)).toEqual(['Aditya Nugroho','Alya Maharani'])
    expect(items[0]!.group?.map((entry)=>entry.href)).toEqual(['/app/northstar/candidates/c1','/app/northstar/candidates/c2'])
  })

  /* Urgency is not a label to merge across. An overdue follow-up hidden behind a disclosure with an
   * upcoming one is exactly the "queue that lies" failure the grouping is meant to relieve. */
  it('does not group the same task title across different urgencies',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],offers:[],interviews:[],tasks:[
      task('t1',{due_at:'2026-07-15T10:00:00Z',task_links:[{candidate_id:'c1',company_id:null,contact_id:null,job_id:null,candidates:{full_name:'Aditya Nugroho'}}]}),
      task('t2',{due_at:'2026-07-15T11:00:00Z',task_links:[{candidate_id:'c2',company_id:null,contact_id:null,job_id:null,candidates:{full_name:'Alya Maharani'}}]}),
      task('t3',{due_at:'2026-07-20T10:00:00Z',task_links:[{candidate_id:'c3',company_id:null,contact_id:null,job_id:null,candidates:{full_name:'Bagus Prakoso'}}]}),
    ]})
    expect(items.map((item)=>item.kind)).toEqual(['overdue','upcoming'])
    expect(items[0]!.group).toHaveLength(2)
    // The group keeps the sort position of its most urgent member rather than drifting down.
    expect(items[0]!.dueAt).toBe('2026-07-15T10:00:00Z')
    expect(items[1]!.group).toBeUndefined()
  })

  /* Untethered tasks have no record name to tell their rows apart, so collapsing them would produce
   * a disclosure listing the same string N times. */
  it('leaves unlinked tasks sharing a title ungrouped',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],offers:[],interviews:[],tasks:[task('t1'),task('t2')]})
    expect(items).toHaveLength(2)
    expect(items.every((item)=>item.group===undefined)).toBe(true)
  })

  it('falls back to the task title when a task has no linked record to differentiate it by',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],offers:[],interviews:[],tasks:[task('t1',{title:'Chase the finance invoice',description:'Awaiting sign-off.'})]})
    expect(items[0]).toMatchObject({title:'Chase the finance invoice',reason:'Awaiting sign-off.'})
  })

  it('leads an offer item with the candidate/job pairing, not the shared action label',()=>{
    const offer=(id:string,status:'presented'|'accepted',name:string):Offer=>({id,job_candidate_id:`jc-${id}`,salary:0,currency:'IDR',offered_at:'2026-07-14T10:00:00Z',start_date:null,status,notes:null,job_candidates:{candidates:{id:`c-${id}`,full_name:name},jobs:{id:'j1',title:'Engineering Manager',owner_member_id:null}}})
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],tasks:[],interviews:[],offers:[offer('o1','accepted','Aditya Nugroho'),offer('o2','accepted','Alya Maharani')]})
    expect(items.map((item)=>item.title)).toEqual(['Aditya Nugroho · Engineering Manager','Alya Maharani · Engineering Manager'])
    expect(items.every((item)=>item.reason==='The offer is accepted and the placement is not yet recorded.')).toBe(true)
  })

  it('dismisses an accepted-offer recommendation as soon as a placement exists',()=>{
    const accepted:Offer={id:'o1',job_candidate_id:'jc-o1',salary:0,currency:'IDR',offered_at:'2026-07-14T10:00:00Z',start_date:null,status:'accepted',notes:null,job_candidates:{candidates:{id:'c1',full_name:'Aditya Nugroho'},jobs:{id:'j1',title:'Engineering Manager',owner_member_id:null}}}
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],tasks:[],interviews:[],offers:[accepted],placements:[{job_candidate_id:'jc-o1',status:'confirmed'}]})
    expect(items).toEqual([])
  })

  it('emits at most one live offer recommendation per candidate/job pair',()=>{
    const make=(id:string,status:'presented'|'accepted'):Offer=>({id,job_candidate_id:'jc1',salary:0,currency:'IDR',offered_at:'2026-07-14T10:00:00Z',start_date:null,status,notes:null,job_candidates:{candidates:{id:'c1',full_name:'Aditya Nugroho'},jobs:{id:'j1',title:'Engineering Manager',owner_member_id:null}}})
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],tasks:[],interviews:[],offers:[make('accepted','accepted'),make('presented','presented')]})
    expect(items).toHaveLength(1)
    expect(items[0]!.cta).toBe('Create placement')
  })

  const openJob=(id:string,title:string):Job=>({id,organization_id:'org1',company_id:'c1',pipeline_id:null,title,location:null,priority:'normal',status:'open',currency:null,placement_fee_percentage:null,owner_member_id:null,opened_at:null,updated_at:'2026-07-14T10:00:00Z'})

  /* Regression guard for the Today dashboard bug: unowned jobs used to push one item each with a
   * verbatim-identical reason string, so six unowned jobs rendered six back-to-back rows saying the
   * exact same thing. A single unowned job must still render as a plain item (no group); 2+ must
   * collapse into one item whose `group` carries one entry per job. */
  it('renders a single unowned job as a plain item with no group',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[openJob('j1','Engineering Manager')],tasks:[],offers:[],interviews:[]})
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({kind:'blocked',title:'Assign an owner · Engineering Manager',href:'/app/northstar/jobs/j1?view=details'})
    expect(items[0]!.group).toBeUndefined()
  })

  it('collapses multiple unowned jobs into one item with a group entry per job',()=>{
    const jobs=[openJob('j1','Engineering Manager'),openJob('j2','Senior Product Manager'),openJob('j3','Plant Engineering Manager')]
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs,tasks:[],offers:[],interviews:[]})
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('blocked')
    expect(items[0]!.title).toBe('Assign an owner · 3 jobs')
    expect(items[0]!.group).toHaveLength(3)
    expect(items[0]!.group).toEqual(jobs.map((job)=>({label:job.title,href:`/app/northstar/jobs/${job.id}?view=details`,cta:'Assign owner'})))
  })

  it('ignores closed jobs and jobs that already have an owner when grouping',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[openJob('j1','Engineering Manager'),{...openJob('j2','Filled role'),status:'filled'},{...openJob('j3','Owned role'),owner_member_id:'m1'}],tasks:[],offers:[],interviews:[]})
    expect(items).toHaveLength(1)
    expect(items[0]!.group).toBeUndefined()
    expect(items[0]!.title).toBe('Assign an owner · Engineering Manager')
  })
})

describe('today work items · client feedback',()=>{
  const empty={base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],tasks:[],interviews:[],offers:[]}
  const feedback=(overrides:Partial<TodayFeedback>={}):TodayFeedback=>({
    id:'f1',decision:'interview',createdAt:'2026-07-16T08:00:00Z',jobCandidateId:'jc1',
    jobId:'j1',jobTitle:'Engineering Manager',jobOwnerMemberId:null,candidateName:'Aditya Nugroho',...overrides})

  /* Feedback arriving was the product's one genuinely invisible event: written to the table, rendered
   * on one panel, announced nowhere. */
  it('surfaces a client response as a today item pointing at the candidate it is about',()=>{
    const items=buildTodayWorkItems({...empty,feedback:[feedback()]})
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('today')
    expect(items[0]!.title).toBe('Aditya Nugroho · Engineering Manager')
    // The wording comes from the feedbackDecision map, so a Today row and the badge on arrival agree.
    expect(items[0]!.reason).toBe('Client responded: wants to interview.')
    expect(items[0]!.href).toBe('/app/northstar/jobs/j1?candidate=jc1')
  })

  it('keeps another consultant’s client response out of My work',()=>{
    const mine=feedback({id:'mine',jobOwnerMemberId:'m1'});const theirs=feedback({id:'theirs',jobOwnerMemberId:'m2'})
    const items=buildTodayWorkItems({...empty,currentMemberId:'m1',feedback:[mine,theirs]})
    expect(items.map((item)=>item.id)).toEqual(['feedback-mine'])
  })
})

describe('today work items · consent expiry',()=>{
  const empty={base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],tasks:[],interviews:[],offers:[]}
  const consent=(overrides:Partial<TodayConsent>={}):TodayConsent=>({
    candidateId:'c1',fullName:'Alya Maharani',expiresAt:'2026-07-26T10:00:00Z',status:'active',ownerMemberId:null,...overrides})

  it('warns ahead of the date and escalates as it arrives',()=>{
    const far=buildTodayWorkItems({...empty,consentExpiring:[consent()]})
    expect(far[0]!.kind).toBe('upcoming')
    expect(far[0]!.reason).toBe('Consent expires in 10 days.')
    const near=buildTodayWorkItems({...empty,consentExpiring:[consent({expiresAt:'2026-07-18T10:00:00Z'})]})
    expect(near[0]!.kind).toBe('today')
    expect(near[0]!.reason).toBe('Consent expires in 2 days.')
  })

  /* Expired is 'blocked' rather than merely late because a submission genuinely cannot happen -- which
   * is the whole reason this item exists rather than being left to whoever opens the record. */
  it('treats already-expired consent as blocking, because submission is',()=>{
    const items=buildTodayWorkItems({...empty,consentExpiring:[consent({expiresAt:'2026-07-14T10:00:00Z'})]})
    expect(items[0]!.kind).toBe('blocked')
    expect(items[0]!.reason).toContain('cannot be sent to a client')
  })

  it('says nothing about candidates nobody is going to submit',()=>{
    const items=buildTodayWorkItems({...empty,consentExpiring:[consent({status:'archived'}),consent({candidateId:'c2',status:'do_not_contact'})]})
    expect(items).toEqual([])
  })
})
