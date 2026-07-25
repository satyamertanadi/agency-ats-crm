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

// The regression this guards against (F5 in the audit): candidate_private_write was a FOR ALL
// policy gated on candidates.write, and a FOR ALL policy's USING clause satisfies SELECT too, since
// permissive policies OR together -- so candidates.write alone read everything
// candidates_private.read was supposed to gate. Every seeded default role bundles the two
// permissions, which is why this was invisible until a role is built without that bundling --
// custom roles are a supported, client-reachable feature (roles.manage), so this is not a
// hypothetical. The seeded 'bd' (Business Development) role has neither candidates.write nor
// candidates_private.read; granting it only the former reproduces the exact shape the finding
// describes.
beforeAll(async()=>{
  const results=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    bd.auth.signInWithPassword({email:'bd@northstar.local',password:'LocalTest!123'}),
  ])
  const failure=results.find((result)=>result.error)
  if(failure?.error)throw failure.error
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
  it('can still write candidate_private_details with candidates.write',async()=>{
    const update=await bd.from('candidate_private_details').update({work_authorization:'RLS split-policy check'}).eq('candidate_id',CANDIDATE).select('candidate_id')
    expect(update.error).toBeNull()
    expect(update.data?.length).toBe(1)
  })
})
