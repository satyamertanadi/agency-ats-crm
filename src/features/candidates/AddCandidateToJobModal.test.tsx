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

const candidate={id:'cand-1',full_name:'Galih Insan Cendekia',current_position:'Brand Manager',status:'active' as const,consent_status:'granted' as const}

function renderModal(){
  const cache=new QueryClient({defaultOptions:{queries:{retry:false}}})
  return render(<QueryClientProvider client={cache}><ToastProvider><AddCandidateToJobModal open onClose={vi.fn()} candidates={[candidate]}/></ToastProvider></QueryClientProvider>)
}

describe('AddCandidateToJobModal',()=>{
  beforeEach(()=>{addCandidatesToJob.mockClear();listCandidatesPage.mockClear()})

  it('calls addCandidatesToJob when Add to job is clicked',async()=>{
    renderModal()
    const jobSelect=await screen.findByLabelText('Job') as HTMLSelectElement
    await waitFor(()=>expect(jobSelect).toBeEnabled())
    fireEvent.change(jobSelect,{target:{value:'job-1'}})
    await waitFor(()=>expect(screen.getByLabelText('Starting stage')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button',{name:'Add to job'}))
    await waitFor(()=>expect(addCandidatesToJob).toHaveBeenCalledWith('org-1','job-1',['cand-1'],undefined))
  },10000)

  /* fixedJob is what replaced the job workspace's bare 100-row `<Select>` -- the job step must not
   * reappear once the caller already knows the job, or this is just the old picker with extra steps. */
  describe('opened from a job (fixedJob)',()=>{
    const searchResults=[
      {id:'cand-2',full_name:'Ana Chen',current_position:'Marketing Lead',status:'active',consent_status:'granted'},
      {id:'cand-3',full_name:'Budi Hartono',current_position:'Brand Manager',status:'active',consent_status:'granted'},
    ]

    function renderFixed(excludeCandidateIds:string[]=[]){
      listCandidatesPage.mockResolvedValue({rows:searchResults,count:searchResults.length})
      const cache=new QueryClient({defaultOptions:{queries:{retry:false}}})
      return render(<QueryClientProvider client={cache}><ToastProvider>
        <AddCandidateToJobModal open onClose={vi.fn()} fixedJob={{id:'job-1',title:'Head of Brand Marketing',companyName:'Sembada Pangan Indonesia'}} excludeCandidateIds={excludeCandidateIds}/>
      </ToastProvider></QueryClientProvider>)
    }

    it('skips the Job field entirely and never renders it',async()=>{
      renderFixed()
      await screen.findByText('Ana Chen · Marketing Lead')
      expect(screen.queryByLabelText('Job')).not.toBeInTheDocument()
    })

    it('sends every checked candidate to the known job in one call',async()=>{
      renderFixed()
      fireEvent.click(await screen.findByLabelText('Ana Chen · Marketing Lead'))
      fireEvent.click(screen.getByLabelText('Budi Hartono · Brand Manager'))
      // jobId is known from the first render here (no "choose a job" step to wait through), so the
      // stages query has already settled and stage-1 is the auto-selected starting stage by the time
      // this fires -- unlike the fixed-candidates test above, which clicks before that effect runs.
      await waitFor(()=>expect(screen.getByLabelText('Starting stage')).toHaveValue('stage-1'))
      fireEvent.click(screen.getByRole('button',{name:'Add 2 to job'}))
      await waitFor(()=>expect(addCandidatesToJob).toHaveBeenCalledWith('org-1','job-1',['cand-2','cand-3'],'stage-1'))
    },10000)

    /* add_candidates_to_job already refuses a duplicate server-side -- this is the earlier failure,
     * so the consultant never sees an already-added candidate as an option to begin with. */
    it('filters out candidates already on this job pipeline',async()=>{
      renderFixed(['cand-2'])
      await waitFor(()=>expect(listCandidatesPage).toHaveBeenCalled())
      expect(screen.queryByText('Ana Chen · Marketing Lead')).not.toBeInTheDocument()
      expect(await screen.findByText('Budi Hartono · Brand Manager')).toBeInTheDocument()
    })
  })
})
