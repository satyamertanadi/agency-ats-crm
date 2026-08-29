import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeEach,describe,expect,it} from 'vitest'

/* Capturing a client company from the LinkedIn extension.
 *
 * The extension could already save a candidate or a contact, but a contact needs a company that
 * already exists in the ATS -- so sourcing a new client meant leaving the extension, creating the
 * company by hand, and coming back. This is the branch that closes that.
 *
 * The rule worth protecting: a company record carries commercial judgement -- account status, BD
 * stage, owner, notes -- and re-capturing from LinkedIn must never overwrite any of it.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anonKey=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anonKey)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to clean up captured companies.')

const ORG='30000000-0000-0000-0000-000000000001'
const PASSWORD='LocalTest!123'
const LINKEDIN='https://www.linkedin.com/company/swiss-belhotel-international/'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})
const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

async function signIn(email:string){
  const client=createClient(url,anonKey,{auth:{persistSession:false}})
  const {error}=await client.auth.signInWithPassword({email,password:PASSWORD})
  if(error)throw new Error(`${email}: ${error.message}`)
  return client
}

const capture=(client:ReturnType<typeof createClient>,payload:Record<string,unknown>)=>
  client.rpc('capture_prospect',{p_organization_id:ORG,p_kind:'client',p_payload:payload})

const CAPTURED=['Swiss-Belhotel International','Swiss-Belhotel Renamed','Hand Made Client','Tiny']

beforeEach(async()=>{
  for(const name of CAPTURED)await service.from('companies').delete().eq('organization_id',ORG).eq('name',name)
  await service.from('companies').delete().eq('organization_id',ORG).eq('linkedin_url',LINKEDIN)
})

afterAll(async()=>{
  for(const name of CAPTURED)await service.from('companies').delete().eq('organization_id',ORG).eq('name',name)
  await service.from('companies').delete().eq('organization_id',ORG).eq('linkedin_url',LINKEDIN)
})

describe('creating a client',()=>{
  it('saves the company page fields and nothing commercial',async()=>{
    const owner=await signIn('owner@northstar.local')
    const result=await capture(owner,{
      name:'Swiss-Belhotel International',
      industry:'Hospitality',
      website:'https://www.swiss-belhotel.com',
      location:'Hong Kong',
      company_size:'1,001-5,000 employees',
      linkedin_url:LINKEDIN,
      source:'LinkedIn',
    })
    expect(result.error).toBeNull()
    expect((result.data as {kind:string;deduped:boolean}).kind).toBe('client')
    expect((result.data as {deduped:boolean}).deduped).toBe(false)

    const row=await service.from('companies')
      .select('name,industry,website,location,company_size,linkedin_url,account_status,business_development_stage,owner_member_id')
      .eq('id',(result.data as {id:string}).id).single()
    const company=required(row.data,'company')
    expect(company.industry).toBe('Hospitality')
    expect(company.company_size).toBe('1,001-5,000 employees')
    expect(company.linkedin_url).toBe(LINKEDIN)
    /* Sourcing a company is not the same as having won it, and guessing an owner puts somebody's
     * name on a pipeline entry they never agreed to. */
    expect(company.account_status).toBe('prospect')
    expect(company.business_development_stage).toBe('lead')
    expect(company.owner_member_id).toBeNull()
  })

  it('refuses a company with no usable name',async()=>{
    const owner=await signIn('owner@northstar.local')
    const blank=await capture(owner,{name:'   ',linkedin_url:LINKEDIN})
    expect(blank.error?.message).toContain('company_name_required')
    const tooShort=await capture(owner,{name:'X',linkedin_url:LINKEDIN})
    expect(tooShort.error?.message).toContain('company_name_required')
  })

  it('refuses a member without permission to write companies',async()=>{
    const sourcer=await signIn('sourcer@northstar.local')
    const attempt=await capture(sourcer,{name:'Tiny',linkedin_url:LINKEDIN})
    expect(attempt.error?.message).toContain('permission_denied')
  })
})

describe('re-capturing an existing client',()=>{
  it('recognises the same company by its LinkedIn URL, whatever the name says now',async()=>{
    /* The reason the URL is the primary key here: a company gets renamed, or the scrape reads a
     * slightly different string, and matching on name alone would create a duplicate client. */
    const owner=await signIn('owner@northstar.local')
    const first=await capture(owner,{name:'Swiss-Belhotel International',linkedin_url:LINKEDIN})
    const again=await capture(owner,{name:'Swiss-Belhotel Renamed',linkedin_url:LINKEDIN})

    expect((again.data as {deduped:boolean}).deduped).toBe(true)
    expect((again.data as {id:string}).id).toBe((first.data as {id:string}).id)
  })

  it('matches a company somebody created by hand, which has no URL',async()=>{
    const inserted=await service.from('companies').insert({
      organization_id:ORG,name:'Hand Made Client',created_by:'10000000-0000-0000-0000-000000000001',
    }).select('id').single()
    if(inserted.error)throw new Error(inserted.error.message)

    const owner=await signIn('owner@northstar.local')
    const captured=await capture(owner,{name:'hand made client',linkedin_url:LINKEDIN,industry:'Logistics'})
    expect((captured.data as {deduped:boolean}).deduped).toBe(true)
    expect((captured.data as {id:string}).id).toBe(required(inserted.data,'company').id)

    // And it gains the URL it did not have, so the next capture matches exactly.
    const row=await service.from('companies').select('linkedin_url,industry').eq('id',required(inserted.data,'company').id).single()
    expect(required(row.data,'row').linkedin_url).toBe(LINKEDIN)
    expect(required(row.data,'row').industry).toBe('Logistics')
  })

  it('never overwrites commercial judgement already recorded',async()=>{
    /* THE assertion. Somebody marks a company an active client, sets its BD stage and assigns an
     * owner. A colleague then re-captures it from LinkedIn. None of that may move. */
    const owner=await signIn('owner@northstar.local')
    const first=await capture(owner,{
      name:'Swiss-Belhotel International',linkedin_url:LINKEDIN,industry:'Hospitality',location:'Hong Kong',
    })
    const companyId=(first.data as {id:string}).id

    const curated=await service.from('companies').update({
      account_status:'active_client',
      business_development_stage:'won',
      owner_member_id:'40000000-0000-0000-0000-000000000003',
      industry:'Hotels and Resorts',
      location:'Bali, Indonesia',
    }).eq('id',companyId)
    if(curated.error)throw new Error(curated.error.message)

    await capture(owner,{
      name:'Swiss-Belhotel International',linkedin_url:LINKEDIN,
      industry:'Hospitality',location:'Hong Kong',company_size:'1,001-5,000 employees',
    })

    const row=await service.from('companies')
      .select('account_status,business_development_stage,owner_member_id,industry,location,company_size')
      .eq('id',companyId).single()
    const company=required(row.data,'company')
    expect(company.account_status).toBe('active_client')
    expect(company.business_development_stage).toBe('won')
    expect(company.owner_member_id).toBe('40000000-0000-0000-0000-000000000003')
    // Curated text is kept; only the genuinely empty field is filled.
    expect(company.industry).toBe('Hotels and Resorts')
    expect(company.location).toBe('Bali, Indonesia')
    expect(company.company_size).toBe('1,001-5,000 employees')
  })
})

describe('the other capture kinds still behave',()=>{
  it('rejects an unknown kind',async()=>{
    const owner=await signIn('owner@northstar.local')
    const attempt=await owner.rpc('capture_prospect',{
      p_organization_id:ORG,p_kind:'supplier',p_payload:{name:'Nope'},
    })
    expect(attempt.error?.message).toContain('invalid_kind')
  })

  it('still requires a person name for a candidate',async()=>{
    /* The name requirement moved inside the person branches when the client branch was added. This
     * checks the move did not drop it. */
    const owner=await signIn('owner@northstar.local')
    const attempt=await owner.rpc('capture_prospect',{
      p_organization_id:ORG,p_kind:'candidate',p_payload:{full_name:''},
    })
    expect(attempt.error?.message).toContain('full_name_required')
  })

  it('still requires a company for a contact',async()=>{
    const owner=await signIn('owner@northstar.local')
    const attempt=await owner.rpc('capture_prospect',{
      p_organization_id:ORG,p_kind:'contact',p_payload:{full_name:'Someone Real'},
    })
    expect(attempt.error?.message).toContain('company_required')
  })
})
