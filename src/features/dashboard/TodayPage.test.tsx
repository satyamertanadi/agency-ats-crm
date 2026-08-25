import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter,Route,Routes,useLocation} from 'react-router'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {TodayPage} from './TodayPage'

/* Today has two halves now. These tests are about the seam between them, not about either half:
 * that the switch is where the scope control already was rather than a new sidebar item, that it
 * survives a reload through the URL, and -- the load-bearing one -- that neither half pays for the
 * other's queries.
 *
 * That last point is the whole reason the two are one route. Today fans out to ten list queries and
 * Delivery to one RPC; a switch that ran both because they share a page would be slower than the
 * navigation it replaces. */

const repository=vi.hoisted(()=>({
  listTasks:vi.fn(),listInterviews:vi.fn(),listOffers:vi.fn(),listPlacedJobCandidates:vi.fn(),
  listJobs:vi.fn(),dashboardSummary:vi.fn(),listEmailDeliveryIssues:vi.fn(),listSubmissionPackages:vi.fn(),
  listJobHealth:vi.fn(),listRecentSubmissionFeedback:vi.fn(),completeTask:vi.fn(),snoozeTask:vi.fn(),
  listDeliveryWorkbench:vi.fn(),setSubmissionFeedbackHandled:vi.fn(),
}))
const {capabilities,listTeamMembers}=vi.hoisted(()=>({capabilities:vi.fn(),listTeamMembers:vi.fn()}))
vi.mock('../core/repository',()=>repository)
vi.mock('../core/commercialRepository',()=>({listTeamMembers,retryClientSubmission:vi.fn()}))
vi.mock('../../shared/lib/productAnalytics',()=>({recordWorkflowEvent:vi.fn()}))
vi.mock('../../app/useWorkspaceCapabilities',()=>({useWorkspaceCapabilities:()=>({data:capabilities(),isLoading:false})}))
vi.mock('../../app/AuthProvider',()=>({useAuth:()=>({user:{id:'u-1',user_metadata:{full_name:'Satya Mertanadi'}}})}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({
  organization:{id:'org-1',slug:'acme',name:'Northstar Search'},membership:{id:'m-1'}})}))
vi.mock('../../shared/ui/Toast',()=>({useToast:()=>({success:vi.fn(),error:vi.fn(),info:vi.fn()})}))

function ShowSearch(){const location=useLocation();return <span data-testid="search">{location.search}</span>}

function renderToday(entry='/app/acme/today'){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}>
    <ShowSearch/>
    <Routes><Route path="/app/acme/today" element={<TodayPage/>}/></Routes>
  </MemoryRouter></QueryClientProvider>)
}

const deliveryRow={
  candidate_submission_id:'cs-1',package_id:'p-1',job_id:'j-1',job_candidate_id:'jc-1',candidate_id:'c-1',
  candidate_name:'Ni Putu Widya',job_title:'Finance Manager',company_name:'PT Sinar Mas',
  package_title:'Finance shortlist',sent_at:'2026-08-18T09:00:00Z',recipient_email:'client@example.test',
  link_id:'l-1',link_expires_at:'2026-08-25T09:00:00Z',link_revoked_at:null,opened_at:null,
  email_delivery_id:'d-1',email_status:'sent',email_error:null,feedback_id:null,feedback_decision:null,
  feedback_at:null,handled_at:null,owner_member_id:'m-1',owner_name:'Satya Mertanadi',
  delivery_state:'not_opened',delivery_priority:5,total_count:1,
}

describe('Today: Actions and Delivery',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    capabilities.mockReturnValue({canViewTeamReports:true,canWriteCandidates:true,canSubmit:true})
    repository.listTasks.mockResolvedValue([])
    repository.listInterviews.mockResolvedValue([])
    repository.listOffers.mockResolvedValue([])
    repository.listPlacedJobCandidates.mockResolvedValue([])
    repository.listJobs.mockResolvedValue([])
    repository.dashboardSummary.mockResolvedValue({companies:2,contacts:2,activeJobs:1,candidates:5,pipelineEntries:3,members:2})
    repository.listEmailDeliveryIssues.mockResolvedValue([])
    repository.listSubmissionPackages.mockResolvedValue([])
    repository.listJobHealth.mockResolvedValue([])
    repository.listRecentSubmissionFeedback.mockResolvedValue([])
    repository.listDeliveryWorkbench.mockResolvedValue({rows:[deliveryRow],count:1})
    listTeamMembers.mockResolvedValue([{id:'m-1',user_id:'u-1',status:'active',profiles:{full_name:'Satya Mertanadi'}}])
  })

  /* No new sidebar item. Both halves answer "what needs me today", and splitting them across the nav
   * would put the work a consultant does every morning in two places. */
  it('switches inside Today rather than navigating anywhere',async()=>{
    renderToday()
    await screen.findByRole('heading',{name:'Today, Satya'})
    const view=screen.getByRole('radiogroup',{name:'Today view'})
    expect(view).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio',{name:'Delivery'}))
    await waitFor(()=>expect(screen.getByTestId('search')).toHaveTextContent('view=delivery'))
    expect(screen.getByRole('heading',{name:'Today, Satya'})).toBeInTheDocument()
  })

  it('opens straight into Delivery from the URL, so a reload and a shared link both work',async()=>{
    renderToday('/app/acme/today?view=delivery')
    expect(await screen.findByText('Ni Putu Widya')).toBeInTheDocument()
    expect(screen.getByRole('radio',{name:'Delivery'})).toHaveAttribute('aria-checked','true')
  })

  /* The load-bearing assertion. Today fans out to ten list queries; running them behind a Delivery
   * view nobody is looking at is exactly the cost this switch exists to avoid. */
  it('runs none of the action-queue queries while Delivery is showing',async()=>{
    renderToday('/app/acme/today?view=delivery')
    await screen.findByText('Ni Putu Widya')
    for(const [name,fn] of Object.entries(repository)){
      if(name==='listDeliveryWorkbench'||name==='setSubmissionFeedbackHandled')continue
      expect(fn,`${name} ran behind the Delivery view`).not.toHaveBeenCalled()
    }
  })

  it('runs no delivery query while the action queue is showing',async()=>{
    renderToday()
    await waitFor(()=>expect(repository.listTasks).toHaveBeenCalled())
    expect(repository.listDeliveryWorkbench).not.toHaveBeenCalled()
  })

  /* Switching back must not leave the page asserting an error because the disabled query has no
   * data -- the failure mode the early return in TodayPage exists to prevent. */
  it('returns to the action queue without falling through to the error state',async()=>{
    renderToday('/app/acme/today?view=delivery')
    await screen.findByText('Ni Putu Widya')
    fireEvent.click(screen.getByRole('radio',{name:'Actions'}))
    await waitFor(()=>expect(repository.listTasks).toHaveBeenCalled())
    expect(screen.queryByText('Could not load this view')).not.toBeInTheDocument()
  })

  /* My work / Team view is unchanged and still scopes both halves. It was a hand-rolled row of
   * buttons; it is now the shared SegmentedControl, which is a radiogroup rather than a toolbar. */
  it('keeps the work scope control and applies it to deliveries',async()=>{
    renderToday('/app/acme/today?view=delivery')
    await screen.findByText('Ni Putu Widya')
    expect(repository.listDeliveryWorkbench.mock.calls.at(-1)?.[1]).toMatchObject({ownerMemberId:'m-1'})
    fireEvent.click(screen.getByRole('radio',{name:'Team view'}))
    await waitFor(()=>expect(repository.listDeliveryWorkbench.mock.calls.at(-1)?.[1]).toMatchObject({ownerMemberId:''}))
  })

  it('hides the scope control from members who cannot see other people\'s work',async()=>{
    capabilities.mockReturnValue({canViewTeamReports:false,canWriteCandidates:false,canSubmit:true})
    renderToday('/app/acme/today?view=delivery')
    await screen.findByText('Ni Putu Widya')
    expect(screen.queryByRole('radiogroup',{name:'Work scope'})).not.toBeInTheDocument()
    // The view switch itself is not a permission -- everyone who can open Today can see both halves.
    expect(screen.getByRole('radiogroup',{name:'Today view'})).toBeInTheDocument()
  })
})
