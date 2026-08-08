import {useState} from 'react'
import {useMutation} from '@tanstack/react-query'
import {useOrganization} from '../../app/OrganizationProvider'
import {updateJob} from '../core/commercialRepository'
import type {Job} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'

/* Fee type is a UI-only distinction -- jobs carries placement_fee_percentage and fixed_fee as two
 * independent nullable columns, no fee_type column of its own. 'none' means both stay null and
 * list_job_health falls through to the account's commercial_terms; the formula that turns whichever
 * one is set into an expected_fee number lives entirely in that RPC and is not reproduced here. */
export type JobFeeType='none'|'percentage'|'fixed'

export function JobEditModal({job,members,open,onClose,onSaved}:{job:Job;members:Array<{id:string;status:string;profiles?:{full_name?:string;email?:string}|null}>;open:boolean;onClose:()=>void;onSaved:()=>Promise<void>}){
  const {organization}=useOrganization()
  const [title,setTitle]=useState(job.title);const [location,setLocation]=useState(job.location||'');const [priority,setPriority]=useState(job.priority);const [status,setStatus]=useState(job.status);const [owner,setOwner]=useState(job.owner_member_id||'');const [description,setDescription]=useState(job.description||'')
  const [salaryMin,setSalaryMin]=useState(job.salary_min?.toString()||'');const [salaryMax,setSalaryMax]=useState(job.salary_max?.toString()||'');const [currency,setCurrency]=useState(job.currency||organization?.base_currency||'')
  const [feeType,setFeeType]=useState<JobFeeType>(job.fixed_fee!=null?'fixed':job.placement_fee_percentage!=null?'percentage':'none')
  const [feePercentage,setFeePercentage]=useState(job.placement_fee_percentage?.toString()||'');const [fixedFee,setFixedFee]=useState(job.fixed_fee?.toString()||'')
  const periodLabel=organization?.salary_period==='monthly'?'month':'year'
  const salaryRangeInvalid=Boolean(salaryMin&&salaryMax&&Number(salaryMin)>Number(salaryMax))
  const mutation=useMutation({mutationFn:()=>updateJob(job.organization_id,job.id,{title,location:location||null,priority,status,owner_member_id:owner||null,description:description||null,
    salary_min:salaryMin?Number(salaryMin):null,salary_max:salaryMax?Number(salaryMax):null,currency:currency||null,
    placement_fee_percentage:feeType==='percentage'&&feePercentage?Number(feePercentage):null,
    fixed_fee:feeType==='fixed'&&fixedFee?Number(fixedFee):null}),onSuccess:onSaved})
  return <Modal title="Edit job" open={open} onClose={onClose}><div className="stack"><Field label="Job title"><Input value={title} onChange={(event)=>setTitle(event.target.value)}/></Field><div className="form-grid"><Field label="Owner"><Select value={owner} onChange={(event)=>setOwner(event.target.value)}><option value="">Unassigned</option>{members.filter((member)=>member.status==='active').map((member)=><option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><Field label="Location"><Input value={location} onChange={(event)=>setLocation(event.target.value)}/></Field><Field label="Priority"><Select value={priority} onChange={(event)=>setPriority(event.target.value as Job['priority'])}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field><Field label="Status"><Select value={status} onChange={(event)=>setStatus(event.target.value as Job['status'])}><option value="draft">Draft</option><option value="open">Open</option><option value="on_hold">On hold</option><option value="filled">Filled</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></Select></Field></div>
    <div className="form-grid">
      <Field label={`Salary minimum (per ${periodLabel})`}><Input type="number" min="0" value={salaryMin} onChange={(event)=>setSalaryMin(event.target.value)}/></Field>
      <Field label={`Salary maximum (per ${periodLabel})`} error={salaryRangeInvalid?'Maximum cannot be less than minimum.':undefined}><Input type="number" min="0" value={salaryMax} onChange={(event)=>setSalaryMax(event.target.value)}/></Field>
      <Field label="Currency"><Input maxLength={3} value={currency} onChange={(event)=>setCurrency(event.target.value.toUpperCase())}/></Field>
    </div>
    {/* Was void before this -- editable only at job creation, so a fee agreed after a role went live
      * had nowhere to go. This is what turns on 'Job override' in list_job_health's fee_source. */}
    <div className="form-grid">
      <Field label="Placement fee"><Select value={feeType} onChange={(event)=>setFeeType(event.target.value as JobFeeType)}><option value="none">Use the client's account agreement</option><option value="percentage">Percentage of annual salary</option><option value="fixed">Fixed fee</option></Select></Field>
      {feeType==='percentage'&&<Field label="Percentage"><Input type="number" min="0" max="100" step="0.001" value={feePercentage} onChange={(event)=>setFeePercentage(event.target.value)}/></Field>}
      {feeType==='fixed'&&<Field label="Fixed fee amount"><Input type="number" min="0" step="0.01" value={fixedFee} onChange={(event)=>setFixedFee(event.target.value)}/></Field>}
    </div>
    <details className="advanced-fields"><summary>Advanced details</summary><Field label="Description"><Textarea value={description} onChange={(event)=>setDescription(event.target.value)}/></Field></details>{mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button loading={mutation.isPending} disabled={title.trim().length<2||salaryRangeInvalid||(feeType==='percentage'&&!feePercentage)||(feeType==='fixed'&&!fixedFee)} onClick={()=>mutation.mutate()}>Save job</Button></div></div></Modal>
}
