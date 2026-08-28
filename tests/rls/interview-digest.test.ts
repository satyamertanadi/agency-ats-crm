import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest'

/* Release B2: the daily owner brief.
 *
 * Three things this file exists to prove. That a workspace cannot be sent two copies of the same
 * brief, because the sweep runs hourly and a duplicate is the failure everyone notices. That the
 * catch-up window is bounded, so a workspace switched on after a quiet month does not wake up and
 * mail four hundred interviews. And that the payload is counts and fixed vocabulary only -- an email
 * is forwarded, stored unencrypted and read by whoever picks up the phone.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anonKey=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anonKey)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed digest fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const OWNER_USER='10000000-0000-0000-0000-000000000001'
const OWNER_MEMBER='40000000-0000-0000-0000-000000000001'
const CONSULTANT_MEMBER='40000000-0000-0000-0000-000000000003'
const CONSULTANT_USER='10000000-0000-0000-0000-000000000003'
const SOURCER_MEMBER='40000000-0000-0000-0000-000000000004'
const PASSWORD='LocalTest!123'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})
const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

let coreRubric=''
let jobRubric=''
const createdInterviews:string[]=[]

async function signIn(email:string){
  const client=createClient(url,anonKey,{auth:{persistSession:false}})
  const {error}=await client.auth.signInWithPassword({email,password:PASSWORD})
  if(error)throw new Error(`${email}: ${error.message}`)
  return client
}

/* One analysed interview whose run COMPLETED at a chosen moment, because the digest window is
 * measured on completion: a brief is about what finished since the last brief. */
async function seedCompletedAnalysis(completedAt:string,options:{severity?:string;candidateBand?:string}={}){
  const {severity='attention',candidateBand='promising_but_incomplete'}=options
  const interview=await service.from('interviews').insert({
    organization_id:ORG,job_candidate_id:JOB_CANDIDATE,
    starts_at:'2027-07-01T09:00:00Z',ends_at:'2027-07-01T10:00:00Z',
    timezone:'UTC',status:'completed',organizer_member_id:CONSULTANT_MEMBER,created_by:CONSULTANT_USER,
  }).select('id').single()
  if(interview.error)throw new Error(interview.error.message)
  const interviewId=required(interview.data,'interview').id
  createdInterviews.push(interviewId)

  const run=await service.from('interview_analysis_runs').insert({
    organization_id:ORG,interview_id:interviewId,job_candidate_id:JOB_CANDIDATE,
    core_rubric_id:coreRubric,job_rubric_id:jobRubric,
    provider:'anthropic',model:'test-model',prompt_version:'interview-analysis-v1',
    transcript_bundle_hash:`tb-${interviewId}`,rubric_bundle_hash:'rb',job_input_hash:'jb',
    candidate_input_hash:'cb',input_hash:`ih-${interviewId}`,
    status:'completed',completed_at:completedAt,requested_by:CONSULTANT_USER,
  }).select('id').single()
  if(run.error)throw new Error(run.error.message)
  const runId=required(run.data,'run').id

  const consultant=await service.from('interview_assessments').insert({
    organization_id:ORG,analysis_run_id:runId,interview_id:interviewId,assessment_type:'consultant_quality',
    subject_member_id:CONSULTANT_MEMBER,overall_band:'effective',confidence:'medium',
    summary:'A model-authored sentence that must never reach an inbox.',
  }).select('id').single()
  if(consultant.error)throw new Error(consultant.error.message)

  await service.from('interview_assessment_findings').insert({
    organization_id:ORG,assessment_id:required(consultant.data,'assessment').id,
    category:'listening_balance',result:'needs_development',score:1,severity,confidence:'medium',
    title:'Interrupted the candidate repeatedly',
    summary:'Another model-authored sentence about a named colleague.',sort_order:0,
  })

  await service.from('interview_assessments').insert({
    organization_id:ORG,analysis_run_id:runId,interview_id:interviewId,assessment_type:'candidate_fit',
    subject_candidate_id:CANDIDATE,overall_band:candidateBand,confidence:'medium',
    summary:'Candidate fit summary, also model-authored.',
  })
  return {interviewId,runId}
}

const setSettings=(patch:Record<string,unknown>)=>
  service.from('organization_settings').update(patch).eq('organization_id',ORG)

beforeAll(async()=>{
  for(const type of ['core','job'] as const){
    const rubric=await service.from('interview_rubrics').insert({
      organization_id:ORG,rubric_type:type,job_id:type==='job'?JOB:null,
      name:`digest ${type}`,status:'draft',created_by:OWNER_USER,
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
})

beforeEach(async()=>{
  await service.from('interview_digest_runs').delete().eq('organization_id',ORG)
  await service.from('interview_digest_recipients').delete().eq('organization_id',ORG)
  await setSettings({
    interview_intelligence_enabled:true,interview_digest_enabled:true,
    interview_digest_local_time:'00:00',interview_digest_skip_empty:true,
    interview_digest_last_success_at:null,
  })
})

afterAll(async()=>{
  await service.from('interview_digest_runs').delete().eq('organization_id',ORG)
  await service.from('interview_digest_recipients').delete().eq('organization_id',ORG)
  for(const id of createdInterviews)await service.from('interviews').delete().eq('id',id)
  for(const id of [coreRubric,jobRubric])if(id)await service.from('interview_rubrics').delete().eq('id',id)
  await setSettings({
    interview_intelligence_enabled:false,interview_digest_enabled:false,
    interview_digest_local_time:'17:30',interview_digest_last_success_at:null,
  })
})

const claim=()=>service.rpc('claim_interview_digest_run',{p_organization_id:ORG})
interface Claim {claimed:boolean;reason?:string;run_id?:string;range_started_at?:string;recipient_count?:number}

describe('whether a brief is due at all',()=>{
  it('does nothing for a workspace that never switched it on',async()=>{
    /* Disabled by default is the shipped state, and it is the one that must not need a recipient
     * list to be safe. */
    await setSettings({interview_digest_enabled:false})
    const result=await claim()
    expect((result.data as Claim).claimed).toBe(false)
    expect((result.data as Claim).reason).toBe('digest_disabled')
  })

  it('does nothing before the workspace-local send time',async()=>{
    /* A brief that arrives at 03:00 local is not a brief. The comparison is against the workspace
     * timezone, never the server's. */
    await setSettings({interview_digest_local_time:'23:59'})
    expect((await claim()).data).toMatchObject({claimed:false,reason:'not_due_yet'})
  })

  it('does nothing when nobody has been named as a recipient',async()=>{
    expect((await claim()).data).toMatchObject({claimed:false,reason:'no_recipients'})
  })

  it('claims once and refuses every later attempt on the same report date',async()=>{
    /* The sweep runs hourly, so this is the assertion that stops a workspace receiving the same brief
     * five times before midnight. */
    const recipient=await service.from('interview_digest_recipients').insert({organization_id:ORG,member_id:OWNER_MEMBER})
    if(recipient.error)throw new Error(recipient.error.message)

    const first=(await claim()).data as Claim
    expect(first.claimed).toBe(true)
    expect(first.recipient_count).toBe(1)

    const second=(await claim()).data as Claim
    expect(second.claimed).toBe(false)
    expect(second.reason).toBe('already_sent_today')

    const runs=await service.from('interview_digest_runs').select('id').eq('organization_id',ORG)
    expect(runs.data).toHaveLength(1)
  })
})

describe('the aggregation window',()=>{
  beforeEach(async()=>{
    await service.from('interview_digest_recipients').insert({organization_id:ORG,member_id:OWNER_MEMBER})
  })

  it('never looks back further than the 36-hour cap',async()=>{
    /* A workspace switched on after a quiet month must not wake up and mail four hundred interviews.
     * What falls outside the cap is not lost -- it is in the Scorecard, where a month of history
     * belongs. */
    await setSettings({interview_digest_last_success_at:'2020-01-01T00:00:00Z'})
    const claimed=(await claim()).data as Claim
    expect(claimed.claimed).toBe(true)
    const startedAt=new Date(required(claimed.range_started_at,'range start')).getTime()
    const hoursBack=(Date.now()-startedAt)/3_600_000
    expect(hoursBack).toBeLessThanOrEqual(36.5)
    expect(hoursBack).toBeGreaterThan(35.5)
  })

  it('resumes from the last successful brief when that is recent',async()=>{
    const since=new Date(Date.now()-2*3_600_000).toISOString()
    await setSettings({interview_digest_last_success_at:since})
    const claimed=(await claim()).data as Claim
    const startedAt=new Date(required(claimed.range_started_at,'range start')).getTime()
    expect(Math.abs(startedAt-new Date(since).getTime())).toBeLessThan(2000)
  })

  it('advances the window on a skipped-empty brief, not only on a sent one',async()=>{
    /* Otherwise a quiet Sunday silently widens Monday's window, which the 36-hour cap then truncates
     * -- costing real coverage on the day it matters. */
    const claimed=(await claim()).data as Claim
    await service.rpc('finalize_interview_digest_run',{
      p_run_id:required(claimed.run_id,'run'),p_status:'skipped_empty',p_content:{analysed_interviews:0},
    })
    const settings=await service.from('organization_settings')
      .select('interview_digest_last_success_at').eq('organization_id',ORG).single()
    expect(required(settings.data,'settings').interview_digest_last_success_at).not.toBeNull()
  })

  it('does not advance the window when the brief failed',async()=>{
    /* A failed send must leave the period unreported, so tomorrow's brief still covers it. */
    const claimed=(await claim()).data as Claim
    await service.rpc('finalize_interview_digest_run',{
      p_run_id:required(claimed.run_id,'run'),p_status:'failed',p_content:null,p_error_message:'provider_down',
    })
    const settings=await service.from('organization_settings')
      .select('interview_digest_last_success_at').eq('organization_id',ORG).single()
    expect(required(settings.data,'settings').interview_digest_last_success_at).toBeNull()
  })

  it('refuses a status outside the three real outcomes',async()=>{
    const claimed=(await claim()).data as Claim
    const result=await service.rpc('finalize_interview_digest_run',{
      p_run_id:required(claimed.run_id,'run'),p_status:'delivered',
    })
    expect(result.error?.message).toContain('invalid_digest_status')
  })
})

describe('what the brief contains',()=>{
  it('counts what completed inside the window and nothing outside it',async()=>{
    const now=Date.now()
    await seedCompletedAnalysis(new Date(now-3_600_000).toISOString())
    await seedCompletedAnalysis(new Date(now-10*24*3_600_000).toISOString())

    const built=await service.rpc('build_interview_digest_content',{
      p_organization_id:ORG,
      p_from:new Date(now-6*3_600_000).toISOString(),
      p_to:new Date(now+60_000).toISOString(),
    })
    expect(built.error).toBeNull()
    const content=built.data as {analysed_interviews:number;attention_findings:number}
    expect(content.analysed_interviews).toBe(1)
    expect(content.attention_findings).toBe(1)
  })

  it('carries no transcript text, model sentence, candidate name or contact detail',async()=>{
    /* The assertion this release turns on. Every seeded assessment above contains a model-authored
     * sentence and a finding title precisely so this test can prove neither reaches the payload. */
    const now=Date.now()
    await seedCompletedAnalysis(new Date(now-3_600_000).toISOString())

    const built=await service.rpc('build_interview_digest_content',{
      p_organization_id:ORG,
      p_from:new Date(now-6*3_600_000).toISOString(),
      p_to:new Date(now+60_000).toISOString(),
    })
    const raw=JSON.stringify(built.data)
    expect(raw).not.toMatch(/model-authored/i)
    expect(raw).not.toMatch(/Interrupted the candidate/i)
    expect(raw).not.toMatch(/@/)
    // Only counts, a fixed dimension vocabulary and band names.
    expect(raw).not.toMatch(/summary|title|excerpt|transcript/i)
  })

  it('reports themes as dimensions rather than as finding titles',async()=>{
    const now=Date.now()
    await seedCompletedAnalysis(new Date(now-3_600_000).toISOString())
    const built=await service.rpc('build_interview_digest_content',{
      p_organization_id:ORG,
      p_from:new Date(now-6*3_600_000).toISOString(),
      p_to:new Date(now+60_000).toISOString(),
    })
    const content=built.data as {themes:{dimension:string;interviews:number}[]}
    expect(content.themes.map((theme)=>theme.dimension)).toContain('listening_balance')
  })

  it('reports candidate outcomes as a band histogram with no candidate attached',async()=>{
    const now=Date.now()
    await seedCompletedAnalysis(new Date(now-3_600_000).toISOString(),{candidateBand:'material_concerns'})
    const built=await service.rpc('build_interview_digest_content',{
      p_organization_id:ORG,
      p_from:new Date(now-6*3_600_000).toISOString(),
      p_to:new Date(now+60_000).toISOString(),
    })
    const content=built.data as {candidate_fit:{band:string;interviews:number}[]}
    expect(content.candidate_fit.some((entry)=>entry.band==='material_concerns')).toBe(true)
    expect(JSON.stringify(content.candidate_fit)).not.toContain(CANDIDATE)
  })
})

describe('who may manage and read the brief',()=>{
  it('refuses recipient management to somebody who cannot configure the feature',async()=>{
    const consultant=await signIn('consultant@northstar.local')
    const result=await consultant.rpc('add_interview_digest_recipient',{
      p_organization_id:ORG,p_member_id:CONSULTANT_MEMBER,
    })
    expect(result.error?.message).toContain('permission_denied')
  })

  it('refuses an inactive member as a recipient',async()=>{
    /* Otherwise somebody keeps receiving the desk's summary after leaving the desk. */
    const owner=await signIn('owner@northstar.local')
    // 'suspended', not 'inactive': organization_members.status is ('invited','active','suspended'),
    // and an unchecked update to a value the constraint rejects leaves the member active -- so the
    // test would pass or fail on its own setup rather than on the rule it exists to prove.
    const suspended=await service.from('organization_members').update({status:'suspended'}).eq('id',SOURCER_MEMBER)
    if(suspended.error)throw new Error(suspended.error.message)
    const result=await owner.rpc('add_interview_digest_recipient',{p_organization_id:ORG,p_member_id:SOURCER_MEMBER})
    const restored=await service.from('organization_members').update({status:'active'}).eq('id',SOURCER_MEMBER)
    if(restored.error)throw new Error(restored.error.message)
    expect(result.error?.message).toContain('member_not_active')
  })

  it('adds the same recipient once however often the owner clicks',async()=>{
    const owner=await signIn('owner@northstar.local')
    await owner.rpc('add_interview_digest_recipient',{p_organization_id:ORG,p_member_id:CONSULTANT_MEMBER})
    await owner.rpc('add_interview_digest_recipient',{p_organization_id:ORG,p_member_id:CONSULTANT_MEMBER})
    const rows=await service.from('interview_digest_recipients').select('id').eq('organization_id',ORG)
    expect(rows.data).toHaveLength(1)
  })

  it('lets a recipient see that they are on the list without asking the owner',async()=>{
    const owner=await signIn('owner@northstar.local')
    await owner.rpc('add_interview_digest_recipient',{p_organization_id:ORG,p_member_id:CONSULTANT_MEMBER})
    const consultant=await signIn('consultant@northstar.local')
    const rows=await consultant.from('interview_digest_recipients').select('id').eq('organization_id',ORG)
    expect(rows.data).toHaveLength(1)
  })

  it('hides past briefs from somebody who is neither a configurer nor a recipient',async()=>{
    await service.from('interview_digest_runs').insert({
      organization_id:ORG,local_report_date:'2027-07-02',
      range_started_at:'2027-07-01T00:00:00Z',range_ended_at:'2027-07-02T00:00:00Z',
      status:'sent',content:{analysed_interviews:3},
    })
    const consultant=await signIn('consultant@northstar.local')
    const rows=await consultant.rpc('get_interview_digests',{p_organization_id:ORG,p_limit:10})
    expect(rows.error).toBeNull()
    expect(rows.data).toEqual([])
  })

  it('shows the owner the same content that was sent, read back rather than recomputed',async()=>{
    await service.from('interview_digest_runs').insert({
      organization_id:ORG,local_report_date:'2027-07-03',
      range_started_at:'2027-07-02T00:00:00Z',range_ended_at:'2027-07-03T00:00:00Z',
      status:'sent',analysis_count:3,content:{analysed_interviews:3,attention_findings:1},
    })
    const owner=await signIn('owner@northstar.local')
    const rows=await owner.rpc('get_interview_digests',{p_organization_id:ORG,p_limit:10})
    const first=required((rows.data as {content:{analysed_interviews:number}}[])[0],'digest row')
    expect(first.content.analysed_interviews).toBe(3)
  })
})
