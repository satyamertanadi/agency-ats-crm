import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')

const ORG='30000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const consultant=createClient(url,anon,{auth:{persistSession:false}})
const sourcer=createClient(url,anon,{auth:{persistSession:false}})
const finance=createClient(url,anon,{auth:{persistSession:false}})
const created:{interview?:string;offer?:string}={}
const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

beforeAll(async()=>{
  const results=await Promise.all([
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
    sourcer.auth.signInWithPassword({email:'sourcer@northstar.local',password:'LocalTest!123'}),
    finance.auth.signInWithPassword({email:'finance@northstar.local',password:'LocalTest!123'}),
  ])
  results.forEach((result)=>{if(result.error)throw result.error})
})

afterAll(async()=>{
  if(created.interview)await consultant.from('interviews').delete().eq('id',created.interview)
  if(created.offer)await consultant.from('offers').delete().eq('id',created.offer)
})

describe('interview and offer permission split',()=>{
  it('lets a consultant schedule interviews and present offers',async()=>{
    const consultantUser=required((await consultant.auth.getUser()).data.user,'consultant user')
    const interview=await consultant.from('interviews').insert({organization_id:ORG,job_candidate_id:JOB_CANDIDATE,starts_at:'2026-09-01T09:00:00Z',ends_at:'2026-09-01T10:00:00Z',timezone:'UTC',created_by:consultantUser.id}).select('id').single()
    expect(interview.error).toBeNull();created.interview=interview.data?.id

    const offer=await consultant.from('offers').insert({organization_id:ORG,job_candidate_id:JOB_CANDIDATE,salary:150_000,currency:'USD',status:'presented',created_by:consultantUser.id}).select('id').single()
    expect(offer.error).toBeNull();created.offer=offer.data?.id
  })

  it('does not turn pipeline movement into interview or offer authority',async()=>{
    expect((await sourcer.rpc('has_permission',{p_organization_id:ORG,p_permission:'pipeline.move'})).data).toBe(true)
    expect((await sourcer.rpc('has_permission',{p_organization_id:ORG,p_permission:'interviews.write'})).data).toBe(false)
    expect((await sourcer.rpc('has_permission',{p_organization_id:ORG,p_permission:'offers.write'})).data).toBe(false)

    const user=required((await sourcer.auth.getUser()).data.user,'sourcer user')
    const interview=await sourcer.from('interviews').insert({organization_id:ORG,job_candidate_id:JOB_CANDIDATE,starts_at:'2026-09-02T09:00:00Z',ends_at:'2026-09-02T10:00:00Z',timezone:'UTC',created_by:user.id})
    const offer=await sourcer.from('offers').insert({organization_id:ORG,job_candidate_id:JOB_CANDIDATE,salary:150_000,currency:'USD',status:'presented',created_by:user.id})
    expect(interview.error?.code).toBe('42501')
    expect(offer.error?.code).toBe('42501')
  })

  it('keeps finance placement access without granting recruitment decisions',async()=>{
    expect((await finance.rpc('has_permission',{p_organization_id:ORG,p_permission:'placements.write'})).data).toBe(true)
    expect((await finance.rpc('has_permission',{p_organization_id:ORG,p_permission:'interviews.write'})).data).toBe(false)
    expect((await finance.rpc('has_permission',{p_organization_id:ORG,p_permission:'offers.write'})).data).toBe(false)
  })
})
