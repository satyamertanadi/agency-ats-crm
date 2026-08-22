import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {AddCandidateToJobModal} from './AddCandidateToJobModal'
import {ToastProvider} from '../../shared/ui/Toast'

const addCandidatesToJob=vi.fn().mockResolvedValue([])
const listJobHealth=vi.fn().mockResolvedValue([{id:'job-1',title:'Head of Brand Marketing',company_name:'Sembada Pangan Indonesia',status:'open',owner_name:null,candidate_count:5,waiting_count:0,salary_min:390000000,salary_max:615000000,currency:'IDR',expected_fee:123000000,fee_source:'Job override',already_in_job:false}])
const listPipelineStagesForJob=vi.fn().mockResolvedValue([{id:'stage-1',name:'Sourced'}])
const listCandidatesPage=vi.fn().mockResolvedValue({rows:[],count:0})

vi.mock('../core/repository',()=>({addCandidatesToJob:(...args:unknown[])=>addCandidatesToJob(...args),listCandidatesPage:(...args:unknown[])=>listCandidatesPage(...args),listJobHealth:(...args:unknown[])=>listJobHealth(...args),listPipelineStagesForJob:(...args:unknown[])=>listPipelineStagesForJob(...args)}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'ravalli',name:'Ravalli Talent Hub',base_currency:'IDR'}})}))

const candidate={id:'cand-1',full_name:'Galih Insan Cendekia',current_position:'Brand Manager',status:'active' as const}
const searchRow=(id:string,full_name:string)=>({id,full_name,current_position:'Brand Manager',status:'active'})

function renderModal(props:Partial<Parameters<typeof AddCandidateToJobModal>[0]>={}){
  const cache=new QueryClient({defaultOptions:{queries:{retry:false}}})
  return render(<QueryClientProvider client={cache}><ToastProvider><AddCandidateToJobModal open onClose={vi.fn()} candidates={[candidate]} {...props}/></ToastProvider></QueryClientProvider>)
}

describe('AddCandidateToJobModal',()=>{
  beforeEach(()=>{addCandidatesToJob.mockClear();listJobHealth.mockClear();listCandidatesPage.mockResolvedValue({rows:[],count:0})})

  it('calls addCandidatesToJob when Add to job is clicked',async()=>{
    renderModal()
    const jobSelect=await screen.findByLabelText('Job') as HTMLSelectElement
    await waitFor(()=>expect(jobSelect).toBeEnabled())
    fireEvent.change(jobSelect,{target:{value:'job-1'}})
    await waitFor(()=>expect(screen.getByLabelText('Starting stage')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button',{name:'Add to job'}))
    await waitFor(()=>expect(addCandidatesToJob).toHaveBeenCalledWith('org-1','job-1',['cand-1'],undefined))
  },10000)

  /* onSuccess's own hardcoded invalidations (pipeline, job-health, candidate-pipelines, today) never
   * include candidates-page -- the key the Candidates list actually reads -- which is exactly why a
   * candidate's row used to sit on "Not in a pipeline" after a successful add until an F5. onAdded is
   * the caller's only way to close that gap, and both real call sites (CandidatesPage,
   * CandidateDetailPage) now depend on it firing after every successful add. This is the one place
   * that mechanism itself is under test, independent of which query key any particular caller passes. */
  it('calls onAdded after a successful add, which is what lets a caller refresh its own list',async()=>{
    const onAdded=vi.fn().mockResolvedValue(undefined)
    renderModal({onAdded})
    const jobSelect=await screen.findByLabelText('Job') as HTMLSelectElement
    await waitFor(()=>expect(jobSelect).toBeEnabled())
    fireEvent.change(jobSelect,{target:{value:'job-1'}})
    await waitFor(()=>expect(screen.getByLabelText('Starting stage')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button',{name:'Add to job'}))
    await waitFor(()=>expect(onAdded).toHaveBeenCalledTimes(1))
  },10000)

  it('does not call onAdded when the write fails',async()=>{
    addCandidatesToJob.mockRejectedValueOnce(new Error('rls'))
    const onAdded=vi.fn().mockResolvedValue(undefined)
    renderModal({onAdded})
    const jobSelect=await screen.findByLabelText('Job') as HTMLSelectElement
    await waitFor(()=>expect(jobSelect).toBeEnabled())
    fireEvent.change(jobSelect,{target:{value:'job-1'}})
    await waitFor(()=>expect(screen.getByLabelText('Starting stage')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button',{name:'Add to job'}))
    await waitFor(()=>expect(addCandidatesToJob).toHaveBeenCalled())
    expect(onAdded).not.toHaveBeenCalled()
  },10000)

  /* Opened from a job workspace, the job is not a question: asking it would offer a picker of every
   * job in the organization with one right answer, and reading that picker is the org-wide query the
   * job side has no other reason to run. */
  it('skips the job picker and its org-wide query when opened from a job',async()=>{
    renderModal({candidates:[candidate],job:{id:'job-1',title:'Head of Brand Marketing'}})
    await screen.findByText('Add candidates to Head of Brand Marketing')
    expect(screen.queryByLabelText('Job')).not.toBeInTheDocument()
    await waitFor(()=>expect(screen.getByLabelText('Starting stage')).toBeInTheDocument())
    expect(listJobHealth).not.toHaveBeenCalled()
  },10000)

  // The whole reason the job-side modal was replaced: filling a pipeline meant one candidate per
  // trip through an unsearchable list.
  it('sends every selected candidate in one call',async()=>{
    listCandidatesPage.mockResolvedValue({rows:[searchRow('cand-1','Galih Insan Cendekia'),searchRow('cand-2','Ayu Pramesti'),searchRow('cand-3','Rangga Dewangga')],count:3})
    renderModal({candidates:[],job:{id:'job-1',title:'Head of Brand Marketing'},excludeIds:['cand-3']})
    fireEvent.click(await screen.findByLabelText(/Galih Insan Cendekia/))
    fireEvent.click(await screen.findByLabelText(/Ayu Pramesti/))
    // Waits for the stage options rather than the field: the field renders as soon as a job is known,
    // so asserting on it would race the query that decides which stage the mutation carries.
    await screen.findByRole('option',{name:'Sourced'})
    fireEvent.click(screen.getByRole('button',{name:'Add 2 to job'}))
    await waitFor(()=>expect(addCandidatesToJob).toHaveBeenCalledWith('org-1','job-1',['cand-1','cand-2'],'stage-1'))
  },10000)

  /* Listed but not selectable, rather than hidden: a candidate the consultant can see on the board
   * behind the modal disappearing from the search reads as "we could not find them". */
  it('shows candidates already on the board as unselectable',async()=>{
    listCandidatesPage.mockResolvedValue({rows:[searchRow('cand-3','Rangga Dewangga')],count:1})
    renderModal({candidates:[],job:{id:'job-1',title:'Head of Brand Marketing'},excludeIds:['cand-3']})
    const row=await screen.findByLabelText(/Rangga Dewangga/) as HTMLInputElement
    expect(row).toBeDisabled()
    expect(screen.getByText(/already in this job/)).toBeInTheDocument()
  },10000)
})
