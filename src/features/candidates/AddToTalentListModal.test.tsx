import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {AddToTalentListModal} from './AddToTalentListModal'

/* What this modal has to get right is the REPORTING, not the picking.
 *
 * Adding to a list is idempotent at the database constraint, so "add these forty" routinely means
 * "add eleven, thirty-nine were already here" -- and a bare success toast for that outcome is what
 * makes people go and check by hand, which is the manual work the list was meant to remove. Both
 * numbers come from the server and both reach the user, including the case where the honest answer
 * is that nothing was added at all.
 */

const {listCandidateLists,addCandidatesToList,createCandidateList,success,error}=vi.hoisted(()=>({
  listCandidateLists:vi.fn(),addCandidatesToList:vi.fn(),createCandidateList:vi.fn(),
  success:vi.fn(),error:vi.fn(),
}))
vi.mock('../core/repository',()=>({listCandidateLists,addCandidatesToList,createCandidateList}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'acme'},membership:{id:'member-1'}})}))
vi.mock('../../shared/ui/Toast',()=>({useToast:()=>({success,error,info:vi.fn()})}))

const list=(overrides={})=>({
  id:'list-1',organization_id:'org-1',owner_member_id:'member-1',owner_name:'Satya Mertanadi',
  name:'Acme CFO shortlist',description:null,visibility:'private',member_count:3,
  created_at:'2026-08-01T00:00:00Z',updated_at:'2026-08-01T00:00:00Z',archived_at:null,...overrides,
})

const candidates=[{id:'cand-1',full_name:'Ni Putu Widya'},{id:'cand-2',full_name:'Kadek Ari'}]

function renderModal(props:Partial<Parameters<typeof AddToTalentListModal>[0]>={}){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  const onClose=vi.fn();const onAdded=vi.fn()
  render(<QueryClientProvider client={client}>
    <AddToTalentListModal open onClose={onClose} candidates={candidates} onAdded={onAdded} {...props}/>
  </QueryClientProvider>)
  return {onClose,onAdded}
}

describe('AddToTalentListModal',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    listCandidateLists.mockResolvedValue([list()])
    addCandidatesToList.mockResolvedValue({added:2,skipped:0})
  })

  it('names how many candidates are being added',async()=>{
    renderModal()
    expect(await screen.findByText('Adding 2 candidates.')).toBeInTheDocument()
  })

  it('names the candidate when there is only one',async()=>{
    renderModal({candidates:[candidates[0]!]})
    expect(await screen.findByText('Adding Ni Putu Widya.')).toBeInTheDocument()
  })

  it('sends every selected id to the chosen list',async()=>{
    const {onAdded}=renderModal()
    fireEvent.change(await screen.findByLabelText('Choose a talent list'),{target:{value:'list-1'}})
    fireEvent.click(screen.getByRole('button',{name:'Add 2 candidates'}))
    await waitFor(()=>expect(addCandidatesToList).toHaveBeenCalledWith('list-1',['cand-1','cand-2']))
    await waitFor(()=>expect(onAdded).toHaveBeenCalled())
  })

  /* The idempotent case. "12 added" and "3 were already on this list" are different facts and both
   * reach the user, because the second one is the reason the first is not the number they selected. */
  it('reports what was added and what was already there',async()=>{
    addCandidatesToList.mockResolvedValue({added:1,skipped:1})
    renderModal()
    fireEvent.change(await screen.findByLabelText('Choose a talent list'),{target:{value:'list-1'}})
    fireEvent.click(screen.getByRole('button',{name:'Add 2 candidates'}))
    await waitFor(()=>expect(success).toHaveBeenCalledWith('Added 1 candidate to the list.','1 was already on this list.'))
  })

  /* Adding people who are all already on the list is a success, and saying only "done" would leave
   * the consultant wondering whether the click registered at all. */
  it('says plainly when there was nothing new to add',async()=>{
    addCandidatesToList.mockResolvedValue({added:0,skipped:2})
    renderModal()
    fireEvent.change(await screen.findByLabelText('Choose a talent list'),{target:{value:'list-1'}})
    fireEvent.click(screen.getByRole('button',{name:'Add 2 candidates'}))
    await waitFor(()=>expect(success).toHaveBeenCalledWith('Nothing new to add.','2 were already on this list.'))
  })

  it('cannot be submitted until a list is chosen',async()=>{
    renderModal()
    await screen.findByLabelText('Choose a talent list')
    expect(screen.getByRole('button',{name:'Add 2 candidates'})).toBeDisabled()
  })

  /* A workspace with no lists yet has nothing to pick from, so offering a picker and a "create
   * instead" toggle would be asking the user to choose between one real option and none. */
  it('opens straight into the create form when there are no lists',async()=>{
    listCandidateLists.mockResolvedValue([])
    renderModal()
    expect(await screen.findByLabelText('New list name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Choose a talent list')).toBeNull()
    expect(screen.queryByRole('button',{name:/Use an existing list instead/})).toBeNull()
  })

  /* Create-then-add, in that order and as two writes. The list exists whether or not the membership
   * write lands, and a failed add should leave a real empty list rather than rolling back something
   * the user explicitly asked for. */
  it('creates a list and adds into it in one gesture',async()=>{
    listCandidateLists.mockResolvedValue([])
    createCandidateList.mockResolvedValue({id:'list-new'})
    renderModal()
    fireEvent.change(await screen.findByLabelText('New list name'),{target:{value:'Bali finance leaders'}})
    fireEvent.click(screen.getByRole('button',{name:'Create list and add'}))
    await waitFor(()=>expect(createCandidateList).toHaveBeenCalledWith('org-1',{name:'Bali finance leaders',visibility:'private'}))
    await waitFor(()=>expect(addCandidatesToList).toHaveBeenCalledWith('list-new',['cand-1','cand-2']))
  })

  /* Membership grants nothing, and this is the one place a user could reasonably assume otherwise --
   * they have just put a do-not-contact candidate onto a list. */
  it('states that a list changes nothing about who may be contacted',async()=>{
    renderModal()
    expect(await screen.findByText(/does not change who may be contacted or added to a job/)).toBeInTheDocument()
  })

  it('surfaces a refused write instead of reporting success',async()=>{
    addCandidatesToList.mockRejectedValue(new Error('Talent list not found'))
    const {onAdded}=renderModal()
    fireEvent.change(await screen.findByLabelText('Choose a talent list'),{target:{value:'list-1'}})
    fireEvent.click(screen.getByRole('button',{name:'Add 2 candidates'}))
    await waitFor(()=>expect(error).toHaveBeenCalled())
    expect(success).not.toHaveBeenCalled()
    expect(onAdded).not.toHaveBeenCalled()
  })
})
