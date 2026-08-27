import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

/* The blueprint lifecycle: draft, review, activate, and the staleness signal.
 *
 * The assertions that matter most are the negative ones about staleness. A blueprint that goes stale
 * when somebody reassigns the job owner produces a warning consultants learn to dismiss, and a
 * dismissed warning is worse than none -- so "an unrelated edit does NOT mark it stale" is the real
 * requirement, and it is tested against the specific columns that used to be the obvious shortcut.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed blueprint fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001'
const OWNER_MEMBER='40000000-0000-0000-0000-000000000001'
const OWNER_USER='10000000-0000-0000-0000-000000000001'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})
const owner=createClient(url,anon,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})
const sourcer=createClient(url,anon,{auth:{persistSession:false}})

const created:string[]=[]
let originalJob:{title:string;description:string|null;requirements:string|null;owner_member_id:string|null}|null=null

const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

async function draftBlueprint(name:string){
  const rubric=await service.from('interview_rubrics').insert({
    organization_id:ORG,rubric_type:'job',job_id:JOB,name,status:'draft',created_by:OWNER_USER,
    job_brief_hash:await currentHash(),
  }).select('id').single()
  if(rubric.error)throw new Error(rubric.error.message)
  const id=required(rubric.data,'rubric').id
  created.push(id)
  const item=await service.from('interview_rubric_items').insert({
    organization_id:ORG,rubric_id:id,dimension:'essential_coverage',item_type:'essential_question',
    label:'Commercial ownership',question_text:'What was your revenue accountability?',
    requirement_level:'must_have',sort_order:0,
  })
  if(item.error)throw new Error(item.error.message)
  return id
}

async function currentHash(documentId:string|null=null){
  const result=await owner.rpc('interview_job_brief_hash',{p_job_id:JOB,p_document_id:documentId})
  if(result.error)throw new Error(result.error.message)
  return result.data as string
}

async function status(client=owner){
  const result=await client.rpc('get_interview_blueprint_status',{p_organization_id:ORG,p_job_id:JOB})
  expect(result.error).toBeNull()
  return (result.data as Record<string,unknown>[]|null)?.[0]
}

beforeAll(async()=>{
  const signIns=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
    sourcer.auth.signInWithPassword({email:'sourcer@northstar.local',password:'LocalTest!123'}),
  ])
  signIns.forEach((result)=>{if(result.error)throw result.error})
  const enabled=await service.from('organization_settings').update({interview_intelligence_enabled:true}).eq('organization_id',ORG)
  if(enabled.error)throw enabled.error

  const job=await service.from('jobs').select('title,description,requirements,owner_member_id').eq('id',JOB).single()
  if(job.error)throw job.error
  originalJob=job.data
})

afterAll(async()=>{
  if(originalJob)await service.from('jobs').update(originalJob).eq('id',JOB)
  for(const id of created)await service.from('interview_rubrics').delete().eq('id',id)
  await service.from('organization_settings').update({interview_intelligence_enabled:false}).eq('organization_id',ORG)
})

describe('the job brief hash tracks only what changes the interview',()=>{
  it('is stable across repeated calls',async()=>{
    expect(await currentHash()).toBe(await currentHash())
  })

  it('changes when the requirements change',async()=>{
    const before=await currentHash()
    await service.from('jobs').update({requirements:'Twelve years commercial leadership; regional energy.'}).eq('id',JOB)
    expect(await currentHash()).not.toBe(before)
    await service.from('jobs').update({requirements:originalJob?.requirements}).eq('id',JOB)
    expect(await currentHash()).toBe(before)
  })

  it('does not change when the job owner changes',async()=>{
    // The exact edit that made jobs.updated_at useless as a staleness signal.
    const before=await currentHash()
    await service.from('jobs').update({owner_member_id:OWNER_MEMBER}).eq('id',JOB)
    expect(await currentHash()).toBe(before)
    await service.from('jobs').update({owner_member_id:originalJob?.owner_member_id}).eq('id',JOB)
  })

  it('reveals nothing about a job in another workspace',async()=>{
    // A rival's job id yields no hash at all rather than a fingerprint that could be watched for
    // changes.
    const rival=createClient(url,anon,{auth:{persistSession:false}})
    const signIn=await rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'})
    expect(signIn.error).toBeNull()
    const result=await rival.rpc('interview_job_brief_hash',{p_job_id:JOB,p_document_id:null})
    expect(result.error).toBeNull()
    expect(result.data).toBeNull()
  })
})

describe('blueprint status',()=>{
  it('reports a job with no blueprint as not set up rather than stale',async()=>{
    const row=await status()
    expect(row?.rubric_id).toBeNull()
    expect(row?.is_stale).toBe(false)
    expect(row?.essential_question_count).toBe(0)
  })

  it('is unavailable to somebody without the feature',async()=>{
    const result=await sourcer.rpc('get_interview_blueprint_status',{p_organization_id:ORG,p_job_id:JOB})
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it('lets a consultant see the blueprint they are expected to interview against',async()=>{
    const row=await status(consultant)
    expect(row).toBeDefined()
  })
})

describe('activation is a human decision',()=>{
  it('refuses to activate an empty blueprint',async()=>{
    const empty=await service.from('interview_rubrics').insert({
      organization_id:ORG,rubric_type:'job',job_id:JOB,name:'Empty',status:'draft',created_by:OWNER_USER,
    }).select('id').single()
    const id=required(empty.data,'empty rubric').id
    created.push(id)
    const result=await owner.rpc('activate_interview_rubric',{p_organization_id:ORG,p_rubric_id:id})
    expect(result.error?.message).toContain('interview_rubric_empty')
    await service.from('interview_rubrics').delete().eq('id',id)
  })

  it('refuses a consultant without configure', async()=>{
    const id=await draftBlueprint('Consultant attempt')
    const result=await consultant.rpc('activate_interview_rubric',{p_organization_id:ORG,p_rubric_id:id})
    expect(result.error?.message).toContain('permission_denied')
    await service.from('interview_rubrics').delete().eq('id',id)
  })

  it('activates a draft, records the actor, and shows it in status',async()=>{
    const id=await draftBlueprint('First blueprint')
    const result=await owner.rpc('activate_interview_rubric',{p_organization_id:ORG,p_rubric_id:id})
    expect(result.error).toBeNull()
    expect(result.data).toBe(id)

    const row=await status()
    expect(row?.rubric_id).toBe(id)
    expect(row?.essential_question_count).toBe(1)
    expect(row?.must_have_count).toBe(1)
    expect(row?.is_stale).toBe(false)

    const stored=await service.from('interview_rubrics').select('status,activated_by,activated_at').eq('id',id).single()
    expect(stored.data?.status).toBe('active')
    expect(stored.data?.activated_by).toBe(OWNER_USER)
    expect(stored.data?.activated_at).not.toBeNull()

    const audit=await service.from('audit_logs').select('action,entity_id,metadata').eq('entity_id',id).eq('action','interview_rubric.activated')
    expect(audit.data).toHaveLength(1)
    // Identifiers only -- no blueprint content in the audit trail.
    expect(JSON.stringify(audit.data?.[0].metadata)).not.toContain('revenue accountability')
  })

  it('archives the incumbent when a successor is activated',async()=>{
    const first=required((await service.from('interview_rubrics').select('id').eq('job_id',JOB).eq('status','active').maybeSingle()).data,'incumbent').id
    const second=await draftBlueprint('Second blueprint')
    const result=await owner.rpc('activate_interview_rubric',{p_organization_id:ORG,p_rubric_id:second})
    expect(result.error).toBeNull()

    const previous=await service.from('interview_rubrics').select('status,archived_at').eq('id',first).single()
    expect(previous.data?.status).toBe('archived')
    expect(previous.data?.archived_at).not.toBeNull()

    // Exactly one active blueprint for the job, always.
    const active=await service.from('interview_rubrics').select('id').eq('job_id',JOB).eq('status','active')
    expect(active.data).toHaveLength(1)
    expect(active.data?.[0].id).toBe(second)
  })

  it('refuses to reactivate an archived blueprint',async()=>{
    const archived=required((await service.from('interview_rubrics').select('id').eq('job_id',JOB).eq('status','archived').limit(1).maybeSingle()).data,'archived').id
    const result=await owner.rpc('activate_interview_rubric',{p_organization_id:ORG,p_rubric_id:archived})
    expect(result.error?.message).toContain('interview_rubric_archived_is_final')
  })

  it('does not find a blueprint in another workspace',async()=>{
    const result=await owner.rpc('activate_interview_rubric',{
      p_organization_id:ORG,p_rubric_id:'99999999-9999-4999-8999-999999999999',
    })
    expect(result.error?.message).toContain('interview_rubric_not_found')
  })
})

describe('staleness',()=>{
  it('flags a blueprint once the job brief moves underneath it',async()=>{
    expect((await status())?.is_stale).toBe(false)
    await service.from('jobs').update({description:'Now a global remit with a new P&L.'}).eq('id',JOB)
    expect((await status())?.is_stale).toBe(true)

    // Stale is a prompt for a human, never an automatic regeneration: the active blueprint is
    // untouched and still active.
    const active=await service.from('interview_rubrics').select('id,status').eq('job_id',JOB).eq('status','active')
    expect(active.data).toHaveLength(1)

    await service.from('jobs').update({description:originalJob?.description}).eq('id',JOB)
    expect((await status())?.is_stale).toBe(false)
  })

  it('stays fresh when an unrelated field changes',async()=>{
    await service.from('jobs').update({internal_notes:'Client chased on Friday.',priority:'low'}).eq('id',JOB)
    expect((await status())?.is_stale).toBe(false)
  })
})
