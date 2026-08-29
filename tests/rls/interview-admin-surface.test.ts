import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeEach,describe,expect,it} from 'vitest'

/* The administration surface: the workspace switches and the agency core rubric.
 *
 * The core rubric had no creation path at all before this, which made the whole analysis pipeline
 * unreachable in a real workspace -- a desk could set up a job, import a transcript and confirm its
 * speakers, and only then be refused. So the first thing proved here is simply that one can be made
 * and activated.
 *
 * The second is the permission boundary. Configuring this feature is interview_intelligence.configure,
 * not organization.manage: running a workspace is not the same authority as deciding that every
 * interview on the desk gets read by a model, and writing the switches through the settings table
 * would have quietly used the wrong grant.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anonKey=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anonKey)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed admin fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const CONSULTANT_MEMBER='40000000-0000-0000-0000-000000000003'
const SOURCER_MEMBER='40000000-0000-0000-0000-000000000004'
const PASSWORD='LocalTest!123'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})
const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

async function signIn(email:string){
  const client=createClient(url,anonKey,{auth:{persistSession:false}})
  const {error}=await client.auth.signInWithPassword({email,password:PASSWORD})
  if(error)throw new Error(`${email}: ${error.message}`)
  return client
}

const STARTER=[
  {dimension:'essential_coverage',item_type:'quality_criterion',label:'Covered the must-haves',
   question_text:null,evidence_expected:'Each must-have was raised.',requirement_level:'must_have'},
  {dimension:'question_quality',item_type:'quality_criterion',label:'Asked for specific examples',
   question_text:null,evidence_expected:'A concrete instance was requested.',requirement_level:'must_have'},
]

beforeEach(async()=>{
  await service.from('interview_rubrics').delete().eq('organization_id',ORG).eq('rubric_type','core')
  await service.from('organization_settings').update({
    interview_intelligence_enabled:true,interview_rubric_generation_enabled:true,
    interview_meet_auto_import_enabled:false,interview_auto_analysis_enabled:false,
    interview_digest_enabled:false,interview_digest_local_time:'17:30',interview_digest_skip_empty:true,
  }).eq('organization_id',ORG)
})

afterAll(async()=>{
  await service.from('interview_rubrics').delete().eq('organization_id',ORG).eq('rubric_type','core')
  await service.from('interview_digest_recipients').delete().eq('organization_id',ORG)
  await service.from('organization_settings').update({
    interview_intelligence_enabled:false,interview_rubric_generation_enabled:true,
    interview_digest_enabled:false,interview_digest_local_time:'17:30',
  }).eq('organization_id',ORG)
})

describe('creating the agency core rubric',()=>{
  it('creates a draft with no job attached, which nothing else could do',async()=>{
    /* create_interview_rubric_draft raises job_not_found without a job and hardcodes
     * rubric_type='job', so before this function existed there was no path -- UI or RPC -- to the
     * rubric every analysis requires. */
    const owner=await signIn('owner@northstar.local')
    const created=await owner.rpc('create_interview_core_rubric_draft',{
      p_organization_id:ORG,p_name:'Agency core rubric',p_items:STARTER,
    })
    expect(created.error).toBeNull()

    const rubric=await service.from('interview_rubrics')
      .select('id,rubric_type,job_id,status,version').eq('id',created.data as string).single()
    const row=required(rubric.data,'rubric')
    expect(row.rubric_type).toBe('core')
    expect(row.job_id).toBeNull()
    // Draft, never active: a rubric becomes the one analyses read through one function only.
    expect(row.status).toBe('draft')
    expect(row.version).toBe(1)

    const items=await service.from('interview_rubric_items').select('id').eq('rubric_id',row.id)
    expect(items.data).toHaveLength(2)
  })

  it('refuses an empty rubric',async()=>{
    // An empty rubric would let an analysis report full coverage of nothing.
    const owner=await signIn('owner@northstar.local')
    const created=await owner.rpc('create_interview_core_rubric_draft',{
      p_organization_id:ORG,p_name:'Empty',p_items:[],
    })
    expect(created.error?.message).toContain('interview_rubric_empty')
  })

  it('refuses a second draft while one is already open',async()=>{
    /* Almost always somebody opening the settings page twice. Two drafts with nothing to tell them
     * apart is how the wrong one gets activated. */
    const owner=await signIn('owner@northstar.local')
    await owner.rpc('create_interview_core_rubric_draft',{p_organization_id:ORG,p_name:'First',p_items:STARTER})
    const second=await owner.rpc('create_interview_core_rubric_draft',{p_organization_id:ORG,p_name:'Second',p_items:STARTER})
    expect(second.error?.message).toContain('interview_core_rubric_draft_exists')
  })

  it('refuses a consultant, who may use the feature but not configure it',async()=>{
    const consultant=await signIn('consultant@northstar.local')
    const created=await consultant.rpc('create_interview_core_rubric_draft',{
      p_organization_id:ORG,p_name:'Not mine to make',p_items:STARTER,
    })
    expect(created.error?.message).toContain('permission_denied')
  })

  it('activates through the same function job blueprints use, archiving the previous version',async()=>{
    const owner=await signIn('owner@northstar.local')
    const first=await owner.rpc('create_interview_core_rubric_draft',{p_organization_id:ORG,p_name:'v1',p_items:STARTER})
    const firstId=first.data as string
    const activated=await owner.rpc('activate_interview_rubric',{p_organization_id:ORG,p_rubric_id:firstId})
    expect(activated.error).toBeNull()

    const second=await owner.rpc('create_interview_core_rubric_draft',{p_organization_id:ORG,p_name:'v2',p_items:STARTER})
    const secondId=second.data as string
    await owner.rpc('activate_interview_rubric',{p_organization_id:ORG,p_rubric_id:secondId})

    const rows=await service.from('interview_rubrics').select('id,status,version')
      .eq('organization_id',ORG).eq('rubric_type','core')
    const byId=new Map((rows.data||[]).map((row)=>[row.id,row]))
    // Exactly one active core rubric, and the superseded one is kept rather than deleted: past
    // assessments cite the rubric they were judged against.
    expect(required(byId.get(firstId),'v1').status).toBe('archived')
    expect(required(byId.get(secondId),'v2').status).toBe('active')
    expect(required(byId.get(secondId),'v2').version).toBe(2)
  })
})

describe('discarding a draft',()=>{
  it('discards a draft and leaves no orphaned criteria',async()=>{
    const owner=await signIn('owner@northstar.local')
    const created=await owner.rpc('create_interview_core_rubric_draft',{p_organization_id:ORG,p_name:'Draft',p_items:STARTER})
    const rubricId=created.data as string

    const discarded=await owner.rpc('discard_interview_core_rubric_draft',{p_organization_id:ORG,p_rubric_id:rubricId})
    expect(discarded.error).toBeNull()

    const items=await service.from('interview_rubric_items').select('id').eq('rubric_id',rubricId)
    expect(items.data).toEqual([])
  })

  it('refuses to discard an activated rubric',async()=>{
    /* An assessment explains itself against the rubric it was judged by. Deleting one would leave
     * conclusions about named people with nothing behind them. */
    const owner=await signIn('owner@northstar.local')
    const created=await owner.rpc('create_interview_core_rubric_draft',{p_organization_id:ORG,p_name:'Live',p_items:STARTER})
    const rubricId=created.data as string
    await owner.rpc('activate_interview_rubric',{p_organization_id:ORG,p_rubric_id:rubricId})

    const discarded=await owner.rpc('discard_interview_core_rubric_draft',{p_organization_id:ORG,p_rubric_id:rubricId})
    expect(discarded.error?.message).toContain('interview_rubric_not_a_draft')

    const still=await service.from('interview_rubrics').select('status').eq('id',rubricId).single()
    expect(required(still.data,'rubric').status).toBe('active')
  })
})

describe('the workspace switches',()=>{
  it('changes only the switches it was given',async()=>{
    /* Null means "leave alone", so a panel saving one toggle cannot blank another it never showed --
     * and a client that has not been redeployed cannot erase a setting it does not know about. */
    const owner=await signIn('owner@northstar.local')
    const updated=await owner.rpc('update_interview_intelligence_settings',{
      p_organization_id:ORG,p_digest_enabled:true,
    })
    expect(updated.error).toBeNull()

    const row=await service.from('organization_settings')
      .select('interview_digest_enabled,interview_intelligence_enabled,interview_digest_local_time')
      .eq('organization_id',ORG).single()
    const settings=required(row.data,'settings')
    expect(settings.interview_digest_enabled).toBe(true)
    expect(settings.interview_intelligence_enabled).toBe(true)
    expect(settings.interview_digest_local_time).toBe('17:30:00')
  })

  it('saves the digest time in the workspace clock, not UTC',async()=>{
    const owner=await signIn('owner@northstar.local')
    await owner.rpc('update_interview_intelligence_settings',{p_organization_id:ORG,p_digest_local_time:'08:15'})
    const row=await service.from('organization_settings')
      .select('interview_digest_local_time').eq('organization_id',ORG).single()
    expect(required(row.data,'settings').interview_digest_local_time).toBe('08:15:00')
  })

  it('refuses a consultant, and changes nothing',async()=>{
    /* The check that matters: this is interview_intelligence.configure, not organization.manage.
     * Writing through the settings table would have used the wrong grant. */
    const consultant=await signIn('consultant@northstar.local')
    const attempt=await consultant.rpc('update_interview_intelligence_settings',{
      p_organization_id:ORG,p_auto_analysis_enabled:true,
    })
    expect(attempt.error?.message).toContain('permission_denied')

    const row=await service.from('organization_settings')
      .select('interview_auto_analysis_enabled').eq('organization_id',ORG).single()
    expect(required(row.data,'settings').interview_auto_analysis_enabled).toBe(false)
  })

  it('reads back the switches and whether a core rubric is active',async()=>{
    const owner=await signIn('owner@northstar.local')
    const before=await owner.rpc('get_interview_intelligence_settings',{p_organization_id:ORG})
    expect(before.error).toBeNull()
    expect((before.data as {core_rubric_id:string|null}).core_rubric_id).toBeNull()

    const created=await owner.rpc('create_interview_core_rubric_draft',{p_organization_id:ORG,p_name:'v1',p_items:STARTER})
    const rubricId=created.data as string

    const drafted=await owner.rpc('get_interview_intelligence_settings',{p_organization_id:ORG})
    // A waiting draft is reported separately from an active one: they need different actions.
    expect((drafted.data as {core_rubric_draft_id:string|null}).core_rubric_draft_id).toBe(rubricId)
    expect((drafted.data as {core_rubric_id:string|null}).core_rubric_id).toBeNull()

    await owner.rpc('activate_interview_rubric',{p_organization_id:ORG,p_rubric_id:rubricId})
    const active=await owner.rpc('get_interview_intelligence_settings',{p_organization_id:ORG})
    expect((active.data as {core_rubric_id:string|null}).core_rubric_id).toBe(rubricId)
    expect((active.data as {core_rubric_draft_id:string|null}).core_rubric_draft_id).toBeNull()
  })
})

describe('digest recipients through the panel',()=>{
  it('adds, lists and removes a named member',async()=>{
    const owner=await signIn('owner@northstar.local')
    await owner.rpc('add_interview_digest_recipient',{p_organization_id:ORG,p_member_id:CONSULTANT_MEMBER})

    const listed=await owner.from('interview_digest_recipients').select('member_id').eq('organization_id',ORG)
    expect(listed.data?.map((row)=>row.member_id)).toContain(CONSULTANT_MEMBER)

    const removed=await owner.rpc('remove_interview_digest_recipient',{p_organization_id:ORG,p_member_id:CONSULTANT_MEMBER})
    expect(removed.data).toBe(1)

    const after=await service.from('interview_digest_recipients').select('member_id').eq('organization_id',ORG)
    expect(after.data).toEqual([])
  })

  it('refuses a suspended member',async()=>{
    const owner=await signIn('owner@northstar.local')
    const suspended=await service.from('organization_members').update({status:'suspended'}).eq('id',SOURCER_MEMBER)
    if(suspended.error)throw new Error(suspended.error.message)
    const attempt=await owner.rpc('add_interview_digest_recipient',{p_organization_id:ORG,p_member_id:SOURCER_MEMBER})
    const restored=await service.from('organization_members').update({status:'active'}).eq('id',SOURCER_MEMBER)
    if(restored.error)throw new Error(restored.error.message)
    expect(attempt.error?.message).toContain('member_not_active')
  })
})
