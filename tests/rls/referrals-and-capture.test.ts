import { createClient } from '@supabase/supabase-js'
import { beforeAll,describe,expect,it } from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001'

const owner=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})
beforeAll(async()=>{
  const results=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'}),
  ])
  const failure=results.find((result)=>result.error)
  if(failure?.error)throw failure.error
})

// A unique LinkedIn URL per run keeps re-runs against a non-reset local DB from colliding; CI resets
// anyway, but this makes the dedup assertions independent of prior state.
const uniqueLinkedin=(tag:string)=>`https://www.linkedin.com/in/rls-${tag}-${Date.now()}`

describe('capture_prospect',()=>{
  it('creates then dedupes a candidate by linkedin_url, coalesce-merging empty fields',async()=>{
    const linkedin=uniqueLinkedin('cap')
    const first=await owner.rpc('capture_prospect',{p_organization_id:NORTHSTAR,p_kind:'candidate',p_payload:{full_name:'Capture Dedup',current_company:'Acme',linkedin_url:linkedin,source:'LinkedIn'}})
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({deduped:false})
    const candidateId=(first.data as {id:string}).id

    // Second capture, same profile (different casing), adds a location and no company.
    const second=await owner.rpc('capture_prospect',{p_organization_id:NORTHSTAR,p_kind:'candidate',p_payload:{full_name:'Capture Dedup',location:'Jakarta',linkedin_url:linkedin.toUpperCase()}})
    expect(second.error).toBeNull()
    expect(second.data).toMatchObject({id:candidateId,deduped:true})

    const row=await owner.from('candidates').select('current_company,location,source').eq('id',candidateId).single()
    expect(row.error).toBeNull()
    expect(row.data?.current_company).toBe('Acme')      // preserved from first
    expect(row.data?.location).toBe('Jakarta')          // backfilled from second
    expect(row.data?.source).toBe('LinkedIn')           // caller label wins
  })

  it('links a captured candidate into a job pipeline',async()=>{
    const capture=await owner.rpc('capture_prospect',{p_organization_id:NORTHSTAR,p_kind:'candidate',p_payload:{full_name:'Capture Into Job',linkedin_url:uniqueLinkedin('job'),source:'LinkedIn'},p_job_id:JOB})
    expect(capture.error).toBeNull()
    expect(capture.data).toMatchObject({job_linked:true})
    const candidateId=(capture.data as {id:string}).id
    const link=await owner.from('job_candidates').select('source').eq('job_id',JOB).eq('candidate_id',candidateId).single()
    expect(link.error).toBeNull()
    expect(link.data?.source).toBe('LinkedIn')
  })

  it('refuses a cross-tenant capture',async()=>{
    // The Rival owner has candidates.write in Rival, but not in Northstar.
    const attack=await rival.rpc('capture_prospect',{p_organization_id:NORTHSTAR,p_kind:'candidate',p_payload:{full_name:'Cross Tenant',linkedin_url:uniqueLinkedin('x')}})
    expect(attack.error).not.toBeNull()
    expect(attack.error?.message).toContain('permission_denied')
  })
})

describe('referrals',()=>{
  it('accepts an internal referral into a candidate tagged Referral',async()=>{
    const referralId=await owner.rpc('submit_internal_referral',{p_organization_id:NORTHSTAR,p_payload:{candidate_full_name:'Referred Person',candidate_linkedin_url:uniqueLinkedin('ref'),target_job_id:JOB}})
    expect(referralId.error).toBeNull()
    const accept=await owner.rpc('accept_referral',{p_organization_id:NORTHSTAR,p_referral_id:referralId.data})
    expect(accept.error).toBeNull()
    const candidateId=(accept.data as {candidate_id:string}).candidate_id

    const candidate=await owner.from('candidates').select('full_name,source').eq('id',candidateId).single()
    expect(candidate.error).toBeNull()
    expect(candidate.data?.source).toBe('Referral')

    const referral=await owner.from('referrals').select('status,created_candidate_id').eq('id',referralId.data as string).single()
    expect(referral.data?.status).toBe('accepted')
    expect(referral.data?.created_candidate_id).toBe(candidateId)
  })

  it('keeps referrals scoped to their tenant',async()=>{
    await owner.rpc('submit_internal_referral',{p_organization_id:NORTHSTAR,p_payload:{candidate_full_name:'Tenant Scoped Referral'}})
    const seen=await rival.from('referrals').select('id').eq('organization_id',NORTHSTAR)
    expect(seen.error).toBeNull()
    expect(seen.data).toEqual([])
  })

  it('locks the public resolver to service_role (not reachable by an authenticated client)',async()=>{
    const attempt=await owner.rpc('resolve_referral_link',{p_token:'x'.repeat(43)})
    expect(attempt.error).not.toBeNull()
  })

  it('locks the public submitter to service_role (not reachable by an authenticated client)',async()=>{
    const attempt=await owner.rpc('submit_referral',{p_token:'x'.repeat(43),p_payload:{candidate_full_name:'Direct RPC attack'}})
    expect(attempt.error).not.toBeNull()
  })

  it('lets an owner mint a referral link',async()=>{
    const link=await owner.rpc('create_referral_link',{p_organization_id:NORTHSTAR,p_label:'Test link'})
    expect(link.error).toBeNull()
    expect((link.data as {token:string}).token.length).toBeGreaterThan(20)
  })
})
