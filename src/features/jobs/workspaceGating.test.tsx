import {render,screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {describe,expect,it,vi} from 'vitest'
import {JobCandidatePanel} from './JobCandidatePanel'
import type {Job,JobCandidate,PipelineStage} from '../../shared/types/domain'

/* The workspace used to gate its whole render on seven queries, five of which are org-wide lists that
 * only decorate a candidate once one is opened. So a single unreadable offer row anywhere in the
 * organization replaced this job's board with a full-page error.
 *
 * Now the board renders on jobs+pipeline and the other five hydrate behind it -- which means the panel
 * can open before they land, or after they failed, and has to distinguish "there are none" from "we
 * do not know yet". These pin that distinction, because both states otherwise render as a confident
 * "No offer recorded". */

vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'northstar',base_currency:'USD'}})}))
vi.mock('../../app/AuthProvider',()=>({useAuth:()=>({user:{id:'user-1'}})}))
vi.mock('../../app/useWorkspaceCapabilities',()=>({useWorkspaceCapabilities:()=>({data:{canManagePlacements:true,canMovePipeline:true,canSubmit:true}})}))
vi.mock('../../shared/ui/Toast',()=>({useToast:()=>({success:vi.fn(),error:vi.fn(),info:vi.fn()})}))
vi.mock('@tanstack/react-query',async()=>{
  const actual=await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {...actual,useQuery:()=>({data:undefined,isLoading:false,isSuccess:false,error:null}),useQueryClient:()=>({invalidateQueries:vi.fn()}),useMutation:()=>({mutate:vi.fn(),isPending:false,error:null})}
})
vi.mock('./JobCandidateLifecycle',()=>({JobCandidateLifecycle:()=><div>lifecycle</div>}))
vi.mock('../../shared/lib/productAnalytics',()=>({recordWorkflowEvent:vi.fn()}))

const stage={id:'s1',pipeline_id:'p1',name:'Shortlisted',stage_key:'shortlisted',stage_type:'active',phase_key:'shortlist',position:3,color:null} as PipelineStage
const job={id:'job-1',title:'Head of Brand',company_id:'co-1',currency:'USD',status:'open'} as Job
const item={id:'jc-1',job_id:'job-1',candidate_id:'cand-1',current_stage_id:'s1',updated_at:'2026-07-01T00:00:00Z',
  candidates:{id:'cand-1',full_name:'Ana Chen'}} as JobCandidate

const renderPanel=(extra:Partial<React.ComponentProps<typeof JobCandidatePanel>>)=>render(
  <MemoryRouter><JobCandidatePanel job={job} item={item} stage={stage} stages={[stage]} interviews={[]} offers={[]} placement={null}
    hasSubmission={false} action={null} readOnly={false} onAction={vi.fn()} onClose={vi.fn()} onUpdated={vi.fn()}
    onMove={vi.fn()} moving={false} {...extra}/></MemoryRouter>)

describe('JobCandidatePanel hydration state',()=>{
  it('says the details are unavailable rather than claiming there are none',()=>{
    renderPanel({detailError:new Error('offers unreadable')})
    expect(screen.getByText('Some details could not be loaded')).toBeInTheDocument()
  })

  it('says it is still loading rather than claiming there are none',()=>{
    renderPanel({detailLoading:true})
    expect(screen.getByText('Loading offers, interviews and placements…')).toBeInTheDocument()
  })

  it('claims nothing when the lists have actually arrived empty',()=>{
    renderPanel({})
    expect(screen.queryByText('Some details could not be loaded')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading offers, interviews and placements…')).not.toBeInTheDocument()
  })
})
