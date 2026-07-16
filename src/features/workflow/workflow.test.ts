import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe,expect,it} from 'vitest'
import {buildPipelineColumns,buildTodayWorkItems,columnKeyForStage,groupPipelineStages,phaseForStage,recommendedCandidateAction,resolveStageForColumn} from './workflow'

const stage=(stage_key:string,stage_type='active')=>({id:stage_key,pipeline_id:'p1',name:stage_key,stage_key,stage_type,position:0,color:null,phase_key:null})

/* The seed's default board (supabase/seed.sql:55-60): several phases hold more than one stage, which
 * is the precondition for the bug the invariant below guards. */
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
  it.each([false,true])('renders every stage under a column whose key the card can display (detailed=%s)',(detailed)=>{
    const columns=buildPipelineColumns(board,detailed)
    const options=columns.map((column)=>column.key)
    for(const item of board.filter((entry)=>!['rejected','on_hold'].includes(entry.stage_type))){
      const key=columnKeyForStage(columns,item.id)
      expect(key,`${item.stage_key} belongs to no column`).toBeDefined()
      expect(options,`${item.stage_key} would display a foreign option`).toContain(key)
    }
  })

  it('keeps outcome stages off the board so they cannot become columns',()=>{
    expect(buildPipelineColumns(board,false).map((column)=>column.label)).toEqual(['Sourcing','Screening','Shortlist','Client review','Interview','Offer','Placed'])
    expect(columnKeyForStage(buildPipelineColumns(board,false),'rejected')).toBeUndefined()
  })

  it('enters a phase at its first stage but never demotes a candidate already inside it',()=>{
    const columns=buildPipelineColumns(board,false)
    // The demotion half of the bug: choosing "Interview" for someone already at interview_completed
    // used to send them back to interview_scheduled.
    expect(resolveStageForColumn(columns,'interview','interview_completed')).toBeNull()
    expect(resolveStageForColumn(columns,'interview','screening')).toBe('interview_scheduled')
    expect(resolveStageForColumn(columns,'sourcing','contacted')).toBeNull()
    expect(resolveStageForColumn(columns,'nonexistent','contacted')).toBeNull()
  })

  it('moves between individual stages when detailed stages are shown',()=>{
    const columns=buildPipelineColumns(board,true)
    expect(resolveStageForColumn(columns,'interview_completed','interview_scheduled')).toBe('interview_completed')
    expect(resolveStageForColumn(columns,'interview_scheduled','interview_scheduled')).toBeNull()
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

  it('ranks blocked work before overdue and recommended work',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),currentMemberId:'m1',jobs:[],tasks:[{id:'t1',title:'Call client',description:null,status:'open',priority:'normal',due_at:'2026-07-15T10:00:00Z',owner_member_id:'m1',created_at:'2026-07-14T10:00:00Z',task_links:[]}],offers:[],interviews:[{id:'i1',job_candidate_id:'jc1',interview_type:null,stage_label:null,starts_at:'2026-07-17T10:00:00Z',ends_at:'2026-07-17T11:00:00Z',timezone:'UTC',location:null,meeting_url:null,status:'scheduled',organizer_member_id:'m1',attendee_emails:[],create_google_meet:false,calendar_event_id:null,calendar_event_url:null,calendar_sync_status:'failed',calendar_last_error:'Reconnect Calendar',calendar_last_synced_at:null,calendar_retry_count:1,calendar_sync_version:1,calendar_synced_version:0}]})
    expect(items.map((item)=>item.kind)).toEqual(['blocked','overdue'])
  })

  it('surfaces failed delivery once even when its submission link is also expired',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],tasks:[],offers:[],interviews:[],deliveryIssues:[{id:'d1',status:'bounced',email_type:'client_submission',related_entity_id:'p1',error_message:'Mailbox rejected the message',updated_at:'2026-07-15T10:00:00Z'}],submissions:[{id:'p1',job_id:'j1',title:'Engineer shortlist',public_submission_links:[{id:'l1',expires_at:'2026-07-14T10:00:00Z',revoked_at:null}]}]})
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({kind:'blocked',title:'Resolve bounced delivery',href:'/app/northstar/jobs/j1'})
  })
})
