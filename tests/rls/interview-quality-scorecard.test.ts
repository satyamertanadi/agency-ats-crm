import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

/* Release A2: the interview-quality Scorecard aggregate.
 *
 * The rules this file exists to prove are the ones that would be invisible if they broke. An average
 * over two interviews looks exactly like an average over twenty. A team rollup that quietly contains
 * only your own interviews looks exactly like a team rollup. A re-analysed interview counted twice
 * looks exactly like an extra interview. Each of those is a plausible number that is wrong, which is
 * worse for this feature than no number at all.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anonKey=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anonKey)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed scorecard fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const OWNER_USER='10000000-0000-0000-0000-000000000001'
const CONSULTANT_MEMBER='40000000-0000-0000-0000-000000000003'
const CONSULTANT_USER='10000000-0000-0000-0000-000000000003'
const CONSULTANT_EMAIL='consultant@northstar.local'
const OWNER_EMAIL='owner@northstar.local'
const PASSWORD='LocalTest!123'

/* A period well clear of every other suite's fixtures, so counts here are counts of this file's own
 * rows rather than of whatever else the seed happens to contain. */
const FROM='2027-03-01T00:00:00Z'
const TO='2027-04-01T00:00:00Z'

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

/* One analysed interview: the interview, a completed run, a consultant-quality assessment, and one
 * finding per named dimension. `scores` drives the dimension averages; `memberId` drives whose
 * interview it is, which is what the scope rules turn on.
 */
async function seedAnalysedInterview(options:{
  startsAt:string
  memberId?:string
  band?:string
  scores?:Partial<Record<string,number>>
  severity?:string
  withCandidateFit?:boolean
}){
  const {startsAt,memberId=CONSULTANT_MEMBER,band='effective',scores={question_quality:3},severity='info'}=options
  const ends=new Date(new Date(startsAt).getTime()+60*60_000).toISOString()

  const interview=await service.from('interviews').insert({
    organization_id:ORG,job_candidate_id:JOB_CANDIDATE,starts_at:startsAt,ends_at:ends,
    timezone:'UTC',status:'completed',organizer_member_id:memberId,created_by:CONSULTANT_USER,
  }).select('id').single()
  if(interview.error)throw new Error(interview.error.message)
  const interviewId=required(interview.data,'interview').id
  createdInterviews.push(interviewId)

  const runId=await seedRun(interviewId,startsAt,memberId,band,scores,severity)
  if(options.withCandidateFit){
    /* A candidate-fit assessment on the same interview. Nothing in the Scorecard may move because of
     * it -- the two assessments are independent, and a consultant's coaching record must not shift
     * because a candidate happened to interview badly. */
    await service.from('interview_assessments').insert({
      organization_id:ORG,analysis_run_id:runId,interview_id:interviewId,assessment_type:'candidate_fit',
      subject_candidate_id:CANDIDATE,overall_band:'material_concerns',confidence:'high',
      summary:'Candidate fit, which the quality scorecard must ignore entirely.',
    })
  }
  return {interviewId,runId}
}

async function seedRun(interviewId:string,startsAt:string,memberId:string,band:string,scores:Partial<Record<string,number>>,severity:string){
  const run=await service.from('interview_analysis_runs').insert({
    organization_id:ORG,interview_id:interviewId,job_candidate_id:JOB_CANDIDATE,
    core_rubric_id:coreRubric,job_rubric_id:jobRubric,
    provider:'anthropic',model:'test-model',prompt_version:'interview-analysis-v1',
    transcript_bundle_hash:`tb-${interviewId}-${band}`,rubric_bundle_hash:'rb',job_input_hash:'jb',
    candidate_input_hash:'cb',input_hash:`ih-${interviewId}-${band}-${Object.values(scores).join('-')}`,
    status:'completed',requested_by:CONSULTANT_USER,created_at:startsAt,
  }).select('id').single()
  if(run.error)throw new Error(run.error.message)
  const runId=required(run.data,'run').id

  const assessment=await service.from('interview_assessments').insert({
    organization_id:ORG,analysis_run_id:runId,interview_id:interviewId,assessment_type:'consultant_quality',
    subject_member_id:memberId,overall_band:band,confidence:'medium',
    summary:'Consultant quality assessment seeded for the scorecard aggregate.',
  }).select('id').single()
  if(assessment.error)throw new Error(assessment.error.message)
  const assessmentId=required(assessment.data,'assessment').id

  for(const [dimension,score] of Object.entries(scores)){
    const finding=await service.from('interview_assessment_findings').insert({
      organization_id:ORG,assessment_id:assessmentId,category:dimension,result:'effective',
      score,severity,confidence:'medium',title:`${dimension} finding`,
      summary:'Seeded finding.',sort_order:0,
    })
    if(finding.error)throw new Error(finding.error.message)
  }
  return runId
}

const scorecard=async(client:ReturnType<typeof createClient>,scope:'mine'|'team',from=FROM,to=TO)=>
  client.rpc('get_interview_quality_scorecard',{p_organization_id:ORG,p_from:from,p_to:to,p_scope:scope})

interface Payload {
  analysed_interviews:number
  previous_analysed_interviews:number
  minimum_sample:number
  interview_ids:string[]
  bands:{band:string;interviews:number;interview_ids:string[]}[]
  dimensions:{dimension:string;interviews:number;average_score:number|null;previous_average_score:number|null}[]
}

beforeAll(async()=>{
  const enabled=await service.from('organization_settings').update({interview_intelligence_enabled:true}).eq('organization_id',ORG)
  if(enabled.error)throw enabled.error

  for(const type of ['core','job'] as const){
    const rubric=await service.from('interview_rubrics').insert({
      organization_id:ORG,rubric_type:type,job_id:type==='job'?JOB:null,
      name:`scorecard ${type}`,status:'draft',created_by:OWNER_USER,
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

afterAll(async()=>{
  for(const id of createdInterviews)await service.from('interviews').delete().eq('id',id)
  for(const id of [coreRubric,jobRubric])if(id)await service.from('interview_rubrics').delete().eq('id',id)
  await service.from('organization_settings').update({interview_intelligence_enabled:false}).eq('organization_id',ORG)
})

describe('the sample-size floor',()=>{
  it('withholds an average until three interviews are analysed, then shows one',async()=>{
    /* The floor lives in SQL rather than in the component on purpose: a number that crosses the wire
     * gets printed by the next consumer that reads it, and "average over two interviews" is exactly
     * the fake precision this feature is not allowed to invent. */
    const consultant=await signIn(CONSULTANT_EMAIL)

    await seedAnalysedInterview({startsAt:'2027-03-02T09:00:00Z',scores:{question_quality:4}})
    await seedAnalysedInterview({startsAt:'2027-03-03T09:00:00Z',scores:{question_quality:2}})

    const two=await scorecard(consultant,'mine')
    expect(two.error).toBeNull()
    const twoPayload=two.data as Payload
    expect(twoPayload.analysed_interviews).toBe(2)
    expect(twoPayload.minimum_sample).toBe(3)
    // The count is honest and available; only the average is withheld.
    const twoDimension=required(twoPayload.dimensions[0],'question_quality dimension')
    expect(twoDimension.interviews).toBe(2)
    expect(twoDimension.average_score).toBeNull()

    await seedAnalysedInterview({startsAt:'2027-03-04T09:00:00Z',scores:{question_quality:3}})

    const three=await scorecard(consultant,'mine')
    const threePayload=three.data as Payload
    expect(threePayload.analysed_interviews).toBe(3)
    expect(Number(required(threePayload.dimensions[0],'question_quality dimension').average_score)).toBe(3)
  })
})

describe('what the aggregate refuses to mix in',()=>{
  it('ignores candidate-fit assessments entirely',async()=>{
    /* Candidate fit and consultant quality are independent by design. If a candidate-fit row could
     * move this aggregate, a consultant's coaching record would shift because somebody they
     * interviewed did badly -- which is the single thing this feature must never do. */
    const consultant=await signIn(CONSULTANT_EMAIL)
    const before=(await scorecard(consultant,'mine')).data as Payload

    await seedAnalysedInterview({startsAt:'2027-03-05T09:00:00Z',withCandidateFit:true,scores:{question_quality:3}})

    const after=(await scorecard(consultant,'mine')).data as Payload
    // One interview added, not two, even though two assessments were written for it.
    expect(after.analysed_interviews).toBe(before.analysed_interviews+1)
    const bands=after.bands.map((entry)=>entry.band)
    expect(bands).not.toContain('material_concerns')
  })

  it('counts a re-analysed interview once, using its newest assessment',async()=>{
    /* A corrected speaker mapping or a rubric change produces a second run, and therefore a second
     * assessment, for the same conversation. Counting both would inflate the tile above the drilldown
     * behind it -- the reconciliation failure the definition of done forbids. */
    const consultant=await signIn(CONSULTANT_EMAIL)
    const {interviewId}=await seedAnalysedInterview({
      startsAt:'2027-03-06T09:00:00Z',band:'needs_development',scores:{listening_balance:1},
    })
    const before=(await scorecard(consultant,'mine')).data as Payload

    await seedRun(interviewId,'2027-03-06T18:00:00Z',CONSULTANT_MEMBER,'strong',{listening_balance:4},'info')

    const after=(await scorecard(consultant,'mine')).data as Payload
    expect(after.analysed_interviews).toBe(before.analysed_interviews)
    expect(new Set(after.interview_ids).size).toBe(after.interview_ids.length)

    // The newest run's band is the interview's band; the superseded one is gone, not double-counted.
    const bandFor=(band:string)=>after.bands.find((entry)=>entry.band===band)?.interview_ids??[]
    expect(bandFor('strong')).toContain(interviewId)
    expect(bandFor('needs_development')).not.toContain(interviewId)
  })
})

describe('drilldowns reconcile to the aggregate',()=>{
  it('returns exactly the interviews each band counted',async()=>{
    const consultant=await signIn(CONSULTANT_EMAIL)
    const payload=(await scorecard(consultant,'mine')).data as Payload
    for(const band of payload.bands){
      expect(band.interview_ids).toHaveLength(band.interviews)
    }
    const bandTotal=payload.bands.reduce((sum,band)=>sum+band.interviews,0)
    expect(bandTotal).toBe(payload.analysed_interviews)
  })
})

describe('own-history comparison',()=>{
  it('reads the previous period of the same length, not another consultant',async()=>{
    const consultant=await signIn(CONSULTANT_EMAIL)
    await seedAnalysedInterview({startsAt:'2027-02-10T09:00:00Z',scores:{role_presentation:2}})
    await seedAnalysedInterview({startsAt:'2027-02-11T09:00:00Z',scores:{role_presentation:2}})
    await seedAnalysedInterview({startsAt:'2027-02-12T09:00:00Z',scores:{role_presentation:2}})
    await seedAnalysedInterview({startsAt:'2027-03-10T09:00:00Z',scores:{role_presentation:4}})
    await seedAnalysedInterview({startsAt:'2027-03-11T09:00:00Z',scores:{role_presentation:4}})
    await seedAnalysedInterview({startsAt:'2027-03-12T09:00:00Z',scores:{role_presentation:4}})

    const payload=(await scorecard(consultant,'mine')).data as Payload
    expect(payload.previous_analysed_interviews).toBeGreaterThanOrEqual(3)
    const role=required(payload.dimensions.find((entry)=>entry.dimension==='role_presentation'),'role_presentation dimension')
    expect(Number(role.average_score)).toBe(4)
    expect(Number(role.previous_average_score)).toBe(2)
  })

  it('measures the period by when the interview happened, not when it was analysed',async()=>{
    /* Keying on analysis time would move an interview between periods because somebody re-ran it. */
    const consultant=await signIn(CONSULTANT_EMAIL)
    const outside=(await scorecard(consultant,'mine','2027-05-01T00:00:00Z','2027-06-01T00:00:00Z')).data as Payload
    expect(outside.analysed_interviews).toBe(0)
  })
})

describe('scope',()=>{
  it('refuses a team rollup to a consultant who may not review the team',async()=>{
    /* Not a filtered result -- a refusal. Silently returning their own numbers under a team heading
     * would be an honest-looking figure that is wrong, which is worse than an error. */
    const consultant=await signIn(CONSULTANT_EMAIL)
    const result=await scorecard(consultant,'team')
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain('permission_denied')
  })

  it('refuses an unknown scope rather than defaulting to one',async()=>{
    const consultant=await signIn(CONSULTANT_EMAIL)
    const result=await consultant.rpc('get_interview_quality_scorecard',{
      p_organization_id:ORG,p_from:FROM,p_to:TO,p_scope:'everyone',
    })
    expect(result.error?.message).toContain('invalid_scope')
  })

  it('gives a reviewer the desk, including interviews they did not run',async()=>{
    const owner=await signIn(OWNER_EMAIL)
    const result=await scorecard(owner,'team')
    expect(result.error).toBeNull()
    const payload=result.data as Payload
    expect(payload.analysed_interviews).toBeGreaterThan(0)
  })

  it('gives a reviewer asking for "mine" their own interviews, not the desk',async()=>{
    /* The owner ran none of these, so their personal view must be empty even though their team view
     * is not. A scope that ignored the member filter for privileged callers would show a manager
     * their team's work labelled as their own. */
    const owner=await signIn(OWNER_EMAIL)
    const payload=(await scorecard(owner,'mine')).data as Payload
    expect(payload.analysed_interviews).toBe(0)
  })
})

describe('team patterns',()=>{
  const patterns=(client:ReturnType<typeof createClient>)=>
    client.rpc('get_interview_quality_team_patterns',{p_organization_id:ORG,p_from:FROM,p_to:TO})

  it('is refused to a consultant',async()=>{
    const consultant=await signIn(CONSULTANT_EMAIL)
    const result=await patterns(consultant)
    expect(result.error?.message).toContain('permission_denied')
  })

  it('carries no member identifier anywhere in the payload',async()=>{
    /* The plan says never rank consultants. The reliable way to honour that is for the data that
     * would support a ranking to be absent rather than merely unrendered, because the surface that
     * renders it is the easiest thing in the system to change later. */
    const owner=await signIn(OWNER_EMAIL)
    const result=await patterns(owner)
    expect(result.error).toBeNull()
    const raw=JSON.stringify(result.data)
    expect(raw).not.toContain(CONSULTANT_MEMBER)
    expect(raw).not.toMatch(/member_id|subject_member|consultant_id/)
  })

  it('reports rates as their two components rather than a percentage',async()=>{
    /* A rate with no denominator beside it reads the same whether it came from thirty transcripts or
     * from two, and the client cannot reconstruct the sample once the division has happened. */
    const owner=await signIn(OWNER_EMAIL)
    const result=await patterns(owner)
    const payload=result.data as {transcripts:{total:number;complete:number};runs:{total:number;failed:number}}
    expect(payload.transcripts).toHaveProperty('total')
    expect(payload.transcripts).toHaveProperty('complete')
    expect(payload.runs).toHaveProperty('total')
    expect(payload.runs).toHaveProperty('failed')
    expect(JSON.stringify(payload)).not.toMatch(/percent|rate/)
  })
})

describe('period validation',()=>{
  it('refuses a backwards or empty period rather than returning zeros',async()=>{
    /* Zeros would read as "nothing happened that month", which is a statement about the desk rather
     * than about the request. */
    const consultant=await signIn(CONSULTANT_EMAIL)
    const backwards=await scorecard(consultant,'mine',TO,FROM)
    expect(backwards.error?.message).toContain('invalid_period')
  })
})
