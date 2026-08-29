import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

/* Structured job requirements: isolation, the write gate, and the trigger nobody sees.
 *
 * The trigger assertion is the one that matters most and looks least like a security test. Candidate
 * profile generation caches on a hash of the job row and marks stored drafts stale off
 * jobs.updated_at. Requirements living in their own table means a requirement edit does not touch
 * that column on its own -- so without the trigger the cache keeps serving a profile scored against a
 * requirement set the recruiter has already replaced, silently and with no way to tell from the UI.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed job requirement fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const RIVAL_ORG='30000000-0000-0000-0000-000000000002'
const JOB='80000000-0000-0000-0000-000000000001'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})
const owner=createClient(url,anon,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})
// sourcer holds jobs.read but not jobs.write, which is exactly the gap the RPC has to enforce.
const sourcer=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})

const item=(label:string,overrides:Record<string,unknown>={})=>
  ({label,requirement_level:'nice_to_have',category:'skill',weight:1,source:'manual',...overrides})

async function save(client:typeof owner,items:unknown[],jobId=JOB,organizationId=ORG){
  return client.rpc('replace_job_requirements',{p_organization_id:organizationId,p_job_id:jobId,p_items:items})
}

async function currentRequirements(client:typeof owner){
  const result=await client.from('job_requirements').select('id,label,requirement_level,weight,sort_order,source')
    .eq('organization_id',ORG).eq('job_id',JOB).order('sort_order',{ascending:true})
  expect(result.error).toBeNull()
  return result.data||[]
}

async function jobUpdatedAt(){
  const result=await service.from('jobs').select('updated_at').eq('id',JOB).single()
  if(result.error)throw result.error
  return result.data.updated_at as string
}

beforeAll(async()=>{
  const signIns=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
    sourcer.auth.signInWithPassword({email:'sourcer@northstar.local',password:'LocalTest!123'}),
    rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'}),
  ])
  signIns.forEach((result)=>{if(result.error)throw result.error})
})

afterAll(async()=>{
  await service.from('job_requirements').delete().eq('organization_id',ORG).eq('job_id',JOB)
})

describe('writing a requirement set',()=>{
  it('replaces the whole ordered list and reports how many rows it stored',async()=>{
    const result=await save(consultant,[
      item('10+ years commercial leadership',{requirement_level:'must_have',weight:3,category:'experience'}),
      item('Energy sector experience',{weight:2}),
    ])
    expect(result.error).toBeNull()
    expect(result.data).toBe(2)
    const rows=await currentRequirements(consultant)
    expect(rows.map((row)=>row.label)).toEqual(['10+ years commercial leadership','Energy sector experience'])
    expect(rows.map((row)=>row.sort_order)).toEqual([0,1])
    expect(rows[0]?.requirement_level).toBe('must_have')
  })

  it('replaces rather than appends, so a removed requirement is really gone',async()=>{
    await save(consultant,[item('Only remaining requirement')])
    const rows=await currentRequirements(consultant)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.label).toBe('Only remaining requirement')
  })

  it('accepts an empty list, which is how a recruiter clears the set',async()=>{
    const result=await save(consultant,[])
    expect(result.error).toBeNull()
    expect(result.data).toBe(0)
    expect(await currentRequirements(consultant)).toHaveLength(0)
  })

  it('skips a blank label instead of storing an unassessable row',async()=>{
    const result=await save(consultant,[item('Real requirement'),item('   ')])
    expect(result.error).toBeNull()
    expect(result.data).toBe(1)
  })

  /* Clamped, not rejected: an out-of-range weight is a loose number in a form, and refusing the whole
   * save over it would discard the recruiter's other edits. */
  it('clamps a weight outside 0-10 rather than refusing the save',async()=>{
    await save(consultant,[item('Heavily weighted',{weight:97}),item('Negatively weighted',{weight:-5})])
    const rows=await currentRequirements(consultant)
    expect(Number(rows[0]?.weight)).toBe(10)
    expect(Number(rows[1]?.weight)).toBe(0)
  })

  it('refuses more than forty requirements', async()=>{
    const many=Array.from({length:41},(_,index)=>item(`Requirement number ${index}`))
    const result=await save(consultant,many)
    expect(result.error?.message).toContain('too_many_requirements')
  })

  it('refuses a job in another workspace',async()=>{
    const result=await save(consultant,[item('Cross-org requirement')],JOB,RIVAL_ORG)
    expect(result.error).not.toBeNull()
  })
})

describe('who may write',()=>{
  it('refuses a member with jobs.read but not jobs.write',async()=>{
    const result=await save(sourcer,[item('Sourcer requirement')])
    expect(result.error?.message).toContain('permission_denied')
  })

  it('still lets that member read the set',async()=>{
    await save(consultant,[item('Readable requirement')])
    const rows=await currentRequirements(sourcer)
    expect(rows.map((row)=>row.label)).toContain('Readable requirement')
  })
})

describe('workspace isolation',()=>{
  it('hides one workspace’s requirements from another',async()=>{
    await save(consultant,[item('Northstar only')])
    const seen=await rival.from('job_requirements').select('id,label')
    expect(seen.error).toBeNull()
    expect(seen.data||[]).toHaveLength(0)
  })

  /* The composite foreign key against jobs(id,organization_id). Without it, a direct insert could
   * attach a requirement to a job in another workspace and RLS alone would let the owning org read
   * it as their own. */
  it('cannot attach a requirement to a job in a different organization',async()=>{
    const result=await service.from('job_requirements').insert({
      organization_id:RIVAL_ORG,job_id:JOB,label:'Smuggled requirement',
    })
    expect(result.error).not.toBeNull()
  })
})

describe('the profile cache and staleness signal',()=>{
  it('bumps the job’s updated_at when a requirement is saved',async()=>{
    await save(consultant,[item('Baseline requirement')])
    const before=await jobUpdatedAt()
    // The trigger uses now(), which is the transaction timestamp, so two saves inside one statement
    // clock would compare equal. A real gap is what a recruiter's second edit actually looks like.
    await new Promise((resolve)=>setTimeout(resolve,1100))
    await save(consultant,[item('Baseline requirement'),item('Newly added requirement')])
    expect(new Date(await jobUpdatedAt()).getTime()).toBeGreaterThan(new Date(before).getTime())
  })

  it('bumps it on a direct update and on a delete, not only through the RPC',async()=>{
    await save(consultant,[item('Directly edited requirement')])
    const rows=await currentRequirements(consultant)
    const target=rows[0]
    if(!target)throw new Error('the requirement fixture was not stored')

    const beforeUpdate=await jobUpdatedAt()
    await new Promise((resolve)=>setTimeout(resolve,1100))
    const updated=await service.from('job_requirements').update({weight:5}).eq('id',target.id)
    expect(updated.error).toBeNull()
    expect(new Date(await jobUpdatedAt()).getTime()).toBeGreaterThan(new Date(beforeUpdate).getTime())

    const beforeDelete=await jobUpdatedAt()
    await new Promise((resolve)=>setTimeout(resolve,1100))
    const removed=await service.from('job_requirements').delete().eq('id',target.id)
    expect(removed.error).toBeNull()
    expect(new Date(await jobUpdatedAt()).getTime()).toBeGreaterThan(new Date(beforeDelete).getTime())
  })
})
