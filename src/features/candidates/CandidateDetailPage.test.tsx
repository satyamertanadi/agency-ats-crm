import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter,Route,Routes} from 'react-router'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {CandidateDetailPage} from './CandidateDetailPage'

/* The page is now stateful -- which panels exist depends on `?tab=` -- so these tests pin the two
 * things the restructure could silently break: that every section is still reachable, and that no
 * action or permission gate was dropped when the header was regrouped into an overflow menu. */
const {getCandidateDetail,listCandidateDocuments,listCandidateProfileVersions,listTeamMembers,listCandidatePipelineAssignments,capabilities}=vi.hoisted(()=>({
  getCandidateDetail:vi.fn(),listCandidateDocuments:vi.fn(),listCandidateProfileVersions:vi.fn(),
  listTeamMembers:vi.fn(),listCandidatePipelineAssignments:vi.fn(),capabilities:vi.fn(),
}))
vi.mock('../core/commercialRepository',()=>({getCandidateDetail,listCandidateDocuments,listCandidateProfileVersions,listTeamMembers,
  addCandidateEducation:vi.fn(),addCandidateEmployment:vi.fn(),addCandidateLanguage:vi.fn(),addCandidateSkill:vi.fn(),addCandidateTag:vi.fn(),
  deleteCandidateDocument:vi.fn(),deleteCandidateProfileItem:vi.fn(),removeCandidateSkill:vi.fn(),removeCandidateTag:vi.fn(),
  replaceCandidateProfileSection:vi.fn(),setCandidateArchived:vi.fn(),updateCandidateProfile:vi.fn()}))
vi.mock('../core/repository',()=>({listCandidatePipelineAssignments,createActivity:vi.fn()}))
vi.mock('../../app/useWorkspaceCapabilities',()=>({useWorkspaceCapabilities:()=>({data:capabilities()})}))
vi.mock('../../app/AuthProvider',()=>({useAuth:()=>({user:{id:'user-1'}})}))
vi.mock('../../shared/ui/Toast',()=>({useToast:()=>({success:vi.fn(),error:vi.fn(),info:vi.fn()})}))
vi.mock('./CandidateCvParser',()=>({CandidateCvParser:()=><div/>}))
vi.mock('./CandidateProfileGenerator',()=>({CandidateProfileGenerator:()=><div/>}))
vi.mock('./AddCandidateToJobModal',()=>({AddCandidateToJobModal:({open}:{open:boolean})=>open?<div>Add to job modal</div>:null}))
vi.mock('../activities/ActivityFeed',()=>({ActivityFeed:()=><div>Activity feed</div>}))
vi.mock('../activities/TaskButton',()=>({TaskButton:()=><button type="button">Add task</button>}))

const organization={id:'org-1',slug:'northstar',name:'Northstar Search',base_currency:'USD',profile_enabled:true}
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization})}))

const candidate={id:'cand-1',full_name:'Maya Rodriguez',current_position:'Backend Engineer',current_company:'Acme',location:'Lombok',
  status:'active',availability:'Two weeks',notice_period_days:14,source:'Referral',linkedin_url:null,portfolio_url:null,
  owner_member_id:null,deleted_at:null,updated_at:'2026-07-01T00:00:00Z',
  candidate_private_details:[{email:'maya@example.com',phone:'+62 811',expected_salary:90000,salary_currency:'USD'}],
  candidate_employment:[{id:'e1',title:'Backend Engineer',company_name:'Acme',started_on:'2022-01-01',is_current:true,ended_on:null}],
  candidate_education:[],candidate_languages:[],candidate_skills:[],candidate_tags:[]}

function renderPage(entry='/app/northstar/candidates/cand-1'){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/app/:slug/candidates/:candidateId" element={<CandidateDetailPage/>}/></Routes>
  </MemoryRouter></QueryClientProvider>)
}

describe('CandidateDetailPage',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    capabilities.mockReturnValue({canWriteCandidates:true,canMovePipeline:true})
    getCandidateDetail.mockResolvedValue(candidate)
    listCandidateDocuments.mockResolvedValue([{id:'d1',original_filename:'maya-cv.pdf',file_name:'cv.pdf',size_bytes:2048,document_type:'cv',signedUrl:'#',storage_path:'p'}])
    listCandidateProfileVersions.mockResolvedValue([])
    listTeamMembers.mockResolvedValue([{id:'m1',user_id:'user-1',status:'active',profiles:{full_name:'Satya Rao'}}])
    listCandidatePipelineAssignments.mockResolvedValue([])
  })

  it('leads with the candidate summary and a tone-coded readiness strip',async()=>{
    renderPage()
    expect(await screen.findByRole('heading',{name:'Maya Rodriguez'})).toBeInTheDocument()
    expect(screen.getByText('Backend Engineer at Acme')).toBeInTheDocument()
    // The facts a recruiter checks first, stated once at the top rather than mid-scroll.
    // 'Contactable' carries the do-not-contact signal, which is the only bar left on a submission.
    expect(screen.getByText('Contactable').closest('.readiness-chip')).toHaveClass('tone-good')
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.getByText('Two weeks')).toBeInTheDocument()
  })

  it('warns that a CV is required when no document is attached',async()=>{
    listCandidateDocuments.mockResolvedValue([])
    renderPage()
    // A missing CV is promoted from the reference strip into the "Needs action" band, with a real
    // upload CTA rather than a passive fact chip.
    expect(await screen.findByText('CV missing')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Upload CV'})).toBeInTheDocument()
  })

  it('defaults to Overview and swaps sections when another tab is chosen',async()=>{
    renderPage()
    expect(await screen.findByRole('heading',{name:'Contact details'})).toBeInTheDocument()
    expect(screen.queryByRole('heading',{name:'Employment'})).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab',{name:'Profile'}))
    expect(await screen.findByRole('heading',{name:'Employment'})).toBeInTheDocument()
    expect(screen.queryByRole('heading',{name:'Contact details'})).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab',{name:'Activity'}))
    expect(await screen.findByText('Activity feed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab',{name:'Documents & profiles'}))
    expect(await screen.findByRole('heading',{name:'Documents'})).toBeInTheDocument()
    expect(screen.getByRole('heading',{name:'Client profile history'})).toBeInTheDocument()
  })

  it('opens the tab named by the ?tab= param so a section is deep-linkable',async()=>{
    renderPage('/app/northstar/candidates/cand-1?tab=profile')
    expect(await screen.findByRole('heading',{name:'Skills'})).toBeInTheDocument()
    expect(screen.queryByRole('heading',{name:'Contact details'})).not.toBeInTheDocument()
  })

  it('keeps the client-profile and archive actions available behind the overflow menu',async()=>{
    renderPage()
    expect(await screen.findByRole('heading',{name:'Maya Rodriguez'})).toBeInTheDocument()
    expect(screen.getAllByRole('button',{name:'Add to job'}).length).toBeGreaterThan(0)
    expect(screen.getByRole('button',{name:'Add task'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Edit candidate'})).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button',{name:'More actions'}))
    expect(await screen.findByRole('menuitem',{name:'Generate client profile'})).toBeInTheDocument()
    expect(screen.getByRole('menuitem',{name:'Upload or parse CV'})).toBeInTheDocument()
    expect(screen.getByRole('menuitem',{name:'Archive candidate'})).toBeInTheDocument()
  })

  it('hides every write action from a member without candidate write access',async()=>{
    capabilities.mockReturnValue({canWriteCandidates:false,canMovePipeline:false})
    renderPage()
    expect(await screen.findByRole('heading',{name:'Maya Rodriguez'})).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'More actions'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Edit candidate'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Add to job'})).not.toBeInTheDocument()
  })

  it('still warns that an archived record is excluded from searches',async()=>{
    getCandidateDetail.mockResolvedValue({...candidate,deleted_at:'2026-07-10T00:00:00Z'})
    renderPage()
    expect(await screen.findByText('This record is archived and excluded from normal candidate searches.')).toBeInTheDocument()
    // Both the header button and the empty-pipeline prompt offer it; neither may act on an archive.
    screen.getAllByRole('button',{name:'Add to job'}).forEach((button)=>expect(button).toBeDisabled())
  })

  it('offers the add action from an empty profile panel instead of a dead line',async()=>{
    renderPage('/app/northstar/candidates/cand-1?tab=profile')
    expect(await screen.findByText('No education history yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Add a qualification'}))
    await waitFor(()=>expect(screen.getByLabelText('Institution')).toBeInTheDocument())
  })

  it('points an empty pipeline table at the action that fills it',async()=>{
    renderPage()
    expect(await screen.findByRole('heading',{name:'Not in a job pipeline'})).toBeInTheDocument()
    expect(screen.getByText('In pipelines',{selector:'dt'}).closest('.readiness-chip')).toHaveClass('tone-neutral')
  })

  it('replaces the tab content with the shared candidate form and hides the tab bar',async()=>{
    renderPage()
    fireEvent.click(await screen.findByRole('button',{name:'Edit candidate'}))
    expect(await screen.findByRole('heading',{name:'Edit candidate'})).toBeInTheDocument()
    // The two hand-written panels are gone; what renders is CandidateForm's own four sections.
    expect(screen.getByRole('heading',{name:'Reaching them'})).toBeInTheDocument()
    expect(screen.getByRole('heading',{name:'Money'})).toBeInTheDocument()
    // Currency was a free-text three-character box here, which is the same control the add form
    // never rendered at all -- both are now the one picker.
    expect(screen.getByLabelText('Currency').tagName).toBe('SELECT')
    expect(screen.queryByRole('tab',{name:'Profile'})).not.toBeInTheDocument()
    expect(screen.queryByRole('heading',{name:'Contact details'})).not.toBeInTheDocument()
  })
})
