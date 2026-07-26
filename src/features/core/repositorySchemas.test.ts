import {describe,expect,it} from 'vitest'
import {candidateSchema,candidateSearchRowSchema,jobCandidateSchema,jobHealthSchema,jobSchema,pipelineStageSchema} from './repositorySchemas'

// Fixtures mirror the exact shapes confirmed against production via read-only SQL that reconstructs
// what PostgREST actually embeds (see the X1/F17 rollout) -- fake data, real structure: an array-wrapped
// candidate_private_details (no unique constraint on its candidate_id FK, so PostgREST embeds it with
// to-many cardinality), and singular object embeds for job_candidates.candidates/pipeline_stages (the
// forward direction of their FK, always singular).
describe('repositorySchemas against confirmed production shapes',()=>{
  it('accepts a candidate row with an array-wrapped private-details embed',()=>{
    const row={
      id:'c1',organization_id:'o1',full_name:'Test Candidate',current_company:'Acme',current_position:'Engineer',
      location:'Bali',linkedin_url:null,status:'active',source:'LinkedIn',availability:null,owner_member_id:null,
      created_at:'2026-07-18T06:31:33.639526+00:00',
      candidate_private_details:[{email:'test@example.com',phone:null,current_salary:null,expected_salary:null,salary_currency:null,consent_status:'unknown'}],
    }
    expect(candidateSchema.safeParse(row).success).toBe(true)
  })

  it('accepts a candidate row with an empty private-details embed (no private row yet)',()=>{
    const row={
      id:'c2',organization_id:'o1',full_name:'No Private Row',current_company:null,current_position:null,
      location:null,linkedin_url:null,status:'passive',source:null,availability:null,owner_member_id:null,
      created_at:'2026-07-18T06:31:33.639526+00:00',candidate_private_details:[],
    }
    expect(candidateSchema.safeParse(row).success).toBe(true)
  })

  it('accepts a search-page row with bigint total_count arriving as a string',()=>{
    const row={
      id:'c1',organization_id:'o1',full_name:'Test Candidate',current_company:null,current_position:null,
      location:null,linkedin_url:null,status:'active',source:null,availability:null,owner_member_id:null,
      created_at:'2026-07-18T06:31:33.639526+00:00',consent_status:'unknown',owner_name:null,
      tag_names:[],skill_names:[],total_count:'42',
    }
    const result=candidateSearchRowSchema.safeParse(row)
    expect(result.success).toBe(true)
    if(result.success)expect(result.data.total_count).toBe(42)
  })

  it('accepts a job row with a singular companies embed',()=>{
    const row={
      id:'j1',organization_id:'o1',company_id:'co1',pipeline_id:'p1',title:'Backend Engineer',location:null,
      priority:'normal',status:'open',currency:'IDR',salary_min:null,salary_max:120_000_000,
      placement_fee_percentage:15,fixed_fee:null,description:null,requirements:null,owner_member_id:null,
      opened_at:'2026-07-01T00:00:00Z',updated_at:'2026-07-20T00:00:00Z',companies:{id:'co1',name:'Acme Corp'},
    }
    expect(jobSchema.safeParse(row).success).toBe(true)
  })

  it('accepts a job_health row with bigint candidate/waiting counts as numbers',()=>{
    const row={
      id:'j1',company_id:'co1',pipeline_id:'p1',title:'Backend Engineer',company_name:'Acme Corp',location:null,
      priority:'normal',status:'open',owner_member_id:null,owner_name:null,opened_at:null,days_open:5,
      candidate_count:3,waiting_count:1,phase_counts:{sourcing:2,screening:1},salary_min:null,salary_max:null,
      currency:'IDR',fee_percentage:15,fixed_fee:null,expected_fee:18_000_000,fee_source:'job_override',
      next_action:null,last_activity_at:null,already_in_job:false,updated_at:'2026-07-20T00:00:00Z',
    }
    expect(jobHealthSchema.safeParse(row).success).toBe(true)
  })

  it('accepts a pipeline stage row',()=>{
    const row={id:'ps1',pipeline_id:'p1',name:'Sourced',stage_key:'sourced',stage_type:'active',phase_key:'sourcing',position:0,color:null}
    expect(pipelineStageSchema.safeParse(row).success).toBe(true)
  })

  it('accepts a job_candidate row with singular candidates/pipeline_stages embeds',()=>{
    const row={
      id:'jc1',job_id:'j1',candidate_id:'c1',current_stage_id:'ps1',updated_at:'2026-07-20T09:02:07Z',
      candidates:{id:'c1',organization_id:'o1',full_name:'Test Candidate',current_company:null,current_position:null,location:null,linkedin_url:null,status:'active',source:null,availability:null,owner_member_id:null,created_at:'2026-07-20T08:49:49Z'},
      pipeline_stages:{id:'ps1',pipeline_id:'p1',name:'Sourced',stage_key:'sourced',stage_type:'active',phase_key:'sourcing',position:0,color:null},
    }
    expect(jobCandidateSchema.safeParse(row).success).toBe(true)
  })

  it('rejects a row missing a required field, e.g. a renamed column',()=>{
    const row={id:'j1',organization_id:'o1',company_id:'co1'} // missing everything else jobSchema requires
    expect(jobSchema.safeParse(row).success).toBe(false)
  })
})
