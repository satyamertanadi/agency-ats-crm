import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {CandidateQuickViewDrawer} from './CandidateQuickViewDrawer'
import type {CandidateSearchRow} from '../../shared/types/domain'

/* Quick View replaces the preview pane, so it inherits the pane's contract -- summary from the row
 * already loaded, no private data, one route to the full record -- and adds two things the pane could
 * not do: a CV and an activity history, each of which costs a request. The tests below pin both
 * halves. The laziness assertions matter most: a drawer that fetched a CV for every j/k keystroke
 * would be slower than the navigation it replaces. */

const {listCandidateDocuments}=vi.hoisted(()=>({listCandidateDocuments:vi.fn()}))
vi.mock('../core/commercialRepository',()=>({listCandidateDocuments}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'acme'}})}))
/* Mocked so "did the Activity tab mount its query" is a question about THIS component rather than
 * about ActivityFeed's own fetching, which has its own tests. */
const activityFeed=vi.fn()
vi.mock('../activities/ActivityFeed',()=>({ActivityFeed:(props:{readOnly?:boolean})=>{
  activityFeed(props)
  return <div>Activity journal{props.readOnly?' (read only)':''}</div>
}}))

const row=(overrides:Partial<CandidateSearchRow>={})=>({
  id:'cand-1',full_name:'Ni Putu Widya',current_position:'Junior Taxation Consultant',
  current_company:'IBS Consulting',location:'Denpasar',status:'active',source:'referral',
  owner_name:'Satya Mertanadi',skill_names:['Accounting','Audit','Excel'],tag_names:['VIP'],
  quality_issue_codes:[],total_count:1,...overrides,
} as unknown as CandidateSearchRow)

const pdf={id:'d1',file_name:'cv.pdf',original_filename:'widya-cv.pdf',mime_type:'application/pdf',
  document_type:'cv',storage_path:'p/1',size_bytes:2048,created_at:'2026-07-01T00:00:00Z',signedUrl:'https://files.test/cv.pdf'}
const docx={id:'d2',file_name:'profile.docx',original_filename:'widya-profile.docx',
  mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  document_type:'candidate_profile',storage_path:'p/2',size_bytes:5120,created_at:'2026-07-01T00:00:00Z',signedUrl:'https://files.test/profile.docx'}

function renderDrawer(overrides:{
  candidate?:CandidateSearchRow;siblingIds?:string[];canAddToJob?:boolean
  onNavigate?:(id:string)=>void;onClose?:()=>void;onAddToJob?:()=>void;onAddFollowUp?:()=>void
}={}){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  const props={
    candidate:overrides.candidate??row(),
    siblingIds:overrides.siblingIds??['cand-1'],
    canAddToJob:overrides.canAddToJob??true,
    onNavigate:overrides.onNavigate??vi.fn(),
    onClose:overrides.onClose??vi.fn(),
    onAddToJob:overrides.onAddToJob??vi.fn(),
    onAddFollowUp:overrides.onAddFollowUp??vi.fn(),
  }
  render(<QueryClientProvider client={client}><MemoryRouter>
    <CandidateQuickViewDrawer {...props} organizationSlug="acme"/>
  </MemoryRouter></QueryClientProvider>)
  return props
}

const openTab=(name:string)=>fireEvent.click(screen.getByRole('tab',{name}))

describe('CandidateQuickViewDrawer',()=>{
  beforeEach(()=>{vi.clearAllMocks();listCandidateDocuments.mockResolvedValue([pdf])})

  it('opens on Summary and states the facts a consultant screens on',()=>{
    renderDrawer()
    expect(screen.getByRole('tab',{name:'Summary'})).toHaveAttribute('aria-selected','true')
    expect(screen.getByRole('heading',{name:'Ni Putu Widya'})).toBeInTheDocument()
    expect(screen.getByText('Denpasar')).toBeInTheDocument()
    expect(screen.getByText('Satya Mertanadi')).toBeInTheDocument()
    // The whole skill set, not the two the table column has room for.
    for(const skill of ['Accounting','Audit','Excel'])expect(screen.getByText(skill)).toBeInTheDocument()
  })

  /* The reason the tabs exist at all. Summary comes free from the list row; the other two cost a
   * request each, and paying for them on open would make every j/k keystroke a fetch. */
  it('fetches nothing until a tab that needs data is opened',async()=>{
    renderDrawer()
    expect(listCandidateDocuments).not.toHaveBeenCalled()
    expect(activityFeed).not.toHaveBeenCalled()

    openTab('CV')
    await waitFor(()=>expect(listCandidateDocuments).toHaveBeenCalledWith('org-1','cand-1'))
    // Opening CV must not drag the activity journal in with it.
    expect(activityFeed).not.toHaveBeenCalled()

    openTab('Activity')
    expect(await screen.findByText('Activity journal (read only)')).toBeInTheDocument()
  })

  /* Read-only on purpose: a second activity composer is a second place for the two to disagree about
   * what was logged, and the full record already owns that form. */
  it('shows the activity journal without a composer',async()=>{
    renderDrawer()
    openTab('Activity')
    await waitFor(()=>expect(activityFeed).toHaveBeenCalled())
    expect(activityFeed.mock.calls[0]?.[0]).toMatchObject({readOnly:true,links:[{candidate_id:'cand-1'}]})
  })

  it('previews a PDF inline and offers an ordinary open action for everything else',async()=>{
    listCandidateDocuments.mockResolvedValue([docx,pdf])
    renderDrawer()
    openTab('CV')
    expect(await screen.findByText('widya-profile.docx')).toBeInTheDocument()
    const frames=await screen.findAllByTitle('Preview of widya-cv.pdf')
    // Exactly one frame: the DOCX gets a link, not a second frame that would render blank.
    expect(frames).toHaveLength(1)
    expect(frames[0]).toHaveAttribute('src','https://files.test/cv.pdf')
    const links=screen.getAllByRole('link',{name:'Open'})
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href','https://files.test/profile.docx')
  })

  it('says a document is unavailable rather than linking nowhere when it cannot be signed',async()=>{
    listCandidateDocuments.mockResolvedValue([{...pdf,signedUrl:undefined}])
    renderDrawer()
    openTab('CV')
    expect(await screen.findByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('link',{name:'Open'})).not.toBeInTheDocument()
    expect(screen.queryByTitle('Preview of widya-cv.pdf')).not.toBeInTheDocument()
  })

  it('names the enrichment queue when there is no CV at all',async()=>{
    listCandidateDocuments.mockResolvedValue([])
    renderDrawer()
    openTab('CV')
    expect(await screen.findByText('No CV uploaded')).toBeInTheDocument()
  })

  it('offers a retry rather than an empty list when documents fail to load',async()=>{
    listCandidateDocuments.mockRejectedValue(new Error('Could not load documents'))
    renderDrawer()
    openTab('CV')
    expect(await screen.findByText('Could not load documents')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Try again'})).toBeInTheDocument()
  })

  /* The permission boundary. Email, phone and salary sit behind candidates_private and are not in the
   * list row at all. If someone later widens the search row to carry them, this fails rather than
   * quietly leaking them into a surface that opens on a single click. */
  it('never renders private contact or salary data, and says where it lives',()=>{
    const {container}=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <CandidateQuickViewDrawer organizationSlug="acme" siblingIds={['cand-1']} canAddToJob
        candidate={row({...({email:'widya@example.test',phone:'+62811',expected_salary:9_000_000} as object)})}
        onNavigate={vi.fn()} onClose={vi.fn()} onAddToJob={vi.fn()} onAddFollowUp={vi.fn()}/>
    </MemoryRouter></QueryClientProvider>)
    const text=container.textContent||''
    expect(text).not.toContain('widya@example.test')
    expect(text).not.toContain('+62811')
    expect(text).not.toContain('9000000')
    expect(text).not.toContain('9,000,000')
    expect(screen.getByText('Contact details and salary are on the full record.')).toBeInTheDocument()
  })

  it('always offers the full record, and links to it by id',()=>{
    renderDrawer()
    expect(screen.getByRole('link',{name:'Open full record'})).toHaveAttribute('href','/app/acme/candidates/cand-1')
  })

  it('hands the two write actions back to the page',()=>{
    const props=renderDrawer()
    fireEvent.click(screen.getByRole('button',{name:'Add to job'}))
    expect(props.onAddToJob).toHaveBeenCalledWith(expect.objectContaining({id:'cand-1'}))
    fireEvent.click(screen.getByRole('button',{name:'Add follow-up'}))
    expect(props.onAddFollowUp).toHaveBeenCalledWith(expect.objectContaining({id:'cand-1'}))
  })

  // Same rule the row menu follows, so the two cannot disagree about who is reachable.
  it('refuses to add an unreachable candidate to a job',()=>{
    renderDrawer({candidate:row({status:'do_not_contact'} as Partial<CandidateSearchRow>)})
    expect(screen.getByRole('button',{name:'Add to job'})).toBeDisabled()
  })

  it('hides the add action entirely without the permission',()=>{
    renderDrawer({canAddToJob:false})
    expect(screen.queryByRole('button',{name:'Add to job'})).not.toBeInTheDocument()
    // Follow-up is a task, not a pipeline move, so it survives the narrower permission.
    expect(screen.getByRole('button',{name:'Add follow-up'})).toBeInTheDocument()
  })

  describe('paging through the loaded list',()=>{
    const three=['cand-1','cand-2','cand-3']

    it('shows no pager when there is nothing to page to',()=>{
      renderDrawer()
      expect(screen.queryByRole('button',{name:'Next candidate'})).not.toBeInTheDocument()
    })

    it('reports position and moves with the pager',()=>{
      const props=renderDrawer({candidate:row({id:'cand-2'}),siblingIds:three})
      expect(screen.getByText('2 of 3')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button',{name:'Next candidate'}))
      expect(props.onNavigate).toHaveBeenLastCalledWith('cand-3')
      /* Back to cand-2, not cand-1: useListNavigation continues from the move it last ASKED for,
       * because the caller owns activeId and has not re-rendered yet. That is what makes a held j
       * advance smoothly instead of eight keypresses moving one place -- see its `pending` ref. */
      fireEvent.click(screen.getByRole('button',{name:'Previous candidate'}))
      expect(props.onNavigate).toHaveBeenLastCalledWith('cand-2')
    })

    /* Clamped, not wrapped. The pager states "3 of 3"; a Next that jumped back to the first candidate
     * would make that count a lie, and every review queue the user has met behaves this way. */
    it('clamps at both ends of the page',()=>{
      const first=renderDrawer({candidate:row({id:'cand-1'}),siblingIds:three})
      expect(screen.getByRole('button',{name:'Previous candidate'})).toBeDisabled()
      expect(screen.getByRole('button',{name:'Next candidate'})).not.toBeDisabled()
      expect(first.onNavigate).not.toHaveBeenCalled()
    })

    it('clamps at the last candidate too',()=>{
      renderDrawer({candidate:row({id:'cand-3'}),siblingIds:three})
      expect(screen.getByRole('button',{name:'Next candidate'})).toBeDisabled()
      expect(screen.getByRole('button',{name:'Previous candidate'})).not.toBeDisabled()
    })

    /* j/k inside the drawer are scoped by the drawer's own onKeyDown, not by the page's document
     * listener -- which refuses to fire inside a dialog. Without this the review loop would need the
     * mouse for every move. */
    it('moves with j and k while the drawer has focus',()=>{
      const props=renderDrawer({candidate:row({id:'cand-2'}),siblingIds:three})
      const drawer=screen.getByRole('dialog')
      fireEvent.keyDown(drawer,{key:'j'})
      expect(props.onNavigate).toHaveBeenLastCalledWith('cand-3')
      // Continues from the pending move, for the same reason the pager test above lands on cand-2.
      fireEvent.keyDown(drawer,{key:'k'})
      expect(props.onNavigate).toHaveBeenLastCalledWith('cand-2')
    })

    /* Enter is deliberately NOT wired: the candidate under the cursor is already open here, so the
     * key that opens things has nothing left to do and must not steal the key from a focused button. */
    it('does not claim Enter inside the drawer',()=>{
      const props=renderDrawer({candidate:row({id:'cand-2'}),siblingIds:three})
      fireEvent.keyDown(screen.getByRole('dialog'),{key:'Enter'})
      expect(props.onNavigate).not.toHaveBeenCalled()
    })

    it('keeps the chosen tab while paging, so ten CVs are ten keystrokes',async()=>{
      const {rerender}=render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
        <MemoryRouter><CandidateQuickViewDrawer organizationSlug="acme" siblingIds={three} canAddToJob
          candidate={row({id:'cand-1'})} onNavigate={vi.fn()} onClose={vi.fn()} onAddToJob={vi.fn()} onAddFollowUp={vi.fn()}/>
        </MemoryRouter></QueryClientProvider>)
      openTab('CV')
      await waitFor(()=>expect(listCandidateDocuments).toHaveBeenCalledWith('org-1','cand-1'))
      rerender(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
        <MemoryRouter><CandidateQuickViewDrawer organizationSlug="acme" siblingIds={three} canAddToJob
          candidate={row({id:'cand-2'})} onNavigate={vi.fn()} onClose={vi.fn()} onAddToJob={vi.fn()} onAddFollowUp={vi.fn()}/>
        </MemoryRouter></QueryClientProvider>)
      expect(screen.getByRole('tab',{name:'CV'})).toHaveAttribute('aria-selected','true')
      await waitFor(()=>expect(listCandidateDocuments).toHaveBeenCalledWith('org-1','cand-2'))
    })
  })

  it('closes on Escape',()=>{
    const props=renderDrawer()
    fireEvent.keyDown(document,{key:'Escape'})
    expect(props.onClose).toHaveBeenCalled()
  })
})
