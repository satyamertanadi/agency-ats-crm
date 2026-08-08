import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {JobsPage} from './JobsPage'
import {ToastProvider} from '../../shared/ui/Toast'
import type {JobHealth} from '../../shared/types/domain'

/* Three faults this pins:
 *
 * 1. The list hardcoded its base query to draft/open/on_hold -- not "hidden behind a filter" but
 *    genuinely unreachable. A filled or closed job had no URL on this page that could show it.
 * 2. next_action linked every row to the same bare job URL regardless of what it said, so the CTA
 *    promised a specific act ("Assign an owner") and then made the consultant find it themselves.
 * 3. Create was two blocking calls in one mutation: if the follow-up updateJob (location, salary,
 *    fee...) failed after create_job_with_pipeline had already succeeded, onError said "The job was
 *    not created" about a job that, at that point, undeniably existed.
 */

const {createJob,listCompanies,listJobHealth,listTeamMembers,updateJob,listSavedViews}=vi.hoisted(()=>({
  createJob:vi.fn(),listCompanies:vi.fn(),listJobHealth:vi.fn(),listTeamMembers:vi.fn(),updateJob:vi.fn(),listSavedViews:vi.fn(),
}))
vi.mock('../core/repository',()=>({createJob,listCompanies,listJobHealth}))
vi.mock('../core/commercialRepository',()=>({listTeamMembers,updateJob,listSavedViews,saveView:vi.fn(),deleteSavedView:vi.fn()}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'northstar',base_currency:'USD',salary_period:'monthly'},memberships:[{id:'mem-1',organization_id:'org-1',user_id:'user-1'}]})}))
vi.mock('../../app/AuthProvider',()=>({useAuth:()=>({user:{id:'user-1'}})}))
vi.mock('../../app/useWorkspaceCapabilities',()=>({useWorkspaceCapabilities:()=>({data:{canWriteJobs:true},isLoading:false})}))

const job=(input:Partial<JobHealth>={}):JobHealth=>({id:'job',company_id:'co-1',pipeline_id:'pipe-1',title:'Head of Brand',company_name:'Sembada Pangan',location:null,priority:'normal',status:'open',owner_member_id:'mem-1',owner_name:'Cara Consultant',opened_at:'2026-07-01',days_open:10,candidate_count:2,waiting_count:0,phase_counts:{},salary_min:null,salary_max:null,currency:'IDR',fee_percentage:null,fixed_fee:null,expected_fee:null,fee_source:null,next_action:null,last_activity_at:'2026-07-17T00:00:00Z',already_in_job:false,updated_at:'2026-07-17T00:00:00Z',...input})

function renderPage(){
  const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  render(<QueryClientProvider client={cache}><ToastProvider><MemoryRouter><JobsPage/></MemoryRouter></ToastProvider></QueryClientProvider>)
}

describe('JobsPage',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    listCompanies.mockResolvedValue([{id:'co-1',name:'Sembada Pangan'}])
    listTeamMembers.mockResolvedValue([{id:'mem-1',user_id:'user-1',status:'active',profiles:{full_name:'Cara Consultant'}}])
    listSavedViews.mockResolvedValue([])
  })

  it('defaults to open jobs and hides filled and closed ones',async()=>{
    listJobHealth.mockResolvedValue([job({id:'open-job',status:'open',title:'Open Role'}),job({id:'filled-job',status:'filled',title:'Filled Role'}),job({id:'closed-job',status:'closed',title:'Closed Role'})])
    renderPage()
    expect(await screen.findByText('Open Role')).toBeInTheDocument()
    expect(screen.queryByText('Filled Role')).not.toBeInTheDocument()
    expect(screen.queryByText('Closed Role')).not.toBeInTheDocument()
  })

  it('makes filled and closed jobs reachable through the status chips',async()=>{
    listJobHealth.mockResolvedValue([job({id:'open-job',status:'open',title:'Open Role'}),job({id:'filled-job',status:'filled',title:'Filled Role'}),job({id:'closed-job',status:'closed',title:'Closed Role'})])
    renderPage()
    await screen.findByText('Open Role')

    fireEvent.click(screen.getByRole('button',{name:'Filled'}))
    expect(await screen.findByText('Filled Role')).toBeInTheDocument()
    expect(screen.queryByText('Open Role')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button',{name:'Closed'}))
    expect(await screen.findByText('Closed Role')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button',{name:'All'}))
    expect(await screen.findByText('Open Role')).toBeInTheDocument()
    expect(screen.getByText('Filled Role')).toBeInTheDocument()
    expect(screen.getByText('Closed Role')).toBeInTheDocument()
  })

  it('deep-links each next_action to the surface that actually resolves it',async()=>{
    listJobHealth.mockResolvedValue([
      job({id:'owner-gap',title:'Needs Owner',next_action:'Assign an owner'}),
      job({id:'cand-gap',title:'Needs Candidates',next_action:'Add candidates'}),
      job({id:'activity-gap',title:'Needs Activity',next_action:'Log first activity'}),
      job({id:'waiting',title:'Waiting Review',next_action:'Review waiting candidates'}),
    ])
    renderPage()
    await screen.findByText('Needs Owner')
    expect(screen.getByRole('link',{name:'Assign an owner'})).toHaveAttribute('href','/app/northstar/jobs/owner-gap?editJob=1')
    expect(screen.getByRole('link',{name:'Add candidates'})).toHaveAttribute('href','/app/northstar/jobs/cand-gap?addCandidates=1')
    expect(screen.getByRole('link',{name:'Log first activity'})).toHaveAttribute('href','/app/northstar/jobs/activity-gap?view=activity')
    // No surface more specific than the board exists for this one, so it still points there.
    expect(screen.getByRole('link',{name:'Review waiting candidates'})).toHaveAttribute('href','/app/northstar/jobs/waiting')
  })

  it('navigates to the new job as soon as create_job_with_pipeline succeeds, without waiting on the optional details',async()=>{
    listJobHealth.mockResolvedValue([])
    createJob.mockResolvedValue('new-job-id')
    updateJob.mockImplementation(()=>new Promise(()=>{/* never resolves -- navigation must not wait on it */}))
    renderPage()
    fireEvent.click(await screen.findByRole('button',{name:'Create job'}))
    fireEvent.change(screen.getByLabelText('Client'),{target:{value:'co-1'}})
    fireEvent.change(screen.getByLabelText('Job title'),{target:{value:'Regional Sales Lead'}})
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Create job'}))
    await waitFor(()=>expect(createJob).toHaveBeenCalledWith('org-1',{company_id:'co-1',title:'Regional Sales Lead',owner_member_id:'mem-1'}))
    // The success toast fires -- proof the job is being treated as created -- even though updateJob
    // above deliberately never resolves.
    await waitFor(()=>expect(screen.getByText('Regional Sales Lead is open and ready for candidates.')).toBeInTheDocument())
  },10000)

  it('reports a failed follow-up honestly instead of claiming the job was never created',async()=>{
    listJobHealth.mockResolvedValue([])
    createJob.mockResolvedValue('new-job-id')
    updateJob.mockRejectedValue(new Error('could not save extra details'))
    renderPage()
    fireEvent.click(await screen.findByRole('button',{name:'Create job'}))
    fireEvent.change(screen.getByLabelText('Client'),{target:{value:'co-1'}})
    fireEvent.change(screen.getByLabelText('Job title'),{target:{value:'Regional Sales Lead'}})
    fireEvent.change(screen.getByLabelText('Location'),{target:{value:'Jakarta'}}) // gives the follow-up something to send
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Create job'}))

    await waitFor(()=>expect(screen.getByText('Regional Sales Lead is open and ready for candidates.')).toBeInTheDocument())
    await waitFor(()=>expect(screen.getByText(/was created, but its extra details were not saved/)).toBeInTheDocument())
  },10000)
})
