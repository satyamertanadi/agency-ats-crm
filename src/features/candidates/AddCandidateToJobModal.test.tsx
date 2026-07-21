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
  beforeEach(()=>{addCandidatesToJob.mockClear()})

  it('calls addCandidatesToJob when Add to job is clicked',async()=>{
    renderModal()
    const jobSelect=await screen.findByLabelText('Job') as HTMLSelectElement
    await waitFor(()=>expect(jobSelect).toBeEnabled())
    fireEvent.change(jobSelect,{target:{value:'job-1'}})
    await waitFor(()=>expect(screen.getByLabelText('Starting stage')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button',{name:'Add to job'}))
    await waitFor(()=>expect(addCandidatesToJob).toHaveBeenCalledWith('org-1','job-1',['cand-1'],undefined))
  },10000)
})
