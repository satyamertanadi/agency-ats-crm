import { createClient } from '@supabase/supabase-js'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const CANDIDATE='70000000-0000-0000-0000-000000000001' // seeded 'Aisha Rahman', has a candidate_private_details row

const owner=createClient(url,anon,{auth:{persistSession:false}})
const bd=createClient(url,anon,{auth:{persistSession:false}})
let bdRoleId=''
let ownerId=''

// The regression this guards against (F5 in the audit): candidate_private_write was a FOR ALL
// policy gated on candidates.write, and a FOR ALL policy's USING clause satisfies SELECT too, since
// permissive policies OR together -- so candidates.write alone read everything
// candidates_private.read was supposed to gate. Every seeded default role bundles the two
// permissions, which is why this was invisible until a role is built without that bundling --
// custom roles are a supported, client-reachable feature (roles.manage), so this is not a
// hypothetical. The seeded 'bd' (Business Development) role has neither candidates.write nor
// candidates_private.read; granting it only the former reproduces the exact shape the finding
// describes.
//
// One consequence of the fix worth asserting explicitly: Postgres requires a row to pass a table's
// SELECT policy, not just its UPDATE/DELETE policy, before UPDATE/DELETE can locate that row (it has
// to find the row via a SELECT-shaped scan first). So splitting the write policy off the read one
// means candidates.write alone can INSERT a new private-details row but cannot UPDATE or DELETE an
// existing one -- only candidates_private.read unlocks that. See docs/security-and-rls.md.
beforeAll(async()=>{
  const results=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    bd.auth.signInWithPassword({email:'bd@northstar.local',password:'LocalTest!123'}),
  ])
  const failure=results.find((result)=>result.error)
  if(failure?.error)throw failure.error
  ownerId=results[0].data.user?.id||''
  if(!ownerId)throw new Error('Owner user id is required')
  const role=await owner.from('roles').select('id').eq('organization_id',NORTHSTAR).eq('role_key','bd').single()
  expect(role.error).toBeNull()
  bdRoleId=role.data?.id||''
  if(!bdRoleId)throw new Error('Seeded bd role is required')
  const grant=await owner.from('role_permissions').insert({role_id:bdRoleId,permission_key:'candidates.write'})
  expect(grant.error).toBeNull()
})

afterAll(async()=>{if(bdRoleId)await owner.from('role_permissions').delete().eq('role_id',bdRoleId).eq('permission_key','candidates.write')})

describe('candidates.write does not imply candidates_private.read',()=>{
  it('cannot read candidate_private_details with only candidates.write',async()=>{
    const result=await bd.from('candidate_private_details').select('email,phone').eq('candidate_id',CANDIDATE)
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })
  it('can insert a new candidate_private_details row with candidates.write alone',async()=>{
    const candidate=await owner.from('candidates').insert({organization_id:NORTHSTAR,full_name:'Private Details Insert Probe',status:'active',created_by:ownerId}).select('id').single()
    expect(candidate.error).toBeNull()
    const newCandidateId=candidate.data?.id as string
    const insert=await bd.from('candidate_private_details').insert({candidate_id:newCandidateId,organization_id:NORTHSTAR,work_authorization:'RLS split-policy insert check'})
    expect(insert.error).toBeNull()
    const confirmed=await owner.from('candidate_private_details').select('work_authorization').eq('candidate_id',newCandidateId).single()
    expect(confirmed.data?.work_authorization).toBe('RLS split-policy insert check')
    await owner.from('candidates').delete().eq('id',newCandidateId)
  })

  it('cannot update or delete an existing candidate_private_details row with candidates.write alone',async()=>{
    const update=await bd.from('candidate_private_details').update({work_authorization:'RLS split-policy update check'}).eq('candidate_id',CANDIDATE)
    expect(update.error).toBeNull() // RLS silently excludes the row rather than erroring
    const unchanged=await owner.from('candidate_private_details').select('work_authorization').eq('candidate_id',CANDIDATE).single()
    expect(unchanged.data?.work_authorization).not.toBe('RLS split-policy update check')

    const remove=await bd.from('candidate_private_details').delete().eq('candidate_id',CANDIDATE)
    expect(remove.error).toBeNull()
    const stillThere=await owner.from('candidate_private_details').select('candidate_id').eq('candidate_id',CANDIDATE).single()
    expect(stillThere.error).toBeNull()
  })
})
