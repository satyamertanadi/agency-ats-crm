import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

/* Human review and the coaching loop.
 *
 * The assertions that carry the design: disagreeing with a finding leaves the finding exactly as it
 * was, a private management note is invisible to the consultant it is about while the FINDING never
 * is, and nobody can mark somebody else's coaching done on their behalf.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed review fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const CONSULTANT_MEMBER='40000000-0000-0000-0000-000000000003'
const CONSULTANT_USER='10000000-0000-0000-0000-000000000003'
const OWNER_USER='10000000-0000-0000-0000-000000000001'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})
const owner=createClient(url,anon,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})
const sourcer=createClient(url,anon,{auth:{persistSession:false}})

let interviewId=''
let runId=''
let consultantAssessment=''
let candidateAssessment=''
let findingId=''
let coreRubric=''
let jobRubric=''

const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

beforeAll(async()=>{
  const signIns=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
    sourcer.auth.signInWithPassword({email:'sourcer@northstar.local',password:'LocalTest!123'}),
  ])
  signIns.forEach((result)=>{if(result.error)throw result.error})
  const enabled=await service.from('organization_settings').update({interview_intelligence_enabled:true}).eq('organization_id',ORG)
  if(enabled.error)throw enabled.error

  const interview=await service.from('interviews').insert({
    organization_id:ORG,job_candidate_id:JOB_CANDIDATE,starts_at:'2026-12-01T09:00:00Z',ends_at:'2026-12-01T10:00:00Z',
    timezone:'UTC',status:'completed',organizer_member_id:CONSULTANT_MEMBER,created_by:CONSULTANT_USER,
  }).select('id').single()
  if(interview.error)throw interview.error
  interviewId=required(interview.data,'interview').id

  for(const type of ['core','job'] as const){
    const rubric=await service.from('interview_rubrics').insert({
      organization_id:ORG,rubric_type:type,job_id:type==='job'?'80000000-0000-0000-0000-000000000001':null,
      name:`review ${type}`,status:'draft',created_by:OWNER_USER,
    }).select('id').single()
    if(rubric.error)throw new Error(rubric.error.message)
    const id=required(rubric.data,'rubric').id
    await service.from('interview_rubric_items').insert({
      organization_id:ORG,rubric_id:id,dimension:'essential_coverage',item_type:'essential_question',
      label:'item',requirement_level:'must_have',sort_order:0,
    })
    await service.from('interview_rubrics').update({status:'active',activated_by:OWNER_USER,activated_at:new Date().toISOString()}).eq('id',id)
    if(type==='core')coreRubric=id;else jobRubric=id
  }

  const run=await service.from('interview_analysis_runs').insert({
    organization_id:ORG,interview_id:interviewId,job_candidate_id:JOB_CANDIDATE,
    core_rubric_id:coreRubric,job_rubric_id:jobRubric,
    provider:'anthropic',model:'test-model',prompt_version:'interview-analysis-v1',
    transcript_bundle_hash:'tb-review',rubric_bundle_hash:'rb',job_input_hash:'jb',
    candidate_input_hash:'cb',input_hash:'ih-review',status:'processing',
  }).select('id').single()
  if(run.error)throw new Error(run.error.message)
  runId=required(run.data,'run').id

  const persisted=await service.rpc('persist_interview_analysis',{
    p_run_id:runId,
    p_assessments:[
      {assessment_type:'candidate_fit',subject_candidate_id:CANDIDATE,subject_member_id:null,
        overall_band:'promising_but_incomplete',confidence:'medium',summary:'Commercial leadership evidenced.',findings:[]},
      {assessment_type:'consultant_quality',subject_candidate_id:null,subject_member_id:CONSULTANT_MEMBER,
        overall_band:'needs_development',confidence:'medium',summary:'Compensation never tested.',
        findings:[{category:'essential_coverage',result:'needs_development',score:1,severity:'attention',confidence:'high',
          title:'Compensation not raised',summary:'The interview closed without testing salary.',
          coaching_suggestion:'Ask for expected salary before describing the offer process.',rubric_item_id:null,evidence:[]}]},
    ],
    p_metrics:[],p_metric_summary:null,p_input_tokens:10,p_output_tokens:5,p_processing_ms:100,
  })
  if(persisted.error)throw new Error(persisted.error.message)

  const assessments=await service.from('interview_assessments').select('id,assessment_type').eq('analysis_run_id',runId)
  consultantAssessment=required(assessments.data?.find((row)=>row.assessment_type==='consultant_quality'),'consultant assessment').id
  candidateAssessment=required(assessments.data?.find((row)=>row.assessment_type==='candidate_fit'),'candidate assessment').id
  const finding=await service.from('interview_assessment_findings').select('id').eq('assessment_id',consultantAssessment).single()
  findingId=required(finding.data,'finding').id
})

afterAll(async()=>{
  if(runId)await service.from('interview_analysis_runs').delete().eq('id',runId)
  for(const id of [coreRubric,jobRubric])if(id)await service.from('interview_rubrics').delete().eq('id',id)
  if(interviewId)await service.from('interviews').delete().eq('id',interviewId)
  await service.from('organization_settings').update({interview_intelligence_enabled:false}).eq('organization_id',ORG)
})

describe('review sits alongside the machine output, never on top of it',()=>{
  it('records a disagreement and leaves the finding exactly as it was',async()=>{
    const before=await service.from('interview_assessment_findings').select('result,severity,title,summary').eq('id',findingId).single()

    const feedback=await owner.rpc('record_interview_feedback',{
      p_organization_id:ORG,p_assessment_id:consultantAssessment,p_feedback_type:'disagreed',
      p_finding_id:findingId,p_note:'Salary was covered in the pre-screen, not this call.',p_visibility:'subject_and_reviewers',
    })
    expect(feedback.error).toBeNull()

    const after=await service.from('interview_assessment_findings').select('result,severity,title,summary').eq('id',findingId).single()
    expect(after.data).toEqual(before.data)
  })

  it('cannot be rewritten or removed once recorded',async()=>{
    const row=await service.from('interview_assessment_feedback').select('id').eq('assessment_id',consultantAssessment).limit(1).single()
    const id=required(row.data,'feedback').id

    // No UPDATE or DELETE policy exists, so both see no row rather than raising.
    const edit=await owner.from('interview_assessment_feedback').update({note:'rewritten'}).eq('id',id).select('id')
    expect(edit.error).toBeNull()
    expect(edit.data).toEqual([])

    const erase=await owner.from('interview_assessment_feedback').delete().eq('id',id).select('id')
    expect(erase.error).toBeNull()
    expect(erase.data).toEqual([])
  })

  it('lets the assessed consultant add context but not a verdict on themselves',async()=>{
    const context=await consultant.rpc('record_interview_feedback',{
      p_organization_id:ORG,p_assessment_id:consultantAssessment,p_feedback_type:'consultant_context',
      p_finding_id:null,p_note:'The client ended the call fifteen minutes early.',p_visibility:'subject_and_reviewers',
    })
    expect(context.error).toBeNull()

    const verdict=await consultant.rpc('record_interview_feedback',{
      p_organization_id:ORG,p_assessment_id:consultantAssessment,p_feedback_type:'reviewed',
      p_finding_id:null,p_note:null,p_visibility:'subject_and_reviewers',
    })
    expect(verdict.error?.message).toContain('permission_denied')
  })

  it('refuses context from somebody the assessment is not about',async()=>{
    const foreign=await sourcer.rpc('record_interview_feedback',{
      p_organization_id:ORG,p_assessment_id:consultantAssessment,p_feedback_type:'consultant_context',
      p_finding_id:null,p_note:'Not my interview.',p_visibility:'subject_and_reviewers',
    })
    expect(foreign.error?.message).toContain('permission_denied')
  })
})

describe('a private management note hides the note, never the finding',()=>{
  it('keeps a reviewers_only note away from the consultant',async()=>{
    const note=await owner.rpc('record_interview_feedback',{
      p_organization_id:ORG,p_assessment_id:consultantAssessment,p_feedback_type:'discussed',
      p_finding_id:null,p_note:'Raise at the next one-to-one.',p_visibility:'reviewers_only',
    })
    expect(note.error).toBeNull()

    const asOwner=await owner.from('interview_assessment_feedback').select('id,visibility').eq('assessment_id',consultantAssessment)
    expect((asOwner.data||[]).some((row)=>row.visibility==='reviewers_only')).toBe(true)

    const asConsultant=await consultant.from('interview_assessment_feedback').select('id,visibility').eq('assessment_id',consultantAssessment)
    expect((asConsultant.data||[]).some((row)=>row.visibility==='reviewers_only')).toBe(false)
    // Their own context and the shared disagreement are still readable.
    expect((asConsultant.data||[]).length).toBeGreaterThan(0)
  })

  it('still shows the consultant the finding itself',async()=>{
    /* The invariant the visibility column must never be able to break: there is no hidden
     * owner-only assessment. */
    const finding=await consultant.from('interview_assessment_findings').select('id,title,severity').eq('id',findingId)
    expect(finding.data).toHaveLength(1)
    expect(finding.data?.[0].severity).toBe('attention')
  })

  it('refuses to file a consultant reply as a private note',async()=>{
    const sneaky=await service.from('interview_assessment_feedback').insert({
      organization_id:ORG,assessment_id:consultantAssessment,actor_member_id:CONSULTANT_MEMBER,
      feedback_type:'consultant_context',note:'hidden reply',visibility:'reviewers_only',
    })
    expect(sneaky.error).not.toBeNull()
  })
})

describe('coaching',()=>{
  let actionId=''

  it('refuses coaching on a candidate assessment',async()=>{
    const wrong=await owner.rpc('assign_interview_coaching',{
      p_organization_id:ORG,p_assessment_id:candidateAssessment,
      p_action_text:'Nobody to coach here.',p_finding_id:null,p_due_at:null,
    })
    expect(wrong.error?.message).toContain('coaching_requires_consultant_assessment')
  })

  it('refuses a consultant assigning coaching',async()=>{
    const denied=await consultant.rpc('assign_interview_coaching',{
      p_organization_id:ORG,p_assessment_id:consultantAssessment,
      p_action_text:'Self-assigned.',p_finding_id:null,p_due_at:null,
    })
    expect(denied.error?.message).toContain('permission_denied')
  })

  it('assigns to the consultant the assessment is about, not to a caller-supplied member',async()=>{
    const assigned=await owner.rpc('assign_interview_coaching',{
      p_organization_id:ORG,p_assessment_id:consultantAssessment,
      p_action_text:'Ask for expected salary before describing the offer process.',
      p_finding_id:findingId,p_due_at:null,
    })
    expect(assigned.error).toBeNull()
    actionId=assigned.data as string

    const stored=await service.from('interview_coaching_actions').select('assigned_to_member_id,status').eq('id',actionId).single()
    expect(stored.data?.assigned_to_member_id).toBe(CONSULTANT_MEMBER)
    expect(stored.data?.status).toBe('open')
  })

  it('is visible to the assignee and to reviewers, and to nobody else',async()=>{
    expect((await consultant.from('interview_coaching_actions').select('id').eq('id',actionId)).data).toHaveLength(1)
    expect((await owner.from('interview_coaching_actions').select('id').eq('id',actionId)).data).toHaveLength(1)
    // A colleague with candidate access sees no coaching about anyone else.
    expect((await sourcer.from('interview_coaching_actions').select('id').eq('id',actionId)).data).toEqual([])
  })

  it('separates seeing it from doing it',async()=>{
    // "I have seen this" and "I have done this" are different facts. A workflow recording only the
    // second cannot tell a manager whether silence means disagreement or an unread notification.
    const acknowledged=await consultant.rpc('respond_to_interview_coaching',{
      p_organization_id:ORG,p_action_id:actionId,p_outcome:'acknowledged',p_response:null,
    })
    expect(acknowledged.data).toBe('acknowledged')

    const midway=await service.from('interview_coaching_actions').select('status,acknowledged_at,completed_at').eq('id',actionId).single()
    expect(midway.data?.status).toBe('acknowledged')
    expect(midway.data?.acknowledged_at).not.toBeNull()
    expect(midway.data?.completed_at).toBeNull()
  })

  it('will not let a reviewer complete somebody else’s coaching for them',async()=>{
    const impostor=await owner.rpc('respond_to_interview_coaching',{
      p_organization_id:ORG,p_action_id:actionId,p_outcome:'completed',p_response:'Done on their behalf.',
    })
    expect(impostor.error?.message).toContain('permission_denied')
  })

  it('records completion with the consultant’s own reply',async()=>{
    const completed=await consultant.rpc('respond_to_interview_coaching',{
      p_organization_id:ORG,p_action_id:actionId,p_outcome:'completed',
      p_response:'Added it to my screening script.',
    })
    expect(completed.data).toBe('completed')

    const stored=await service.from('interview_coaching_actions').select('status,completed_at,consultant_response').eq('id',actionId).single()
    expect(stored.data?.status).toBe('completed')
    expect(stored.data?.consultant_response).toContain('screening script')
  })

  it('refuses to reopen a closed action',async()=>{
    const again=await consultant.rpc('respond_to_interview_coaching',{
      p_organization_id:ORG,p_action_id:actionId,p_outcome:'acknowledged',p_response:null,
    })
    expect(again.error?.message).toContain('coaching_action_closed')
  })
})

describe('attention queue and Today',()=>{
  it('drops a finding off the attention queue once it has been reviewed',async()=>{
    /* An alert that stays lit after somebody dealt with it trains people to ignore the list. */
    const before=await owner.rpc('get_interview_attention_queue',{p_organization_id:ORG,p_limit:50})
    expect(before.error).toBeNull()
    // The disagreement recorded earlier already counts as a reviewer verdict on this finding.
    expect((before.data as {finding_id:string}[]).some((row)=>row.finding_id===findingId)).toBe(false)
  })

  it('shows the queue to reviewers and not to a consultant',async()=>{
    const asConsultant=await consultant.rpc('get_interview_attention_queue',{p_organization_id:ORG,p_limit:50})
    expect(asConsultant.error).toBeNull()
    expect(asConsultant.data).toEqual([])
  })

  it('returns Today items in one bounded call, scoped per caller',async()=>{
    const asConsultant=await consultant.rpc('get_interview_today_items',{p_organization_id:ORG,p_limit:25})
    expect(asConsultant.error).toBeNull()
    const kinds=(asConsultant.data as {kind:string;audience:string}[]).map((row)=>row.audience)
    // A consultant never receives reviewer rows, whatever they ask for.
    expect(kinds.every((audience)=>audience==='consultant')).toBe(true)

    const asSourcer=await sourcer.rpc('get_interview_today_items',{p_organization_id:ORG,p_limit:25})
    expect(asSourcer.error).toBeNull()
    expect(asSourcer.data).toEqual([])
  })

  it('carries no transcript text or finding detail into Today',async()=>{
    const items=await owner.rpc('get_interview_today_items',{p_organization_id:ORG,p_limit:25})
    const serialized=JSON.stringify(items.data)
    expect(serialized).not.toContain('closed without testing salary')
    expect(serialized).not.toContain('Compensation not raised')
  })
})
