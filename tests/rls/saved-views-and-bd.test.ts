import { createClient } from '@supabase/supabase-js'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const RIVAL='30000000-0000-0000-0000-000000000002'

const owner=createClient(url,anon,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})

const required=<T,>(value:T|null|undefined,what:string):T=>{if(value===null||value===undefined)throw new Error(`Seeded ${what} is required`);return value}
const memberId=async(client:typeof owner,organizationId:string)=>{
  const {data:{user}}=await client.auth.getUser()
  const member=await client.from('organization_members').select('id').eq('organization_id',organizationId).eq('user_id',required(user?.id,'user id')).single()
  expect(member.error).toBeNull()
  return required(member.data?.id,'member id') as string
}

let ownerMember='';let consultantMember='';const created:string[]=[]

beforeAll(async()=>{
  const results=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
    rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'}),
  ])
  const failure=results.find((result)=>result.error)
  if(failure?.error)throw failure.error
  ownerMember=await memberId(owner,NORTHSTAR)
  consultantMember=await memberId(consultant,NORTHSTAR)
})

afterAll(async()=>{if(created.length)await owner.from('saved_views').delete().in('id',created)})

const makeView=async(client:typeof owner,member:string,name:string,shared:boolean)=>{
  const result=await client.from('saved_views').insert({organization_id:NORTHSTAR,owner_member_id:member,resource:'candidates',name,filters:{status:'active'},columns:[],is_shared:shared}).select('id').single()
  expect(result.error).toBeNull()
  const id=required(result.data?.id,'saved view id') as string
  created.push(id)
  return id
}

/* The bulk RLS loop originally registered saved_views as ('saved_views','reports.read','reports.read'),
 * which let any holder of reports.read read AND write every colleague's views. These assert the
 * narrowed boundary: shared-or-own reads, owner-only writes. */
describe('saved view ownership',()=>{
  it('keeps a personal view private to its owner',async()=>{
    const id=await makeView(owner,ownerMember,'Owner private view',false)
    const seen=await consultant.from('saved_views').select('id').eq('id',id)
    expect(seen.error).toBeNull()
    expect(seen.data).toEqual([])
  })

  it('lets the workspace read a view its owner chose to share',async()=>{
    const id=await makeView(owner,ownerMember,'Owner shared view',true)
    const seen=await consultant.from('saved_views').select('id').eq('id',id)
    expect(seen.error).toBeNull()
    expect(seen.data).toEqual([{id}])
  })

  // Readable is not editable. A shared view stays under its author's control.
  it('refuses to let a colleague rename a shared view',async()=>{
    const id=await makeView(owner,ownerMember,'Owner shared rename target',true)
    const result=await consultant.from('saved_views').update({name:'Hijacked'}).eq('id',id).select('id')
    expect(result.data??[]).toEqual([])
    const after=await owner.from('saved_views').select('name').eq('id',id).single()
    expect(after.data?.name).toBe('Owner shared rename target')
  })

  it('refuses to let a colleague delete a shared view',async()=>{
    const id=await makeView(owner,ownerMember,'Owner shared delete target',true)
    const result=await consultant.from('saved_views').delete().eq('id',id).select('id')
    expect(result.data??[]).toEqual([])
    const after=await owner.from('saved_views').select('id').eq('id',id)
    expect(after.data).toEqual([{id}])
  })

  it('refuses a view saved under someone else’s name',async()=>{
    const result=await consultant.from('saved_views').insert({organization_id:NORTHSTAR,owner_member_id:ownerMember,resource:'candidates',name:'Forged owner',filters:{},columns:[],is_shared:false})
    expect(result.error).not.toBeNull()
  })

  it('lets a consultant manage their own view end to end',async()=>{
    const id=await makeView(consultant,consultantMember,'Consultant own view',false)
    const renamed=await consultant.from('saved_views').update({name:'Consultant renamed'}).eq('id',id).select('id')
    expect(renamed.data).toEqual([{id}])
    const removed=await consultant.from('saved_views').delete().eq('id',id).select('id')
    expect(removed.data).toEqual([{id}])
    created.splice(created.indexOf(id),1)
  })

  it('will not leak a shared view across tenants',async()=>{
    const id=await makeView(owner,ownerMember,'Owner cross tenant view',true)
    const seen=await rival.from('saved_views').select('id').eq('id',id)
    expect(seen.data??[]).toEqual([])
  })
})

describe('business development stage',()=>{
  const company=async()=>{
    const result=await owner.from('companies').select('id,business_development_stage').eq('organization_id',NORTHSTAR).is('deleted_at',null).limit(1).single()
    expect(result.error).toBeNull()
    return required(result.data,'seeded company')
  }

  it('records the move and journals it to the activity feed',async()=>{
    const target=await company()
    const result=await owner.rpc('set_company_bd_stage',{p_organization_id:NORTHSTAR,p_company_id:target.id,p_stage:'pitching'})
    expect(result.error).toBeNull()
    const activity=await owner.from('activities').select('subject,activity_links!inner(company_id)').eq('organization_id',NORTHSTAR).eq('activity_links.company_id',target.id).order('occurred_at',{ascending:false}).limit(1)
    expect(activity.error).toBeNull()
    expect(activity.data?.[0]?.subject).toContain('BD stage')
    await owner.rpc('set_company_bd_stage',{p_organization_id:NORTHSTAR,p_company_id:target.id,p_stage:target.business_development_stage})
  })

  it('refuses a stage outside the product vocabulary',async()=>{
    const target=await company()
    const result=await owner.rpc('set_company_bd_stage',{p_organization_id:NORTHSTAR,p_company_id:target.id,p_stage:'definitely_not_a_stage'})
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain('invalid_bd_stage')
  })

  it('will not move an account in a foreign tenant',async()=>{
    const target=await company()
    const result=await rival.rpc('set_company_bd_stage',{p_organization_id:RIVAL,p_company_id:target.id,p_stage:'won'})
    expect(result.error).not.toBeNull()
  })

  it('excludes foreign tenants from the pipeline aggregate',async()=>{
    const mine=await owner.rpc('list_company_pipeline',{p_organization_id:NORTHSTAR})
    expect(mine.error).toBeNull()
    expect((mine.data??[]).length).toBeGreaterThan(0)
    const theirs=await rival.rpc('list_company_pipeline',{p_organization_id:NORTHSTAR})
    expect(theirs.data??[]).toEqual([])
  })
})
