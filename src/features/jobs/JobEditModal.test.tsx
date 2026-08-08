import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {JobEditModal} from './JobEditModal'
import type {Job} from '../../shared/types/domain'

/* Salary and fee were editable only at job creation. Once a role went live, a fee agreed with the
 * client afterward -- which is the common case, not the exception -- had nowhere to go. */

const {updateJob}=vi.hoisted(()=>({updateJob:vi.fn()}))
vi.mock('../core/commercialRepository',()=>({updateJob}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'northstar',base_currency:'USD',salary_period:'monthly'}})}))

const job=(overrides:Partial<Job>={}):Job=>({id:'job-1',organization_id:'org-1',company_id:'co-1',pipeline_id:'pipe-1',title:'Head of Brand',
  location:null,priority:'normal',status:'open',currency:null,salary_min:null,salary_max:null,placement_fee_percentage:null,fixed_fee:null,
  description:null,owner_member_id:null,opened_at:'2026-07-01T00:00:00Z',updated_at:'2026-07-01T00:00:00Z',...overrides})

function renderModal(jobRow=job()){
  const onSaved=vi.fn().mockResolvedValue(undefined)
  const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  render(<QueryClientProvider client={cache}>
    <JobEditModal job={jobRow} members={[]} open onClose={vi.fn()} onSaved={onSaved}/>
  </QueryClientProvider>)
  return {onSaved}
}

describe('JobEditModal',()=>{
  beforeEach(()=>{updateJob.mockClear();updateJob.mockResolvedValue(undefined)})

  it('labels salary fields by the workspace salary period',()=>{
    renderModal()
    expect(screen.getByLabelText('Salary minimum (per month)')).toBeInTheDocument()
    expect(screen.getByLabelText('Salary maximum (per month)')).toBeInTheDocument()
  })

  it('saves salary, currency, and a percentage fee override in one call',async()=>{
    renderModal()
    fireEvent.change(screen.getByLabelText('Salary minimum (per month)'),{target:{value:'20000000'}})
    fireEvent.change(screen.getByLabelText('Salary maximum (per month)'),{target:{value:'30000000'}})
    fireEvent.change(screen.getByLabelText('Currency'),{target:{value:'idr'}})
    fireEvent.change(screen.getByLabelText('Placement fee'),{target:{value:'percentage'}})
    fireEvent.change(screen.getByLabelText('Percentage'),{target:{value:'18'}})
    fireEvent.click(screen.getByRole('button',{name:'Save job'}))
    await waitFor(()=>expect(updateJob).toHaveBeenCalledWith('org-1','job-1',expect.objectContaining({
      salary_min:20000000,salary_max:30000000,currency:'IDR',placement_fee_percentage:18,fixed_fee:null,
    })))
  })

  it('clears the fee columns when the override is switched back to the account agreement',async()=>{
    renderModal(job({fixed_fee:50_000_000}))
    // Starts on 'fixed' because the job already carries a fixed_fee -- this is the reverse path,
    // switching an existing override off.
    expect(screen.getByLabelText('Placement fee')).toHaveValue('fixed')
    fireEvent.change(screen.getByLabelText('Placement fee'),{target:{value:'none'}})
    expect(screen.queryByLabelText('Fixed fee amount')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Save job'}))
    await waitFor(()=>expect(updateJob).toHaveBeenCalledWith('org-1','job-1',expect.objectContaining({
      placement_fee_percentage:null,fixed_fee:null,
    })))
  })

  it('blocks saving when the salary maximum is below the minimum',()=>{
    renderModal()
    fireEvent.change(screen.getByLabelText('Salary minimum (per month)'),{target:{value:'30000000'}})
    fireEvent.change(screen.getByLabelText('Salary maximum (per month)'),{target:{value:'20000000'}})
    expect(screen.getByText('Maximum cannot be less than minimum.')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Save job'})).toBeDisabled()
  })

  it('blocks saving a percentage override with no percentage entered',()=>{
    renderModal()
    fireEvent.change(screen.getByLabelText('Placement fee'),{target:{value:'percentage'}})
    expect(screen.getByRole('button',{name:'Save job'})).toBeDisabled()
  })
})
