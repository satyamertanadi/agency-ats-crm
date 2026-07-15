import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {render,screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {DashboardPage} from './DashboardPage'

const {dashboardSummary,listTeamMembers}=vi.hoisted(()=>({dashboardSummary:vi.fn(),listTeamMembers:vi.fn()}))
vi.mock('../core/repository',()=>({dashboardSummary,dismissSetupChecklist:vi.fn()}))
vi.mock('../core/commercialRepository',()=>({listTeamMembers}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'northstar',name:'Northstar Search',base_currency:'USD'}})}))
vi.mock('../../app/AuthProvider',()=>({useAuth:()=>({user:{id:'user-1',user_metadata:{full_name:'Satya Rao'}}})}))

const emptyWorkspace={activeJobs:0,candidates:0,overdueTasks:[],interviews:0,offers:0,placements:[],activities:[],
  companies:0,contacts:0,pipelineEntries:0,members:1,setupDismissedAt:null}
const runningWorkspace={...emptyWorkspace,activeJobs:3,candidates:12,companies:2,contacts:2,pipelineEntries:5,members:4}

function renderDashboard(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><MemoryRouter><DashboardPage/></MemoryRouter></QueryClientProvider>)
}

describe('DashboardPage first run',()=>{
  beforeEach(()=>{vi.clearAllMocks();listTeamMembers.mockResolvedValue([{user_id:'user-1',member_roles:[{roles:{role_key:'owner'}}]}])})

  // The load-bearing assertion: an empty workspace must never be told it is on track.
  it('does not claim the agency is on track before setup',async()=>{
    dashboardSummary.mockResolvedValue(emptyWorkspace)
    renderDashboard()
    expect(await screen.findByText('Let’s get your agency set up')).toBeInTheDocument()
    expect(screen.queryByText('Your agency is on track')).not.toBeInTheDocument()
  })

  it('shows the setup checklist with only the first step actionable',async()=>{
    dashboardSummary.mockResolvedValue(emptyWorkspace)
    renderDashboard()
    expect(await screen.findByRole('heading',{name:'Set up your agency'})).toBeInTheDocument()
    expect(screen.getByText('0 of 6 done · next: add your first client company')).toBeInTheDocument()
    expect(screen.getByRole('link',{name:'Add company'})).toHaveAttribute('href','/app/northstar/companies')
    expect(screen.queryByRole('link',{name:'Create vacancy'})).not.toBeInTheDocument()
    expect(screen.getAllByText('Earlier step first')).toHaveLength(5)
  })

  it('restores the operating brief once setup is complete',async()=>{
    dashboardSummary.mockResolvedValue(runningWorkspace)
    renderDashboard()
    expect(await screen.findByText('Your agency is on track')).toBeInTheDocument()
    expect(screen.queryByRole('heading',{name:'Set up your agency'})).not.toBeInTheDocument()
    expect(screen.getByText('3 active vacancies · 0 interviews in the next seven days · 0 offers in progress')).toBeInTheDocument()
  })

  it('still reports overdue work ahead of the on-track message',async()=>{
    dashboardSummary.mockResolvedValue({...runningWorkspace,overdueTasks:[{id:'t1',title:'Call client',due_at:'2026-01-01T00:00:00Z',priority:'high'}]})
    renderDashboard()
    expect(await screen.findByText('1 action needs attention')).toBeInTheDocument()
  })

  it('hides the dismiss control from members who cannot manage the workspace',async()=>{
    dashboardSummary.mockResolvedValue(emptyWorkspace)
    listTeamMembers.mockResolvedValue([{user_id:'user-1',member_roles:[{roles:{role_key:'consultant'}}]}])
    renderDashboard()
    expect(await screen.findByRole('heading',{name:'Set up your agency'})).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Hide this'})).not.toBeInTheDocument()
  })

  it('lets an owner dismiss the checklist',async()=>{
    dashboardSummary.mockResolvedValue(emptyWorkspace)
    renderDashboard()
    expect(await screen.findByRole('button',{name:'Hide this'})).toBeInTheDocument()
  })

  it('respects a previous dismissal without hiding real progress',async()=>{
    dashboardSummary.mockResolvedValue({...emptyWorkspace,setupDismissedAt:'2026-07-01T00:00:00Z'})
    renderDashboard()
    expect(await screen.findByText('Let’s get your agency set up')).toBeInTheDocument()
    expect(screen.queryByRole('heading',{name:'Set up your agency'})).not.toBeInTheDocument()
  })
})
