import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {CompanyPipelineRow} from '../../shared/types/domain'
import {ClientsPage} from './ClientsPage'
import {ToastProvider} from '../../shared/ui/Toast'

/* Industry became a curated key rather than free text. Three things have to hold for that to be an
 * improvement rather than a data-loss event: the drawer writes the KEY, the filter groups a legacy
 * spelling under the option a consultant picks today, and a sector nobody anticipated still renders. */

const {createCompany,createContact,listContacts,listCompanyPipeline,listTeamMembers}=vi.hoisted(()=>({
  createCompany:vi.fn(),createContact:vi.fn(),listContacts:vi.fn(),
  listCompanyPipeline:vi.fn(),listTeamMembers:vi.fn(),
}))

vi.mock('../core/repository',()=>({createCompany,createContact,listContacts}))
vi.mock('../core/commercialRepository',()=>({
  listCompanyPipeline,listTeamMembers,
  listSavedViews:vi.fn().mockResolvedValue([]),saveView:vi.fn(),deleteSavedView:vi.fn(),
}))
// The board is a drag-and-drop surface with its own mutations; none of that is what these tests cover.
vi.mock('./BdBoard',()=>({BdBoard:()=><div>BD board</div>,BdRiskSummary:()=>null}))
vi.mock('../../app/AuthProvider',()=>({useAuth:()=>({user:{id:'user-1'}})}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({
  organization:{id:'org-1',slug:'ravalli',base_currency:'IDR'},
  // SavedViewBar resolves the current member off memberships to own the view it saves.
  memberships:[{id:'member-1',organization_id:'org-1',user_id:'user-1'}],
})}))
vi.mock('../../app/useWorkspaceCapabilities',()=>({useWorkspaceCapabilities:()=>({data:{canWriteClients:true},isLoading:false})}))

const row=(over:Partial<CompanyPipelineRow>):CompanyPipelineRow=>({
  id:'co-1',name:'Meridian Hospitality',industry:'hospitality',location:'Bali',account_status:'prospect',
  business_development_stage:'lead',owner_member_id:null,owner_name:null,contact_count:0,open_jobs:0,
  active_candidates:0,next_follow_up_at:null,last_activity_at:null,placements:0,terms_status:'none',
  fee_type:null,fee_percentage:null,fixed_fee:null,currency:null,guarantee_days:null,terms_effective_to:null,
  expected_open_fee:0,updated_at:'2026-08-01T00:00:00Z',...over,
})

function renderPage(){
  const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  render(<QueryClientProvider client={cache}><ToastProvider><MemoryRouter>
    <ClientsPage/>
  </MemoryRouter></ToastProvider></QueryClientProvider>)
}

describe('ClientsPage industry',()=>{
  beforeEach(()=>{
    createCompany.mockReset();createCompany.mockResolvedValue('co-new')
    createContact.mockReset();listContacts.mockResolvedValue([])
    listTeamMembers.mockResolvedValue([])
    listCompanyPipeline.mockResolvedValue([
      row({id:'co-1',name:'Meridian Hospitality',industry:'hospitality'}),
      // Stored before the dropdown existed, and stored as an abbreviation -- the case the alias table
      // is for. It has to group under Food & beverage without anyone re-editing the record.
      row({id:'co-2',name:'Warung Group',industry:'F&B'}),
      // A sector the curated list has never heard of, i.e. what "Other" produces.
      row({id:'co-3',name:'Bayu Charters',industry:'Yacht chartering'}),
    ])
  })

  it('submits the canonical key the consultant picked, not the label',async()=>{
    renderPage()
    fireEvent.click(await screen.findByRole('button',{name:'Add client'}))
    fireEvent.change(screen.getByLabelText('Client name'),{target:{value:'Nusa Villas'}})
    fireEvent.change(screen.getByLabelText('Industry'),{target:{value:'food_beverage'}})
    fireEvent.click(screen.getByRole('button',{name:'Create client'}))
    await waitFor(()=>expect(createCompany).toHaveBeenCalled())
    expect(createCompany.mock.calls[0]?.[2]).toMatchObject({name:'Nusa Villas',industry:'food_beverage'})
  })

  it('sends free text through verbatim when the sector is not on the list',async()=>{
    renderPage()
    fireEvent.click(await screen.findByRole('button',{name:'Add client'}))
    fireEvent.change(screen.getByLabelText('Client name'),{target:{value:'Bayu Charters'}})
    fireEvent.change(screen.getByLabelText('Industry'),{target:{value:'__other__'}})
    fireEvent.change(screen.getByRole('textbox',{name:'Industry — other'}),{target:{value:'Yacht chartering'}})
    fireEvent.click(screen.getByRole('button',{name:'Create client'}))
    await waitFor(()=>expect(createCompany).toHaveBeenCalled())
    expect(createCompany.mock.calls[0]?.[2]).toMatchObject({industry:'Yacht chartering'})
  })

  it('renders curated, legacy and unrecognised sectors readably',async()=>{
    renderPage()
    // Scoped to the table: the filter offers the same words as <option>s, and an unscoped query would
    // match those instead of proving the rows render.
    const table=within(await screen.findByRole('table'))
    expect(table.getByText('Hospitality')).toBeInTheDocument()
    // 'F&B' resolves through the alias table, so the row reads as the sector it belongs to.
    expect(table.getByText('Food & beverage')).toBeInTheDocument()
    // And a value nobody anticipated is shown exactly as typed rather than blanked or key-shaped.
    expect(table.getByText('Yacht chartering')).toBeInTheDocument()
  })

  it('offers only the industries this workspace actually has',async()=>{
    renderPage()
    const filter=await screen.findByRole('combobox',{name:'Filter by industry'})
    const labels=[...filter.querySelectorAll('option')].map((option)=>option.textContent)
    expect(labels).toEqual(['All industries','Hospitality','Food & beverage','Yacht chartering'])
    // A filter listing twenty empty buckets teaches people to ignore it.
    expect(labels).not.toContain('Mining')
  })

  it('groups a legacy spelling under the option a consultant picks today',async()=>{
    renderPage()
    const filter=await screen.findByRole('combobox',{name:'Filter by industry'})
    fireEvent.change(filter,{target:{value:'food_beverage'}})
    expect(await screen.findByText('Warung Group')).toBeInTheDocument()
    expect(screen.queryByText('Meridian Hospitality')).not.toBeInTheDocument()
    expect(screen.getByText('1 clients')).toBeInTheDocument()
  })

  it('finds a keyed row by the label a consultant reads',async()=>{
    renderPage()
    // The column now stores `food_beverage`; nobody types that.
    fireEvent.change(await screen.findByLabelText('Search clients'),{target:{value:'food & bev'}})
    expect(await screen.findByText('Warung Group')).toBeInTheDocument()
    expect(screen.queryByText('Meridian Hospitality')).not.toBeInTheDocument()
  })
})
