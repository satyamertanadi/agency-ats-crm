import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon||!serviceKey)throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required; retention tests must not silently skip.')

const ORGANIZATION='30000000-0000-0000-0000-000000000001'
const owner=createClient(url,anon,{auth:{persistSession:false}})
const admin=createClient(url,serviceKey,{auth:{persistSession:false}})
let candidateId=''
let auditRoleId=''
let auditMemberId=''

beforeAll(async()=>{
  const signedIn=await owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'})
  if(signedIn.error)throw signedIn.error
})

afterAll(async()=>{
  if(auditRoleId&&auditMemberId)await admin.from('member_roles').delete().eq('member_id',auditMemberId).eq('role_id',auditRoleId)
  if(auditRoleId)await admin.from('role_permissions').delete().eq('role_id',auditRoleId)
  if(auditRoleId)await admin.from('roles').delete().eq('id',auditRoleId)
  if(candidateId)await admin.from('candidates').delete().eq('id',candidateId)
})

describe('candidate retention and immutable audit evidence',()=>{
  it('honours legal hold, anonymizes when due, and rejects audit mutation',async()=>{
    const created=await owner.rpc('create_candidate_with_profile',{p_organization_id:ORGANIZATION,p_candidate:{full_name:'Retention Test Candidate',status:'active'},p_private:{email:`retention-${crypto.randomUUID()}@example.com`,phone:'+65 8999 0000',consent_status:'granted'},p_employment:[{company_name:'Private Employer',title:'Director',is_current:true}],p_education:[],p_languages:[],p_skills:[]})
    expect(created.error).toBeNull()
    candidateId=String(created.data)

    const held=await owner.rpc('set_candidate_legal_hold',{p_organization_id:ORGANIZATION,p_candidate_id:candidateId,p_legal_hold:true,p_reason:'Active regulatory request'})
    expect(held.error).toBeNull()
    const future=new Date(Date.now()+121*31*24*60*60*1000).toISOString()
    const heldPreview=await admin.rpc('list_candidates_due_for_retention',{p_limit:500,p_as_of:future})
    expect(heldPreview.error).toBeNull()
    expect((heldPreview.data||[]).some((row)=>row.candidate_id===candidateId)).toBe(false)

    const released=await owner.rpc('set_candidate_legal_hold',{p_organization_id:ORGANIZATION,p_candidate_id:candidateId,p_legal_hold:false,p_reason:'Regulatory request closed'})
    expect(released.error).toBeNull()
    const due=await admin.rpc('list_candidates_due_for_retention',{p_limit:500,p_as_of:future})
    expect(due.error).toBeNull()
    const target=(due.data||[]).find((row)=>row.candidate_id===candidateId)
    expect(target).toBeDefined()
    expect(target?.storage_paths).toEqual([])

    const retained=await admin.rpc('anonymize_candidate_for_retention',{p_candidate_id:candidateId,p_removed_storage_paths:[],p_as_of:future})
    expect(retained.error).toBeNull()
    const candidate=await admin.from('candidates').select('full_name,status,deleted_at,candidate_private_details(email,phone,consent_status,legal_hold)').eq('id',candidateId).single()
    expect(candidate.error).toBeNull()
    expect(candidate.data?.full_name).toMatch(/^Retained candidate /)
    expect(candidate.data?.status).toBe('archived')
    expect(candidate.data?.deleted_at).not.toBeNull()
    const privateRow=Array.isArray(candidate.data?.candidate_private_details)?candidate.data?.candidate_private_details[0]:candidate.data?.candidate_private_details
    expect(privateRow).toMatchObject({email:null,phone:null,consent_status:'expired',legal_hold:false})

    const audit=await owner.from('audit_logs').select('id,action,metadata').eq('organization_id',ORGANIZATION).eq('entity_id',candidateId).order('id',{ascending:false})
    expect(audit.error).toBeNull()
    expect((audit.data||[]).map((row)=>row.action)).toEqual(expect.arrayContaining(['candidate.legal_hold_set','candidate.legal_hold_removed','candidate.retained']))
    const targetAudit=audit.data?.[0]
    if(!targetAudit)throw new Error('An audit row is required for the tamper check.')
    const tamper=await admin.from('audit_logs').update({action:'tampered'}).eq('id',targetAudit.id)
    expect(tamper.error?.message).toContain('audit_logs_are_immutable')
  })

  it('records role-permission and member-role changes without copying their values',async()=>{
    const member=await owner.from('organization_members').select('id').eq('organization_id',ORGANIZATION).single()
    expect(member.error).toBeNull()
    auditMemberId=String(member.data?.id)

    const suffix=crypto.randomUUID().slice(0,8)
    const role=await owner.from('roles').insert({organization_id:ORGANIZATION,name:`Audit test ${suffix}`,role_key:`audit_test_${suffix}`,is_system:false}).select('id').single()
    expect(role.error).toBeNull()
    auditRoleId=String(role.data?.id)

    const permission=await owner.from('role_permissions').insert({role_id:auditRoleId,permission_key:'candidates.read'})
    expect(permission.error).toBeNull()
    const assignment=await owner.from('member_roles').insert({member_id:auditMemberId,role_id:auditRoleId})
    expect(assignment.error).toBeNull()

    const accessAudit=await owner.from('audit_logs').select('action,entity_id,metadata').eq('organization_id',ORGANIZATION)
      .in('action',['role_permissions.insert','member_roles.insert'])
      .in('entity_id',[auditRoleId,auditMemberId])
    expect(accessAudit.error).toBeNull()
    expect(accessAudit.data).toEqual(expect.arrayContaining([
      expect.objectContaining({action:'role_permissions.insert',entity_id:auditRoleId,metadata:expect.objectContaining({after_hash:expect.any(String)})}),
      expect.objectContaining({action:'member_roles.insert',entity_id:auditMemberId,metadata:expect.objectContaining({after_hash:expect.any(String)})}),
    ]))
    expect(JSON.stringify(accessAudit.data)).not.toContain('candidates.read')
  })
})
