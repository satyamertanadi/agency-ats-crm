import {describe,expect,it} from 'vitest'
import {calendarConnectionSchema,candidateDetailSchema,companyPipelineRowSchema,documentLinkRowSchema,importBatchSchema,organizationInvitationSchema,roleSchema,savedViewSchema,submissionCandidateDocumentRowSchema,teamMemberSchema} from './commercialRepositorySchemas'

describe('commercialRepositorySchemas',()=>{
  it('accepts a team member row with a member_roles array and a nested single role',()=>{
    const row={
      id:'m1',organization_id:'o1',user_id:'u1',job_title:'Consultant',status:'active',is_vendor_support:false,
      profiles:{full_name:'Test User',email:'test@example.com'},
      member_roles:[{roles:{id:'r1',name:'Consultant',role_key:'consultant'}}],
    }
    expect(teamMemberSchema.safeParse(row).success).toBe(true)
  })

  it('accepts a role row with a role_permissions array',()=>{
    const row={id:'r1',name:'Consultant',role_key:'consultant',is_system:false,role_permissions:[{permission_key:'candidates.read'}]}
    expect(roleSchema.safeParse(row).success).toBe(true)
  })

  it('accepts an invitation row with a singular roles embed',()=>{
    const row={id:'i1',email:'a@example.com',role_id:'r1',expires_at:'2026-08-01T00:00:00Z',accepted_at:null,revoked_at:null,delivery_status:'sent',last_sent_at:'2026-07-20T00:00:00Z',roles:{name:'Consultant'}}
    expect(organizationInvitationSchema.safeParse(row).success).toBe(true)
  })

  it('accepts a calendar connection row',()=>{
    const row={id:'c1',organization_id:'o1',member_id:'m1',google_email:'a@gmail.com',calendar_id:'primary',status:'connected',connected_at:'2026-07-01T00:00:00Z',last_synced_at:null,last_error:null,scopes:['https://www.googleapis.com/auth/calendar.events']}
    expect(calendarConnectionSchema.safeParse(row).success).toBe(true)
  })

  it('accepts a company_pipeline row with bigint-ish counts arriving as numbers or strings',()=>{
    const row={
      id:'co1',name:'Acme',industry:null,location:null,account_status:'active_client',business_development_stage:'won',
      owner_member_id:null,owner_name:null,contact_count:'2',open_jobs:1,active_candidates:5,next_follow_up_at:null,
      last_activity_at:null,placements:0,terms_status:'active',fee_type:'percentage',fee_percentage:15,fixed_fee:null,
      currency:'IDR',guarantee_days:90,terms_effective_to:null,expected_open_fee:18_000_000,updated_at:'2026-07-20T00:00:00Z',
    }
    const result=companyPipelineRowSchema.safeParse(row)
    expect(result.success).toBe(true)
    if(result.success)expect(result.data.contact_count).toBe(2)
  })

  it('accepts a saved view row',()=>{
    const row={id:'v1',organization_id:'o1',owner_member_id:'m1',resource:'candidates',name:'My view',filters:{status:'active'},columns:['full_name','status'],is_shared:false,is_default:true,updated_at:'2026-07-20T00:00:00Z'}
    expect(savedViewSchema.safeParse(row).success).toBe(true)
  })

  it('accepts an import batch row',()=>{
    const row={id:'imp1',entity_type:'candidates',file_name:'candidates.csv',source_format:'csv',status:'completed',total_rows:10,valid_rows:9,failed_rows:1,validation_summary:{},reconciliation_summary:{},created_at:'2026-07-20T00:00:00Z',completed_at:'2026-07-20T00:05:00Z',rolled_back_at:null}
    expect(importBatchSchema.safeParse(row).success).toBe(true)
  })

  it('accepts a candidate detail row with extra select(*) columns passed through',()=>{
    const row={
      id:'c1',organization_id:'o1',full_name:'Test Candidate',current_company:null,current_position:null,location:null,
      linkedin_url:null,status:'active',source:null,availability:null,owner_member_id:null,created_at:'2026-07-01T00:00:00Z',
      updated_at:'2026-07-01T00:00:00Z',portfolio_url:null,notice_period_days:null,last_contacted_at:null,deleted_at:null,
      candidate_private_details:[{email:null,phone:null,current_salary:null,expected_salary:null,salary_currency:null}],
      candidate_employment:[{id:'e1',company_name:'Acme',title:'Engineer',started_on:null,ended_on:null,started_on_precision:null,ended_on_precision:null,is_current:true,summary:null,location:'Bali',extra_column_from_star_select:'kept'}],
      candidate_education:[],candidate_languages:[],candidate_skills:[],candidate_tags:[],
    }
    const result=candidateDetailSchema.safeParse(row)
    expect(result.success).toBe(true)
    if(result.success){
      const employment=result.data.candidate_employment as Array<Record<string,unknown>>
      expect(employment[0]?.location).toBe('Bali') // passthrough kept the un-modelled column
    }
  })

  it('accepts document_links rows with an array-wrapped documents embed',()=>{
    const row={documents:[{id:'d1',file_name:'cv.pdf',original_filename:'cv.pdf',mime_type:'application/pdf',storage_path:'x/y',size_bytes:1000,document_type:'resume',created_at:'2026-07-01T00:00:00Z',deleted_at:null}]}
    expect(documentLinkRowSchema.safeParse(row).success).toBe(true)
  })

  it('accepts a submission-candidate-documents row with a nested candidates+document_links shape',()=>{
    const row={
      id:'jc1',candidate_id:'c1',
      candidates:{id:'c1',full_name:'Test Candidate',current_company:null,current_position:null,
        document_links:[{documents:{id:'d1',file_name:'cv.pdf',original_filename:'cv.pdf',mime_type:'application/pdf',storage_path:'x/y',size_bytes:1000,created_at:'2026-07-01T00:00:00Z',deleted_at:null}}]},
    }
    expect(submissionCandidateDocumentRowSchema.safeParse(row).success).toBe(true)
  })
})
