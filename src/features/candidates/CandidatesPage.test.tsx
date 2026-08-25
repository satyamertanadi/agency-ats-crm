import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter,Route,Routes,useLocation} from 'react-router'
import {afterAll,beforeEach,describe,expect,it,vi} from 'vitest'
import {CandidatesPage} from './CandidatesPage'
import type {CandidateSearchRow} from '../../shared/types/domain'

/* The list's side of Quick View: the three ways in, the way out, and the two things the drawer must
 * not disturb -- the record link and the table's own width budget.
 *
 * The drawer's contents have their own tests. These are about the page: which gesture opens it, that
 * a click aimed at a control still reaches that control, and that Escape puts the keyboard back where
 * it was rather than at the top of the document. */

const {listCandidatesPage,listTeamMembers,recordWorkflowEvent,capabilities}=vi.hoisted(()=>({
  listCandidatesPage:vi.fn(),listTeamMembers:vi.fn(),recordWorkflowEvent:vi.fn(),capabilities:vi.fn(),
}))
vi.mock('../core/repository',()=>({listCandidatesPage}))
vi.mock('../core/commercialRepository',()=>({listTeamMembers,mergeCandidates:vi.fn(),updateCandidateProfile:vi.fn(),
  listSavedViews:vi.fn().mockResolvedValue([]),saveView:vi.fn(),deleteSavedView:vi.fn(),
  getCandidateDetail:vi.fn(),getCompanyDetail:vi.fn(),listCandidateDocuments:vi.fn().mockResolvedValue([])}))
vi.mock('../../shared/lib/productAnalytics',()=>({recordWorkflowEvent}))
vi.mock('../../app/useWorkspaceCapabilities',()=>({useWorkspaceCapabilities:()=>({data:capabilities()})}))
vi.mock('../../app/AuthProvider',()=>({useAuth:()=>({user:{id:'user-1'}})}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'acme',base_currency:'USD'}})}))
vi.mock('../../shared/ui/Toast',()=>({useToast:()=>({success:vi.fn(),error:vi.fn(),info:vi.fn()})}))
vi.mock('./AddCandidateModal',()=>({AddCandidateModal:()=>null}))
vi.mock('./AddCandidateToJobModal',()=>({AddCandidateToJobModal:({open}:{open:boolean})=>open?<div>Add to job modal</div>:null}))
vi.mock('../activities/ActivityFeed',()=>({ActivityFeed:()=><div>Activity journal</div>}))

/* The column ladder measures the table's own track, and jsdom performs no layout -- without a
 * ResizeObserver the page resolves to its narrowest tier, which drops the row menu that one of these
 * tests needs to click. This reports a fixed desktop width so the full six-column tier renders. */
const REGION_WIDTH=1180
const realResizeObserver=globalThis.ResizeObserver
class FixedWidthResizeObserver{
  constructor(private readonly callback:ResizeObserverCallback){}
  observe(element:Element){this.callback([{target:element,contentRect:{width:REGION_WIDTH}} as unknown as ResizeObserverEntry],this as unknown as ResizeObserver)}
  // Nothing to tear down: this reports once, on observe, and never again.
  unobserve(){/* no-op */}
  disconnect(){/* no-op */}
}
globalThis.ResizeObserver=FixedWidthResizeObserver as unknown as typeof ResizeObserver
afterAll(()=>{globalThis.ResizeObserver=realResizeObserver})

const candidate=(overrides:Partial<CandidateSearchRow>={})=>({
  id:'cand-1',full_name:'Ni Putu Widya',current_position:'Junior Taxation Consultant',
  current_company:'IBS Consulting',location:'Denpasar',status:'active',source:'referral',
  owner_name:'Satya Mertanadi',skill_names:['Accounting'],tag_names:[],
  open_job_count:0,total_count:2,updated_at:'2026-07-01T00:00:00Z',...overrides,
} as unknown as CandidateSearchRow)

const rows=[candidate(),candidate({id:'cand-2',full_name:'Kadek Ari',current_position:'Finance Manager'})]

function ShowLocation(){
  const location=useLocation()
  return <><span data-testid="location">{location.pathname}</span><span data-testid="search">{location.search}</span></>
}

function renderPage(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/acme/candidates']}>
    <ShowLocation/>
    <Routes>
      <Route path="/app/acme/candidates" element={<CandidatesPage/>}/>
      <Route path="/app/acme/candidates/:id" element={<span>Full record</span>}/>
    </Routes>
  </MemoryRouter></QueryClientProvider>)
}

const rowFor=(name:string)=>screen.getByText(name).closest('tr') as HTMLTableRowElement
const findRow=async(name:string)=>(await screen.findByText(name)).closest('tr') as HTMLTableRowElement
const quickView=()=>screen.queryByRole('dialog')

describe('CandidatesPage Quick View',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    capabilities.mockReturnValue({canMovePipeline:true,canWriteCandidates:true})
    listCandidatesPage.mockResolvedValue({rows,count:2})
    listTeamMembers.mockResolvedValue([{id:'m1',user_id:'user-1',status:'active',profiles:{full_name:'Satya Mertanadi'}}])
  })

  /* The persistent pane is gone, not hidden. If it comes back, the table pays 320px on exactly the
   * screens wide enough to show every column -- which is the regression this work removes. */
  it('renders no preview pane and no pane toggle',async()=>{
    renderPage()
    await findRow('Ni Putu Widya')
    expect(screen.queryByLabelText(/^Preview of/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:/preview/i})).not.toBeInTheDocument()
    expect(quickView()).not.toBeInTheDocument()
  })

  it('opens Quick View from a press on the row itself',async()=>{
    renderPage()
    const row=await findRow('Ni Putu Widya')
    fireEvent.click(row.querySelector('td:nth-child(2)') as HTMLElement)
    expect(await screen.findByRole('dialog')).toHaveTextContent('Ni Putu Widya')
    expect(recordWorkflowEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId:'org-1',surface:'candidate_quick_view',actionKey:'open_row',
    }))
  })

  /* Telemetry is the one thing on this page that leaves the browser without the user asking, so it
   * gets a test of its own: an event name, a surface and an entry point, and nothing that identifies
   * the candidate being looked at. */
  it('records the entry point and nothing about the candidate',async()=>{
    renderPage()
    const row=await findRow('Ni Putu Widya')
    fireEvent.click(row.querySelector('td:nth-child(2)') as HTMLElement)
    const payload=JSON.stringify(recordWorkflowEvent.mock.calls[0]?.[0])
    expect(payload).not.toContain('Ni Putu Widya')
    expect(payload).not.toContain('cand-1')
  })

  /* The name is the link to the full record and stays the accessible route to it. A row handler with
   * no guard swallows this click and the record becomes unreachable by mouse. */
  it('lets the candidate link through to the full record instead of opening Quick View',async()=>{
    renderPage()
    await findRow('Ni Putu Widya')
    fireEvent.click(screen.getByRole('link',{name:'Ni Putu Widya'}))
    await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('/app/acme/candidates/cand-1'))
    expect(quickView()).not.toBeInTheDocument()
  })

  it('opens Quick View from the row menu',async()=>{
    renderPage()
    await findRow('Ni Putu Widya')
    fireEvent.click(screen.getByRole('button',{name:'Actions for Ni Putu Widya'}))
    fireEvent.click(await screen.findByRole('menuitem',{name:'Quick view'}))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Ni Putu Widya')
    expect(recordWorkflowEvent).toHaveBeenCalledWith(expect.objectContaining({actionKey:'open_menu'}))
  })

  it('opens Quick View with v on the row the keyboard is on',async()=>{
    renderPage()
    const row=await findRow('Kadek Ari')
    fireEvent.focus(row)
    fireEvent.keyDown(document,{key:'v'})
    expect(await screen.findByRole('dialog')).toHaveTextContent('Kadek Ari')
    expect(recordWorkflowEvent).toHaveBeenCalledWith(expect.objectContaining({actionKey:'open_keyboard'}))
  })

  it('does nothing on v when no row has the cursor',async()=>{
    renderPage()
    await findRow('Ni Putu Widya')
    fireEvent.keyDown(document,{key:'v'})
    expect(quickView()).not.toBeInTheDocument()
  })

  /* Enter is the page's own shortcut and must keep opening the record. Quick View is the cheaper
   * look, not a replacement for going in. */
  it('still opens the full record on Enter',async()=>{
    renderPage()
    const row=await findRow('Ni Putu Widya')
    fireEvent.focus(row)
    fireEvent.keyDown(document,{key:'Enter'})
    await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('/app/acme/candidates/cand-1'))
  })

  it('closes on Escape and puts the keyboard back on the row it came from',async()=>{
    renderPage()
    const row=await findRow('Kadek Ari')
    fireEvent.focus(row)
    fireEvent.keyDown(document,{key:'v'})
    await screen.findByRole('dialog')
    fireEvent.keyDown(document,{key:'Escape'})
    await waitFor(()=>expect(quickView()).not.toBeInTheDocument())
    await waitFor(()=>expect(document.activeElement).toBe(rowFor('Kadek Ari')))
  })

  /* The whole argument for a drawer over a pane: it overlays rather than displaces, so the table's
   * column budget is the same whether a candidate is being previewed or not. */
  it('does not change the table columns when Quick View opens',async()=>{
    renderPage()
    const row=await findRow('Ni Putu Widya')
    const before=screen.getAllByRole('columnheader').map((header)=>header.textContent)
    fireEvent.click(row.querySelector('td:nth-child(2)') as HTMLElement)
    await screen.findByRole('dialog')
    expect(screen.getAllByRole('columnheader').map((header)=>header.textContent)).toEqual(before)
  })

  /* The page's own j/k must not fire while the drawer owns the screen -- the drawer has its own, and
   * two handlers on one keystroke would move the cursor two rows at a time. */
  it('hands j and k to the drawer while it is open',async()=>{
    renderPage()
    const row=await findRow('Ni Putu Widya')
    fireEvent.focus(row)
    fireEvent.keyDown(document,{key:'v'})
    const drawer=await screen.findByRole('dialog')
    fireEvent.keyDown(document,{key:'j'})
    expect(drawer).toHaveTextContent('Ni Putu Widya')
    fireEvent.keyDown(drawer,{key:'j'})
    await waitFor(()=>expect(screen.getByRole('dialog')).toHaveTextContent('Kadek Ari'))
  })

  /* Two dialogs at once would give the drawer's focus trap the chance to pull focus out of the modal
   * on top of it -- useDialogShell listens at the document and has no notion of a stack. So the
   * drawer hands over rather than layering. */
  it('hands Add to job over to the modal instead of stacking two dialogs',async()=>{
    renderPage()
    const row=await findRow('Ni Putu Widya')
    fireEvent.click(row.querySelector('td:nth-child(2)') as HTMLElement)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button',{name:'Add to job'}))
    expect(await screen.findByText('Add to job modal')).toBeInTheDocument()
    expect(quickView()).not.toBeInTheDocument()
  })

  /* The follow-up flow is the existing QuickTaskModal, reached the way every other record reaches it:
   * by naming the link in the URL. A second task form here would be a second set of defaults to keep
   * in step with it. */
  it('opens the shared task modal against this candidate for a follow-up',async()=>{
    renderPage()
    const row=await findRow('Ni Putu Widya')
    fireEvent.click(row.querySelector('td:nth-child(2)') as HTMLElement)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button',{name:'Add follow-up'}))
    await waitFor(()=>expect(quickView()).not.toBeInTheDocument())
    expect(screen.getByTestId('search')).toHaveTextContent('task=1')
    expect(screen.getByTestId('search')).toHaveTextContent('linkType=candidate')
    expect(screen.getByTestId('search')).toHaveTextContent('linkId=cand-1')
  })

  it('closes Quick View when the filters change the rows underneath it',async()=>{
    renderPage()
    const row=await findRow('Ni Putu Widya')
    fireEvent.click(row.querySelector('td:nth-child(2)') as HTMLElement)
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Search candidates'),{target:{value:'kadek'}})
    await waitFor(()=>expect(quickView()).not.toBeInTheDocument())
  })

  /* Bulk selection is a different act from moving through the list, and the row handler must not
   * blur that line: ticking a checkbox selects, it does not open. */
  it('leaves bulk selection untouched',async()=>{
    renderPage()
    await findRow('Ni Putu Widya')
    fireEvent.click(screen.getByRole('button',{name:'More candidate actions'}))
    fireEvent.click(await screen.findByRole('menuitem',{name:'Select candidates'}))
    const checkbox=await screen.findByRole('checkbox',{name:'Select Ni Putu Widya'})
    fireEvent.click(checkbox)
    expect(quickView()).not.toBeInTheDocument()
    expect(await screen.findByText('1 candidate selected.')).toBeInTheDocument()
  })
})
