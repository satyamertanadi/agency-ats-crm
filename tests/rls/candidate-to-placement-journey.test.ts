import { createClient } from '@supabase/supabase-js'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to stand in for the public-review Edge Function, which always calls as service_role.')

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const ATLAS='60000000-0000-0000-0000-000000000001' // seeded 'Atlas Renewable Energy', an active client
const ATLAS_CONTACT='61000000-0000-0000-0000-000000000001'

const owner=createClient(url,anon,{auth:{persistSession:false}})
const admin=createClient(url,serviceKey,{auth:{persistSession:false}})

const required=<T,>(value:T|null|undefined,what:string):T=>{if(value===null||value===undefined)throw new Error(`${what} is required`);return value}

let ownerId=''
let candidateId='';let jobId='';let pipelineId='';let jobCandidateId=''
let packageId='';let deliveryId='';let submissionId=''
let feedbackId='';let offerId='';let placementId=''

const stageId=async(pipeline:string,stageKey:string)=>{
  const result=await owner.from('pipeline_stages').select('id').eq('pipeline_id',pipeline).eq('stage_key',stageKey).single()
  expect(result.error).toBeNull()
  return required(result.data?.id,`${stageKey} stage`) as string
}

beforeAll(async()=>{
  const signIn=await owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'})
  if(signIn.error)throw signIn.error
  ownerId=required(signIn.data.user?.id,'owner user id')
})

afterAll(async()=>{
  // Every RPC in this journey (stage moves, the submission, client feedback, the placement) logs an
  // activity via log_activity, which fans out into one activity_links row per {candidate_id,job_id,...}
  // link -- and activity_links.job_id/candidate_id/candidate_submission_id/placement_id carry no
  // ON DELETE CASCADE. Deleting the job or candidate before their activities are gone would fail with
  // a foreign key violation, so the activities have to go first.
  const activityFilters:string[]=[]
  if(jobId)activityFilters.push(`job_id.eq.${jobId}`)
  if(candidateId)activityFilters.push(`candidate_id.eq.${candidateId}`)
  if(activityFilters.length){
    const linked=await owner.from('activity_links').select('activity_id').eq('organization_id',NORTHSTAR).or(activityFilters.join(','))
    const activityIds=[...new Set((linked.data??[]).map((row)=>row.activity_id))]
    if(activityIds.length)await owner.from('activities').delete().in('id',activityIds)
  }
  if(placementId)await owner.from('placements').delete().eq('id',placementId)
  if(offerId)await owner.from('offers').delete().eq('id',offerId)
  if(feedbackId)await owner.from('submission_feedback').delete().eq('id',feedbackId)
  if(deliveryId)await admin.from('email_deliveries').delete().eq('id',deliveryId) // cascades the service-only retry payload
  if(packageId)await owner.from('submission_packages').delete().eq('id',packageId) // cascades public_submission_links, candidate_submissions
  if(jobCandidateId)await owner.from('job_candidates').delete().eq('id',jobCandidateId) // cascades stage_history
  if(jobId)await owner.from('jobs').delete().eq('id',jobId)
  if(pipelineId)await owner.from('pipelines').delete().eq('id',pipelineId) // cascades pipeline_stages
  if(candidateId)await owner.from('candidates').delete().eq('id',candidateId) // cascades candidate_private_details
})

// End-to-end regression for the RPC chain the N1-N7 hardening pass touched (audit item X2): a
// candidate must be able to travel from first contact through a client-facing submission, public
// review approval, an accepted offer, and a placement without any one step's grant or RLS boundary
// silently breaking the next. Each RPC here already has its own isolation coverage elsewhere
// (tenant-isolation, salary-period-fee, private-details-permission-split); this proves they still
// compose into one working journey end to end.
describe('candidate to placement journey',()=>{
  it('moves a new candidate through the full recruitment lifecycle',async()=>{
    // 1. Candidate
    const failedCandidateName=`Atomic rollback ${crypto.randomUUID()}`
    const failedCandidate=await owner.rpc('create_candidate_with_profile',{p_organization_id:NORTHSTAR,p_candidate:{full_name:failedCandidateName},p_private:{consent_status:'unknown'},p_employment:[{company_name:'Broken Co',title:'Director',started_on:'not-a-date'}],p_education:[],p_languages:[],p_skills:[]})
    expect(failedCandidate.error).not.toBeNull()
    const partialCandidate=await owner.from('candidates').select('id',{count:'exact',head:true}).eq('organization_id',NORTHSTAR).eq('full_name',failedCandidateName)
    expect(partialCandidate.count).toBe(0)
    const candidate=await owner.rpc('create_candidate_with_profile',{p_organization_id:NORTHSTAR,p_candidate:{full_name:'Journey Test Candidate',current_company:'Prior Co',current_position:'Regional Director',location:'Singapore',status:'active',source:'Journey test'},p_private:{email:`journey-${crypto.randomUUID()}@example.com`,phone:'+65 8000 0000',expected_salary:180_000,salary_currency:'USD',consent_status:'granted'},p_employment:[{company_name:'Prior Co',title:'Regional Director',is_current:true}],p_education:[],p_languages:[{language:'English',proficiency:'Fluent'}],p_skills:[{name:'Leadership',years_experience:8}]})
    expect(candidate.error).toBeNull()
    candidateId=required(candidate.data,'candidate id') as string
    const profileRows=await owner.from('candidate_employment').select('id').eq('candidate_id',candidateId)
    expect(profileRows.data).toHaveLength(1)

    // 2. Job, cloned from the org's default pipeline
    const failedJobTitle=`Atomic rollback ${crypto.randomUUID()}`
    const failedJob=await owner.rpc('create_job_with_details',{p_organization_id:NORTHSTAR,p_company_id:ATLAS,p_title:failedJobTitle,p_details:{salary_min:220_000,salary_max:180_000}})
    expect(failedJob.error).not.toBeNull()
    const partialJob=await owner.from('jobs').select('id',{count:'exact',head:true}).eq('organization_id',NORTHSTAR).eq('title',failedJobTitle)
    expect(partialJob.count).toBe(0)
    const job=await owner.rpc('create_job_with_details',{p_organization_id:NORTHSTAR,p_company_id:ATLAS,p_title:'Journey Test Role',p_details:{priority:'high',location:'Singapore',currency:'USD',salary_min:180_000,salary_max:220_000}})
    expect(job.error).toBeNull()
    jobId=required(job.data,'job id') as string
    const jobRow=await owner.from('jobs').select('pipeline_id').eq('id',jobId).single()
    expect(jobRow.error).toBeNull()
    pipelineId=required(jobRow.data?.pipeline_id,'job pipeline id') as string

    // 3. Add the candidate to the pipeline at its first stage
    const sourced=await stageId(pipelineId,'sourced')
    const jobCandidate=await owner.from('job_candidates').insert({organization_id:NORTHSTAR,job_id:jobId,candidate_id:candidateId,current_stage_id:sourced,added_by:ownerId}).select('id').single()
    expect(jobCandidate.error).toBeNull()
    jobCandidateId=required(jobCandidate.data?.id,'job_candidate id') as string

    // 4. Move to Submitted to Client
    const submittedStage=await stageId(pipelineId,'submitted_to_client')
    const moved=await owner.rpc('move_job_candidate_stage',{p_job_candidate_id:jobCandidateId,p_stage_id:submittedStage,p_note:'Ready for client review'})
    expect(moved.error).toBeNull()
    expect((moved.data as {current_stage_id:string}|null)?.current_stage_id).toBe(submittedStage)

    // 5. Submission package + client-facing link/token
    const requestKey=crypto.randomUUID()
    const submission=await owner.rpc('create_submission_delivery',{p_organization_id:NORTHSTAR,p_job_id:jobId,p_request_key:requestKey,p_title:'Journey Test Role - shortlist',p_items:[{job_candidate_id:jobCandidateId,candidate_summary:'Strong regional leadership background.'}],p_contact_id:ATLAS_CONTACT,p_recipient_email:'client@example.com',p_expiry_days:7})
    expect(submission.error).toBeNull()
    const submissionResult=submission.data as {package_id:string;delivery_id:string;token:string}
    packageId=required(submissionResult.package_id,'package id')
    deliveryId=required(submissionResult.delivery_id,'delivery id')
    const token=required(submissionResult.token,'submission token')
    const repeated=await owner.rpc('create_submission_delivery',{p_organization_id:NORTHSTAR,p_job_id:jobId,p_request_key:requestKey,p_title:'Journey Test Role - shortlist',p_items:[{job_candidate_id:jobCandidateId,candidate_summary:'Strong regional leadership background.'}],p_contact_id:ATLAS_CONTACT,p_recipient_email:'client@example.com',p_expiry_days:7})
    expect(repeated.error).toBeNull()
    expect((repeated.data as {package_id:string;delivery_id:string}).package_id).toBe(packageId)
    expect((repeated.data as {package_id:string;delivery_id:string}).delivery_id).toBe(deliveryId)

    // 6. An authenticated client cannot resolve the link directly -- only the hardened Edge Function path (service_role) can
    const blocked=await owner.rpc('resolve_submission_link',{p_token:token})
    expect(blocked.error?.code).toBe('42501')

    // 7. Public review page loads (simulated: the Edge Function always calls this as service_role)
    const resolved=await admin.rpc('resolve_submission_link',{p_token:token})
    expect(resolved.error).toBeNull()
    const resolvedData=resolved.data as {package:{title:string};candidates:{submission_id:string;candidate_name:string}[]}
    expect(resolvedData.package.title).toBe('Journey Test Role - shortlist')
    expect(resolvedData.candidates).toHaveLength(1)
    submissionId=required(resolvedData.candidates[0]?.submission_id,'candidate submission id')
    expect(resolvedData.candidates[0]?.candidate_name).toBe('Journey Test Candidate')

    // 8. Client approves via the public review page (simulated: service_role)
    const feedback=await admin.rpc('submit_submission_feedback',{p_token:token,p_candidate_submission_id:submissionId,p_decision:'approve',p_comments:'Great fit, please schedule an interview.',p_reviewer_name:'Amanda Chen'})
    expect(feedback.error).toBeNull()
    expect((feedback.data as {ok:boolean}|null)?.ok).toBe(true)
    const feedbackRow=await owner.from('submission_feedback').select('id,decision').eq('candidate_submission_id',submissionId).single()
    expect(feedbackRow.error).toBeNull()
    expect(feedbackRow.data?.decision).toBe('approve')
    feedbackId=required(feedbackRow.data?.id,'feedback id') as string

    // 9. Move to Offer stage
    const offerStage=await stageId(pipelineId,'offer')
    const movedToOffer=await owner.rpc('move_job_candidate_stage',{p_job_candidate_id:jobCandidateId,p_stage_id:offerStage,p_note:'Client approved, drafting offer'})
    expect(movedToOffer.error).toBeNull()

    // 10. Offer accepted
    const offer=await owner.from('offers').insert({organization_id:NORTHSTAR,job_candidate_id:jobCandidateId,salary:190_000,currency:'USD',start_date:'2026-09-01',status:'accepted',created_by:ownerId}).select('id').single()
    expect(offer.error).toBeNull()
    offerId=required(offer.data?.id,'offer id') as string

    // 11. Placement -- this RPC itself advances the pipeline to the Placed stage
    const placement=await owner.rpc('create_placement_from_offer',{p_offer_id:offerId,p_fee:38_000,p_guarantee_days:90,p_fee_source:'manual'})
    expect(placement.error).toBeNull()
    placementId=required(placement.data,'placement id') as string
    const duplicatePlacement=await owner.rpc('create_placement_from_offer',{p_offer_id:offerId,p_fee:38_000,p_guarantee_days:90,p_fee_source:'manual'})
    expect(duplicatePlacement.error?.message).toContain('job_already_placed')

    const placementRow=await owner.from('placements').select('job_candidate_id,candidate_id,job_id,company_id,status,fee_source').eq('id',placementId).single()
    expect(placementRow.error).toBeNull()
    expect(placementRow.data?.job_candidate_id).toBe(jobCandidateId)
    expect(placementRow.data?.candidate_id).toBe(candidateId)
    expect(placementRow.data?.company_id).toBe(ATLAS)
    expect(placementRow.data?.status).toBe('confirmed')

    const finalStage=await owner.from('job_candidates').select('current_stage_id,pipeline_stages(stage_type)').eq('id',jobCandidateId).single()
    expect(finalStage.error).toBeNull()
    expect((finalStage.data as unknown as {pipeline_stages:{stage_type:string}}|null)?.pipeline_stages?.stage_type).toBe('placed')

    const finalCandidate=await owner.from('candidates').select('status').eq('id',candidateId).single()
    expect(finalCandidate.data?.status).toBe('placed')

    const finalJob=await owner.from('jobs').select('status').eq('id',jobId).single()
    expect(finalJob.data?.status).toBe('filled')
  })
})
