import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon||!serviceKey)throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required; P1 RLS tests must not silently skip.')

const ORG='30000000-0000-0000-0000-000000000001'
const RIVAL_ORG='30000000-0000-0000-0000-000000000002'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const RIVAL_CANDIDATE='70000000-0000-0000-0000-000000000003'
const PARSE='71000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const COMPANY='60000000-0000-0000-0000-000000000001'

const owner=createClient(url,anon,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})
const sourcer=createClient(url,anon,{auth:{persistSession:false}})
const admin=createClient(url,serviceKey,{auth:{persistSession:false}})
const created={interviews:[] as string[],job:'',pipeline:''}
let ownerId=''

const required=<T,>(value:T|null|undefined,label:string):T=>{
  if(value===null||value===undefined)throw new Error(`${label} is required`)
  return value
}

beforeAll(async()=>{
  const results=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
    sourcer.auth.signInWithPassword({email:'sourcer@northstar.local',password:'LocalTest!123'}),
  ])
  const failed=results.find((result)=>result.error)
  if(failed?.error)throw failed.error
  ownerId=required(results[0].data.user?.id,'owner user id')
})

afterAll(async()=>{
  if(created.job){
    await admin.from('jobs').update({pipeline_id:null}).eq('id',created.job)
    if(created.pipeline)await admin.from('pipelines').update({job_id:null}).eq('id',created.pipeline)
    if(created.pipeline)await admin.from('pipelines').delete().eq('id',created.pipeline)
    await admin.from('jobs').delete().eq('id',created.job)
  }
  if(created.interviews.length){
    await admin.from('email_deliveries').delete().in('related_entity_id',created.interviews)
    await admin.from('interviews').delete().in('id',created.interviews)
  }
  await admin.from('candidate_search_documents').delete().in('candidate_id',[CANDIDATE,RIVAL_CANDIDATE])
  await admin.from('candidate_cv_parses').update({status:'ready',accepted_candidate_id:null,accepted_at:null,extracted_data:{full_name:'Visible only to uploader'}}).eq('id',PARSE)
})

describe('P1 placement-velocity database boundaries',()=>{
  it('searches accepted CV evidence without indexing its private contact block or another tenant',async()=>{
    const evidenceToken='transformation-orchestration-velvet'
    const privateToken='private-cv-canary-92817'
    const rivalToken='rival-only-cv-evidence-52914'
    const accepted=await admin.from('candidate_cv_parses').update({
      status:'accepted',accepted_candidate_id:CANDIDATE,accepted_at:new Date().toISOString(),
      extracted_data:{full_name:'Aisha Rahman',summary:evidenceToken,employment:[{company_name:'Harbor Energy',title:'Transformation Lead'}],private:{email:`${privateToken}@example.com`,phone:'+62 899 0000 0000'}},
    }).eq('id',PARSE)
    expect(accepted.error).toBeNull()
    const rivalDocument=await admin.from('candidate_search_documents').upsert({candidate_id:RIVAL_CANDIDATE,organization_id:RIVAL_ORG,extracted_content:{summary:rivalToken}})
    expect(rivalDocument.error).toBeNull()

    const byEvidence=await owner.rpc('search_candidates_page',{p_organization_id:ORG,p_query:evidenceToken})
    expect(byEvidence.error).toBeNull()
    expect((byEvidence.data as {id:string}[]|null)?.map((row)=>row.id)).toContain(CANDIDATE)

    const byPrivate=await owner.rpc('search_candidates_page',{p_organization_id:ORG,p_query:privateToken})
    expect(byPrivate.error).toBeNull()
    expect(byPrivate.data).toEqual([])

    const byRival=await owner.rpc('search_candidates_page',{p_organization_id:ORG,p_query:rivalToken})
    expect(byRival.error).toBeNull()
    expect(byRival.data).toEqual([])

    const visibleDocuments=await owner.from('candidate_search_documents').select('candidate_id,organization_id')
    expect(visibleDocuments.error).toBeNull()
    expect(visibleDocuments.data?.map((row)=>row.candidate_id)).toContain(CANDIDATE)
    expect(visibleDocuments.data?.map((row)=>row.candidate_id)).not.toContain(RIVAL_CANDIDATE)
  })

  it('cancels once, queues one normalized delivery per attendee, and safely reuses it on retry',async()=>{
    const inserted=await admin.from('interviews').insert({
      organization_id:ORG,job_candidate_id:JOB_CANDIDATE,starts_at:'2026-10-01T09:00:00Z',ends_at:'2026-10-01T10:00:00Z',timezone:'UTC',
      attendee_emails:['Client@example.com',' client@example.com ','candidate@example.com','not-an-email'],created_by:ownerId,
    }).select('id').single()
    expect(inserted.error).toBeNull()
    const interviewId=required(inserted.data?.id,'interview id');created.interviews.push(interviewId)

    const first=await consultant.rpc('queue_interview_cancellation',{p_organization_id:ORG,p_interview_id:interviewId})
    expect(first.error).toBeNull()
    expect((first.data as {recipient_email:string}[]).map((row)=>row.recipient_email)).toEqual(['candidate@example.com','client@example.com'])
    const second=await consultant.rpc('queue_interview_cancellation',{p_organization_id:ORG,p_interview_id:interviewId})
    expect(second.error).toBeNull()
    expect(second.data).toHaveLength(2)

    const interview=await admin.from('interviews').select('status,cancelled_at').eq('id',interviewId).single()
    expect(interview.data?.status).toBe('cancelled')
    expect(interview.data?.cancelled_at).toBeTruthy()
    const deliveries=await admin.from('email_deliveries').select('recipient_email,status,requested_by').eq('email_type','interview_cancellation').eq('related_entity_id',interviewId)
    expect(deliveries.error).toBeNull()
    expect(deliveries.data).toHaveLength(2)
    expect(deliveries.data?.every((row)=>row.status==='pending'&&Boolean(row.requested_by))).toBe(true)
  })

  it('does not let pipeline-move permission cancel an interview',async()=>{
    const inserted=await admin.from('interviews').insert({
      organization_id:ORG,job_candidate_id:JOB_CANDIDATE,starts_at:'2026-10-02T09:00:00Z',ends_at:'2026-10-02T10:00:00Z',timezone:'UTC',attendee_emails:['candidate@example.com'],created_by:ownerId,
    }).select('id').single()
    expect(inserted.error).toBeNull()
    const interviewId=required(inserted.data?.id,'restricted interview id');created.interviews.push(interviewId)

    const denied=await sourcer.rpc('queue_interview_cancellation',{p_organization_id:ORG,p_interview_id:interviewId})
    expect(denied.error?.code).toBe('P0002')
    const unchanged=await admin.from('interviews').select('status').eq('id',interviewId).single()
    expect(unchanged.data?.status).toBe('scheduled')
  })

  it('seeds ten canonical stages and copies their phase keys into every new job',async()=>{
    const template=await owner.from('pipelines').select('id').eq('organization_id',ORG).eq('kind','template').eq('is_default',true).single()
    expect(template.error).toBeNull()
    const templateStages=await owner.from('pipeline_stages').select('name,phase_key,stage_type,position').eq('pipeline_id',required(template.data?.id,'default pipeline id')).order('position')
    expect(templateStages.error).toBeNull()
    expect(templateStages.data?.map((stage)=>stage.name)).toEqual(['Sourcing','Screening','Shortlist','Client review','Interview','Offer','Placed','Rejected','Withdrawn','On hold'])
    expect(templateStages.data?.every((stage)=>Boolean(stage.phase_key))).toBe(true)

    const job=await owner.rpc('create_job_with_pipeline',{p_organization_id:ORG,p_company_id:COMPANY,p_title:'P1 Pipeline Copy Probe'})
    expect(job.error).toBeNull();created.job=required(job.data as string|null,'created job id')
    const createdJob=await admin.from('jobs').select('pipeline_id').eq('id',created.job).single()
    created.pipeline=required(createdJob.data?.pipeline_id,'created pipeline id')
    const copied=await admin.from('pipeline_stages').select('phase_key').eq('pipeline_id',created.pipeline)
    expect(copied.error).toBeNull()
    expect(copied.data).toHaveLength(10)
    expect(copied.data?.every((stage)=>Boolean(stage.phase_key))).toBe(true)
  })
})
