import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter,Route,Routes,useLocation} from 'react-router'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {DeliveryWorkbench} from './DeliveryWorkbench'
import type {DeliveryWorkbenchRow} from '../../shared/types/domain'

/* The workbench's own half of the contract: that it asks the server for the right thing, that every
 * state offers the one action that resolves it, and that a failure is reported as one.
 *
 * What state a row is IN is not tested here -- that ladder lives in SQL and is exercised in
 * tests/rls/delivery-workbench.test.ts. These tests hand the component a state and assert what it
 * does with it, which is the only part TypeScript owns. */

const {listDeliveryWorkbench,setSubmissionFeedbackHandled,retryClientSubmission,listTeamMembers,recordWorkflowEvent,capabilities,toast}=vi.hoisted(()=>({
  listDeliveryWorkbench:vi.fn(),setSubmissionFeedbackHandled:vi.fn(),retryClientSubmission:vi.fn(),
  listTeamMembers:vi.fn(),recordWorkflowEvent:vi.fn(),capabilities:vi.fn(),
  toast:{success:vi.fn(),error:vi.fn(),info:vi.fn()},
}))
vi.mock('../core/repository',()=>({listDeliveryWorkbench,setSubmissionFeedbackHandled}))
vi.mock('../core/commercialRepository',()=>({listTeamMembers,retryClientSubmission}))
vi.mock('../../shared/lib/productAnalytics',()=>({recordWorkflowEvent}))
vi.mock('../../app/useWorkspaceCapabilities',()=>({useWorkspaceCapabilities:()=>({data:capabilities()})}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'acme'}})}))
vi.mock('../../shared/ui/Toast',()=>({useToast:()=>toast}))

const row=(overrides:Partial<DeliveryWorkbenchRow>={}):DeliveryWorkbenchRow=>({
  candidate_submission_id:'cs-1',package_id:'p-1',job_id:'j-1',job_candidate_id:'jc-1',
  candidate_id:'c-1',candidate_name:'Ni Putu Widya',job_title:'Finance Manager',company_name:'PT Sinar Mas',
  package_title:'Finance shortlist',sent_at:'2026-08-18T09:00:00Z',recipient_email:'client@example.test',
  link_id:'l-1',link_expires_at:'2026-08-25T09:00:00Z',link_revoked_at:null,opened_at:null,
  email_delivery_id:'d-1',email_status:'sent',email_error:null,
  feedback_id:null,feedback_decision:null,feedback_at:null,handled_at:null,
  owner_member_id:'m-1',owner_name:'Satya Mertanadi',
  delivery_state:'waiting',delivery_priority:6,total_count:1,
  ...overrides,
})

function ShowSearch(){const location=useLocation();return <span data-testid="search">{location.search}</span>}

function renderWorkbench({scope='team',entry='/app/acme/today?view=delivery'}:{scope?:'mine'|'team';entry?:string}={}){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}>
    <ShowSearch/>
    <Routes>
      <Route path="/app/acme/today" element={<DeliveryWorkbench scope={scope} currentMemberId="m-1"/>}/>
      <Route path="/app/acme/jobs/:jobId" element={<span>Job workspace</span>}/>
    </Routes>
  </MemoryRouter></QueryClientProvider>)
}

const lastFilters=()=>listDeliveryWorkbench.mock.calls.at(-1)?.[1]

describe('DeliveryWorkbench',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    capabilities.mockReturnValue({canSubmit:true})
    listDeliveryWorkbench.mockResolvedValue({rows:[row()],count:1})
    listTeamMembers.mockResolvedValue([
      {id:'m-1',user_id:'u-1',status:'active',profiles:{full_name:'Satya Mertanadi'}},
      {id:'m-2',user_id:'u-2',status:'active',profiles:{full_name:'Kadek Ari'}},
    ])
    setSubmissionFeedbackHandled.mockResolvedValue(undefined)
    retryClientSubmission.mockResolvedValue({deliveryStatus:'sent'})
  })

  it('opens on Needs attention and states the delivery in one row',async()=>{
    renderWorkbench()
    expect(await screen.findByText('Ni Putu Widya')).toBeInTheDocument()
    expect(screen.getByRole('radio',{name:'Needs attention'})).toHaveAttribute('aria-checked','true')
    expect(lastFilters()).toMatchObject({state:'needs_attention'})
    expect(screen.getByText('Finance Manager')).toBeInTheDocument()
    expect(screen.getByText('PT Sinar Mas')).toBeInTheDocument()
    // Whether the client has even looked at it is the question behind most of the chasing.
    expect(screen.getByText(/not opened/)).toBeInTheDocument()
  })

  it('shows a skeleton, then an error with a retry, without ever showing an empty table',async()=>{
    listDeliveryWorkbench.mockRejectedValue(new Error('Could not load client deliveries'))
    renderWorkbench()
    expect(await screen.findByText('Could not load client deliveries')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Try again'})).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  /* Never "there are none". The RPC is security invoker over tables behind submissions.read, so a
   * member without it gets an empty result rather than an error -- and the reader has to be able to
   * tell an empty queue from an invisible one. */
  it('names the view rule when a queue is empty rather than asserting nothing exists',async()=>{
    listDeliveryWorkbench.mockResolvedValue({rows:[],count:0})
    renderWorkbench()
    expect(await screen.findByText('Nothing needs chasing')).toBeInTheDocument()
    expect(screen.getByText(/the search and owner filters still apply/)).toBeInTheDocument()
  })

  describe('filters',()=>{
    it('puts the quick view in the URL and asks the server for it',async()=>{
      renderWorkbench()
      await screen.findByText('Ni Putu Widya')
      fireEvent.click(screen.getByRole('radio',{name:'Feedback received'}))
      await waitFor(()=>expect(lastFilters()).toMatchObject({state:'feedback_received'}))
      expect(screen.getByTestId('search')).toHaveTextContent('deliveryState=feedback_received')
    })

    it('searches on the server, never in React',async()=>{
      renderWorkbench()
      await screen.findByText('Ni Putu Widya')
      fireEvent.change(screen.getByLabelText('Search deliveries'),{target:{value:'sinar'}})
      await waitFor(()=>expect(lastFilters()).toMatchObject({query:'sinar'}))
      expect(screen.getByTestId('search')).toHaveTextContent('deliveryQ=sinar')
    })

    /* My work is the scope switch Today already had. Offering the owner dropdown as well would let
     * the two disagree in a way neither control shows. */
    it('resolves My work to the current member and hides the owner picker',async()=>{
      renderWorkbench({scope:'mine'})
      await screen.findByText('Ni Putu Widya')
      expect(lastFilters()).toMatchObject({ownerMemberId:'m-1'})
      expect(screen.queryByLabelText('Delivery owner')).not.toBeInTheDocument()
    })

    it('offers the owner picker in Team view',async()=>{
      renderWorkbench({scope:'team'})
      await screen.findByText('Ni Putu Widya')
      expect(lastFilters()).toMatchObject({ownerMemberId:''})
      fireEvent.change(screen.getByLabelText('Delivery owner'),{target:{value:'m-2'}})
      await waitFor(()=>expect(lastFilters()).toMatchObject({ownerMemberId:'m-2'}))
    })

    /* Landing on page 4 of a two-page result is the classic way a filtered list looks empty when it
     * is not. */
    it('drops the page when the filters change',async()=>{
      renderWorkbench({entry:'/app/acme/today?view=delivery&deliveryPage=3'})
      await screen.findByText('Ni Putu Widya')
      expect(listDeliveryWorkbench.mock.calls.at(-1)?.[2]).toBe(3)
      fireEvent.click(screen.getByRole('radio',{name:'All'}))
      await waitFor(()=>expect(listDeliveryWorkbench.mock.calls.at(-1)?.[2]).toBe(0))
      expect(screen.getByTestId('search')).not.toHaveTextContent('deliveryPage')
    })

    it('pages on the server and keeps the page in the URL',async()=>{
      listDeliveryWorkbench.mockResolvedValue({rows:[row()],count:60})
      renderWorkbench()
      await screen.findByText('Ni Putu Widya')
      fireEvent.click(await screen.findByRole('button',{name:'Next'}))
      await waitFor(()=>expect(listDeliveryWorkbench.mock.calls.at(-1)?.[2]).toBe(1))
      expect(screen.getByTestId('search')).toHaveTextContent('deliveryPage=1')
    })
  })

  describe('the truthfulness of the grain',()=>{
    /* One candidate sent to two clients owes two replies, so it is two rows -- and the two must be
     * separately actionable, which a package-grained row could not be. */
    it('renders one candidate sent twice as two rows',async()=>{
      listDeliveryWorkbench.mockResolvedValue({rows:[
        row({candidate_submission_id:'cs-1',package_id:'p-1',job_id:'j-1',job_title:'Finance Manager'}),
        row({candidate_submission_id:'cs-2',package_id:'p-2',job_id:'j-2',job_title:'Head of Finance'}),
      ],count:2})
      renderWorkbench()
      await screen.findByText('Head of Finance')
      expect(screen.getAllByText('Ni Putu Widya')).toHaveLength(2)
    })

    // And the mirror: four candidates in one package are four conversations, not one.
    it('renders one package of three candidates as three rows',async()=>{
      listDeliveryWorkbench.mockResolvedValue({rows:['Ana','Budi','Citra'].map((name,index)=>
        row({candidate_submission_id:`cs-${index}`,candidate_name:name,package_id:'p-1'})),count:3})
      renderWorkbench()
      for(const name of ['Ana','Budi','Citra'])expect(await screen.findByText(name)).toBeInTheDocument()
    })
  })

  describe('actions',()=>{
    it('marks a client answer handled, and says what that changes',async()=>{
      listDeliveryWorkbench.mockResolvedValue({rows:[row({delivery_state:'feedback_received',
        feedback_id:'f-1',feedback_decision:'interview',feedback_at:'2026-08-22T09:00:00Z'})],count:1})
      renderWorkbench()
      fireEvent.click(await screen.findByRole('button',{name:'Mark handled'}))
      await waitFor(()=>expect(setSubmissionFeedbackHandled).toHaveBeenCalledWith('f-1',true))
      await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('Marked as handled.','It moves out of Needs attention.'))
      expect(recordWorkflowEvent).toHaveBeenCalledWith(expect.objectContaining({
        surface:'delivery_workbench',actionKey:'mark_handled',
      }))
    })

    it('reopens a handled answer through the same RPC',async()=>{
      listDeliveryWorkbench.mockResolvedValue({rows:[row({delivery_state:'handled',feedback_id:'f-1',
        feedback_decision:'reject',feedback_at:'2026-08-20T09:00:00Z',handled_at:'2026-08-21T09:00:00Z'})],count:1})
      renderWorkbench()
      fireEvent.click(await screen.findByRole('button',{name:'Reopen'}))
      await waitFor(()=>expect(setSubmissionFeedbackHandled).toHaveBeenCalledWith('f-1',false))
    })

    it('reports a refused handling as a failure rather than a success',async()=>{
      setSubmissionFeedbackHandled.mockRejectedValue(new Error('Client feedback not found'))
      listDeliveryWorkbench.mockResolvedValue({rows:[row({delivery_state:'feedback_received',feedback_id:'f-1'})],count:1})
      renderWorkbench()
      fireEvent.click(await screen.findByRole('button',{name:'Mark handled'}))
      await waitFor(()=>expect(toast.error).toHaveBeenCalled())
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('retries a failed email through the existing delivery, and states the reason it failed',async()=>{
      listDeliveryWorkbench.mockResolvedValue({rows:[row({delivery_state:'failed',email_status:'bounced',
        email_error:'Mailbox does not exist'})],count:1})
      renderWorkbench()
      expect(await screen.findByText('Mailbox does not exist')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button',{name:'Retry email'}))
      await waitFor(()=>expect(retryClientSubmission).toHaveBeenCalledWith('org-1','d-1'))
      await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('Submission email sent.','The existing review link was reused.'))
    })

    /* send-submission returns the new status rather than throwing when the second attempt also
     * fails. Reporting that as "sent" would be the screen telling the consultant the client has it. */
    it('does not claim success when the retry fails again',async()=>{
      retryClientSubmission.mockResolvedValue({deliveryStatus:'failed',errorMessage:'Mailbox does not exist'})
      listDeliveryWorkbench.mockResolvedValue({rows:[row({delivery_state:'failed'})],count:1})
      renderWorkbench()
      fireEvent.click(await screen.findByRole('button',{name:'Retry email'}))
      await waitFor(()=>expect(toast.error).toHaveBeenCalled())
      expect(toast.success).not.toHaveBeenCalled()
    })

    /* Sending is the composer's job. This link is the handoff to it -- a second send form here would
     * be a second set of defaults, a second expiry rule and a second place to get the recipient wrong. */
    it('hands a dead link back to the submission composer',async()=>{
      listDeliveryWorkbench.mockResolvedValue({rows:[row({delivery_state:'link_unavailable',
        link_revoked_at:'2026-08-21T09:00:00Z'})],count:1})
      renderWorkbench()
      const link=await screen.findByRole('link',{name:'Send a fresh link'})
      expect(link).toHaveAttribute('href','/app/acme/jobs/j-1?candidate=jc-1&open=submit')
      expect(screen.getByText(/Revoked/)).toBeInTheDocument()
    })

    it('sends a silent client to the candidate rather than inventing a chase button',async()=>{
      listDeliveryWorkbench.mockResolvedValue({rows:[row({delivery_state:'not_opened'})],count:1})
      renderWorkbench()
      expect((await screen.findAllByRole('link',{name:'Open candidate'}))[0])
        .toHaveAttribute('href','/app/acme/jobs/j-1?candidate=jc-1')
    })

    /* A read-only consultant gets somewhere to go, not a disabled control with no explanation. */
    it('replaces the write actions with a link when the member cannot submit',async()=>{
      capabilities.mockReturnValue({canSubmit:false})
      listDeliveryWorkbench.mockResolvedValue({rows:[row({delivery_state:'feedback_received',feedback_id:'f-1'})],count:1})
      renderWorkbench()
      await screen.findByText('Ni Putu Widya')
      expect(screen.queryByRole('button',{name:'Mark handled'})).not.toBeInTheDocument()
      expect(screen.getByRole('link',{name:'Open candidate'})).toBeInTheDocument()
    })

    /* One row's write must not grey out the whole table -- that reads as the screen having failed. */
    it('only shows the busy state on the row being written',async()=>{
      // Replaced by the promise's own resolve below; declared here so the test can release it.
      let settle=()=>{/* set by the promise below */}
      setSubmissionFeedbackHandled.mockImplementation(()=>new Promise<void>((resolve)=>{settle=resolve}))
      listDeliveryWorkbench.mockResolvedValue({rows:[
        row({candidate_submission_id:'cs-1',candidate_name:'Ana',delivery_state:'feedback_received',feedback_id:'f-1'}),
        row({candidate_submission_id:'cs-2',candidate_name:'Budi',delivery_state:'feedback_received',feedback_id:'f-2'}),
      ],count:2})
      renderWorkbench()
      const buttons=await screen.findAllByRole('button',{name:'Mark handled'})
      fireEvent.click(buttons[0] as HTMLElement)
      await waitFor(()=>expect(buttons[0]).toBeDisabled())
      expect(buttons[1]).not.toBeDisabled()
      settle()
    })
  })

  /* An unfamiliar state renders as itself rather than as a blank cell: the server can gain an arm
   * before this screen learns about it, and a bug report naming the token is worth having. */
  it('renders a state it has never heard of instead of an empty cell',async()=>{
    listDeliveryWorkbench.mockResolvedValue({rows:[row({delivery_state:'escalated'})],count:1})
    renderWorkbench()
    expect(await screen.findByText('escalated')).toBeInTheDocument()
  })
})
