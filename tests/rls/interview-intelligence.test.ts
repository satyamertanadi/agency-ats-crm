import { createClient } from '@supabase/supabase-js'
import { beforeAll,describe,expect,it } from 'vitest'

/* The reason interview_coaching_reviews is a separate table rather than a column on
 * interview_ai_notes: a consultant can read everything about their own interview EXCEPT the AI's
 * review of how they conducted it. If that boundary is wrong, the feature is worse than not shipping
 * it -- so it is asserted from the client side, against real policies, not inferred from the grant.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; RLS tests must not silently skip.')

const northstar='30000000-0000-0000-0000-000000000001'
const interviewId='82000000-0000-0000-0000-000000000001'
const transcriptId='83000000-0000-0000-0000-000000000001'
const notesId='85000000-0000-0000-0000-000000000001'

const owner=createClient(url,anon,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})
const manager=createClient(url,anon,{auth:{persistSession:false}})
const readonly=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})

beforeAll(async()=>{
  const results=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
    manager.auth.signInWithPassword({email:'manager@northstar.local',password:'LocalTest!123'}),
    readonly.auth.signInWithPassword({email:'readonly@northstar.local',password:'LocalTest!123'}),
    rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'}),
  ])
  const failure=results.find((result)=>result.error)
  if(failure?.error)throw failure.error
})

describe('coaching review visibility',()=>{
  it('lets a consultant read the transcript and the notes for their own interview',async()=>{
    const [transcript,notes]=await Promise.all([
      consultant.from('interview_transcripts').select('id,status').eq('interview_id',interviewId),
      consultant.from('interview_ai_notes').select('id,status').eq('interview_id',interviewId),
    ])
    expect(transcript.error).toBeNull()
    expect(transcript.data?.map((row)=>row.id)).toEqual([transcriptId])
    expect(notes.error).toBeNull()
    expect(notes.data?.map((row)=>row.id)).toEqual([notesId])
  })

  it('returns no coaching review to the consultant who was reviewed',async()=>{
    const result=await consultant.from('interview_coaching_reviews').select('id,rubric').eq('interview_id',interviewId)
    // RLS filters rather than errors, which is what lets the UI omit the section silently.
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it('returns the coaching review to the workspace owner',async()=>{
    const result=await owner.from('interview_coaching_reviews').select('id,subject_member_id,rating_summary').eq('interview_id',interviewId)
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1)
    expect(result.data?.[0]?.subject_member_id).toBe('40000000-0000-0000-0000-000000000003')
  })

  /* The two role branches that would have leaked these reviews without the amendment in
   * 20260731000000: 'manager' takes every permission except an explicit deny-list, and 'readonly'
   * takes every key matching '%.read'. */
  it('withholds the permission from managers and read-only users',async()=>{
    const [managerCheck,readonlyCheck,ownerCheck]=await Promise.all([
      manager.rpc('has_permission',{p_organization_id:northstar,p_permission:'interview_coaching.read'}),
      readonly.rpc('has_permission',{p_organization_id:northstar,p_permission:'interview_coaching.read'}),
      owner.rpc('has_permission',{p_organization_id:northstar,p_permission:'interview_coaching.read'}),
    ])
    expect([managerCheck.data,readonlyCheck.data,ownerCheck.data]).toEqual([false,false,true])
  })

  it('returns nothing to a manager who can otherwise read the interview',async()=>{
    const [notes,coaching]=await Promise.all([
      manager.from('interview_ai_notes').select('id').eq('interview_id',interviewId),
      manager.from('interview_coaching_reviews').select('id').eq('interview_id',interviewId),
    ])
    expect(notes.data?.map((row)=>row.id)).toEqual([notesId])
    expect(coaching.data).toEqual([])
  })
})

describe('tenant isolation and forgery',()=>{
  it('never returns another organization\'s interview intelligence',async()=>{
    const [transcripts,notes,coaching]=await Promise.all([
      rival.from('interview_transcripts').select('id').eq('organization_id',northstar),
      rival.from('interview_ai_notes').select('id').eq('organization_id',northstar),
      rival.from('interview_coaching_reviews').select('id').eq('organization_id',northstar),
    ])
    expect([transcripts.data,notes.data,coaching.data]).toEqual([[],[],[]])
  })

  /* All three tables are service-written. A consultant who could insert one could fabricate a
   * transcript, a requirement match, or a favourable review of their own interviewing. */
  it('refuses direct writes from authenticated clients',async()=>{
    const [transcript,notes,coaching]=await Promise.all([
      consultant.from('interview_transcripts').insert({organization_id:northstar,interview_id:interviewId,status:'ready'}),
      consultant.from('interview_ai_notes').insert({organization_id:northstar,interview_id:interviewId,interview_transcript_id:transcriptId,ai_evaluation_id:'84000000-0000-0000-0000-000000000001',prompt_version:'forged',generated_content:{},input_hash:'forged'}),
      consultant.from('interview_coaching_reviews').insert({organization_id:northstar,interview_id:interviewId,interview_ai_notes_id:notesId,rubric:[]}),
    ])
    expect(transcript.error).not.toBeNull()
    expect(notes.error).not.toBeNull()
    expect(coaching.error).not.toBeNull()
  })

  it('refuses to update an existing transcript or coaching review',async()=>{
    const transcript=await consultant.from('interview_transcripts').update({plain_text:'rewritten'}).eq('id',transcriptId).select('id')
    expect(transcript.data??[]).toEqual([])
    const coaching=await owner.from('interview_coaching_reviews').update({rating_summary:{index:100}}).eq('interview_id',interviewId).select('id')
    expect(coaching.data??[]).toEqual([])
  })

  it('keeps the interview AI spend aggregate service_role-only',async()=>{
    const result=await owner.rpc('interview_notes_token_spend_this_month',{p_organization_id:northstar})
    expect(result.error?.code).toBe('42501')
  })
})

/* Runs last: accepting is a real state change on the seeded row, and accept_interview_notes is
 * idempotent only in the sense that a second call returns the same id without re-writing. */
describe('accepting a draft',()=>{
  const reviewed={
    summary:{headline:'Edited headline the consultant wrote.',key_points:['Kept.'],topics_covered:[],candidate_stated_facts:[],
      logistics:{notice_period:'',salary_expectation:'',location_preference:'',availability:''}},
    // Tampered on purpose: the RPC must restore the generated evidence over whatever is sent here.
    candidate_assessment:{requirement_evidence:[{requirement:'invented',classification:'matched',quote:'never said',explanation:'forged'}],
      strengths:[],concerns:[],open_questions:[],recommendation_note:''},
    consultant_assessment:{rubric:[],missed_topics:[]},
  }

  it('refuses a caller from another organization',async()=>{
    const result=await rival.rpc('accept_interview_notes',{p_organization_id:northstar,p_interview_notes_id:notesId,p_reviewed_content:reviewed})
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain('permission_denied')
  })

  it('refuses content with no summary headline',async()=>{
    const result=await consultant.rpc('accept_interview_notes',{p_organization_id:northstar,p_interview_notes_id:notesId,
      p_reviewed_content:{...reviewed,summary:{...reviewed.summary,headline:''}}})
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain('invalid_interview_notes_content')
  })

  it('accepts the edit, re-pins the evidence, and mirrors the headline onto the interview',async()=>{
    const accepted=await consultant.rpc('accept_interview_notes',{p_organization_id:northstar,p_interview_notes_id:notesId,p_reviewed_content:reviewed})
    expect(accepted.error).toBeNull()
    expect(accepted.data).toBe(notesId)

    const row=await consultant.from('interview_ai_notes').select('status,reviewed_content,accepted_at').eq('id',notesId).single()
    expect(row.error).toBeNull()
    expect(row.data?.status).toBe('accepted')
    expect(row.data?.accepted_at).not.toBeNull()
    const content=row.data?.reviewed_content as {summary:{headline:string};candidate_assessment:{requirement_evidence:{requirement:string}[]}}
    expect(content.summary.headline).toBe(reviewed.summary.headline)
    // The consultant's wording survives; the model's findings do not get rewritten by it.
    expect(content.candidate_assessment.requirement_evidence.map((item)=>item.requirement)).toEqual(['regional team leadership'])

    const interview=await consultant.from('interviews').select('notes').eq('id',interviewId).single()
    expect(interview.data?.notes).toBe(reviewed.summary.headline)
  })

  it('is a no-op on a second call rather than an error',async()=>{
    const again=await consultant.rpc('accept_interview_notes',{p_organization_id:northstar,p_interview_notes_id:notesId,
      p_reviewed_content:{...reviewed,summary:{...reviewed.summary,headline:'Second attempt.'}}})
    expect(again.error).toBeNull()
    const row=await consultant.from('interview_ai_notes').select('reviewed_content').eq('id',notesId).single()
    expect((row.data?.reviewed_content as {summary:{headline:string}}).summary.headline).toBe(reviewed.summary.headline)
  })
})
