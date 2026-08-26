import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {ScorecardDrilldownDrawer} from './ScorecardDrilldownDrawer'
import {drilldowns} from './scorecardDrilldown'

/* The drawer's contract, which is narrower than "it lists some records":
 *
 * 1. The count is the SIZE OF THE ID SET, never the number of rows the name query resolved. Those
 *    differ under RLS, and a count taken from resolved rows would shrink for exactly the people whose
 *    permissions are narrowest -- contradicting the tile that opened it, for them alone.
 * 2. An unresolvable record is still a row. The work happened; this reader may not see who it was
 *    about, and saying so is truthful where dropping it is not.
 * 3. Names are resolved one page at a time. A year of submissions is a few hundred ids and the drawer
 *    shows twenty-five.
 */

const {listJobCandidateSummaries}=vi.hoisted(()=>({listJobCandidateSummaries:vi.fn()}))
vi.mock('../core/commercialRepository',()=>({listJobCandidateSummaries}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'acme'}})}))

const metric=drilldowns.find((entry)=>entry.id==='submissions')!
const definition='A unique candidate-and-job record included in a client submission package.'

const summary=(id:string,name:string)=>({
  id,candidate_id:`cand-${id}`,job_id:`job-${id}`,
  candidates:{full_name:name},jobs:{title:'Finance Manager',companies:{name:'Acme'}},
})

function renderDrawer(ids:string[]){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  const onClose=vi.fn()
  render(<QueryClientProvider client={client}><MemoryRouter>
    <ScorecardDrilldownDrawer metric={metric} definition={definition} ids={ids} onClose={onClose}/>
  </MemoryRouter></QueryClientProvider>)
  return {onClose}
}

const rowCount=async()=>{
  const table=await screen.findByRole('table')
  return within(table).getAllByRole('row').length-1
}

describe('ScorecardDrilldownDrawer',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    listJobCandidateSummaries.mockResolvedValue([summary('jc-1','Ni Putu Widya'),summary('jc-2','Kadek Ari')])
  })

  it('states the metric and its definition',async()=>{
    renderDrawer(['jc-1','jc-2'])
    expect(await screen.findByRole('heading',{name:metric.label})).toBeInTheDocument()
    expect(screen.getByText(definition)).toBeInTheDocument()
  })

  it('reports the count the tile counted',async()=>{
    renderDrawer(['jc-1','jc-2'])
    expect(await screen.findByText(/the same 2 counted by this number/)).toBeInTheDocument()
  })

  /* THE test. The resolver returns one of the two records -- the other belongs to a candidate this
   * member cannot read -- and the header must still say two, because two is what the tile said. */
  it('keeps the tile count when a record cannot be resolved',async()=>{
    listJobCandidateSummaries.mockResolvedValue([summary('jc-1','Ni Putu Widya')])
    renderDrawer(['jc-1','jc-2'])
    expect(await screen.findByText(/the same 2 counted by this number/)).toBeInTheDocument()
    expect(await rowCount()).toBe(2)
    expect(screen.getByText('Not visible to you')).toBeInTheDocument()
    expect(screen.getByText('Ni Putu Widya')).toBeInTheDocument()
  })

  it('links a resolved record to its candidate and its job',async()=>{
    renderDrawer(['jc-1'])
    expect(await screen.findByRole('link',{name:'Ni Putu Widya'})).toHaveAttribute('href','/app/acme/candidates/cand-jc-1')
    expect(screen.getByRole('link',{name:'Finance Manager'})).toHaveAttribute('href','/app/acme/jobs/job-jc-1')
  })

  it('says nothing happened rather than showing an empty table',async()=>{
    renderDrawer([])
    expect(await screen.findByText('Nothing in this period')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(listJobCandidateSummaries).not.toHaveBeenCalled()
  })

  it('resolves only the visible page',async()=>{
    const ids=Array.from({length:30},(_,index)=>`jc-${index}`)
    renderDrawer(ids)
    await waitFor(()=>expect(listJobCandidateSummaries).toHaveBeenCalled())
    expect(listJobCandidateSummaries.mock.calls[0]?.[1]).toHaveLength(25)
  })

  it('pages through the set and fetches each page once',async()=>{
    const ids=Array.from({length:30},(_,index)=>`jc-${index}`)
    renderDrawer(ids)
    // The count is the whole set, not the page: a pager that changed the total would be reporting
    // the page size as the metric.
    expect(await screen.findByText(/the same 30 counted by this number/)).toBeInTheDocument()
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button',{name:/Next/}))
    await waitFor(()=>expect(listJobCandidateSummaries).toHaveBeenCalledTimes(2))
    expect(listJobCandidateSummaries.mock.calls[1]?.[1]).toEqual(ids.slice(25))
    expect(await screen.findByText(/the same 30 counted by this number/)).toBeInTheDocument()
  })

  it('shows no pager for a set that fits on one page',async()=>{
    renderDrawer(['jc-1','jc-2'])
    await screen.findByRole('table')
    expect(screen.queryByRole('button',{name:/Next/})).toBeNull()
  })

  it('surfaces a failed resolve instead of an empty list',async()=>{
    listJobCandidateSummaries.mockRejectedValue(new Error('permission_denied'))
    renderDrawer(['jc-1'])
    expect(await screen.findByText(/permission_denied/)).toBeInTheDocument()
  })

  it('closes',async()=>{
    const {onClose}=renderDrawer(['jc-1'])
    fireEvent.click(await screen.findByRole('button',{name:'Close drawer'}))
    await waitFor(()=>expect(onClose).toHaveBeenCalled())
  })
})
