import {useCallback,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Plus,Search} from 'lucide-react'
import {Link,useNavigate,useSearchParams} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {createJob,listCompanies,listJobHealth} from '../core/repository'
import {listTeamMembers,updateJob} from '../core/commercialRepository'
import {formatMoney,formatSalary} from '../../shared/lib/format'
import {jobPriority,jobStatus} from '../../shared/lib/status'
import {useOpenOnNewParam} from '../../shared/lib/useOpenOnNewParam'
import {Button} from '../../shared/ui/Button'
import {Drawer} from '../../shared/ui/Drawer'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {LocationField} from '../../shared/ui/LocationField'
import {currencyOptions} from '../../shared/lib/currencies'
import {OptionSelect} from '../../shared/ui/OptionSelect'
import {employmentType} from '../../shared/lib/optionSets'
import {Page,Panel,StatusBadge} from '../../shared/ui/Page'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {SavedViewBar} from '../core/SavedViewBar'
import {csvFilename,downloadCsv,toCsv} from '../../shared/lib/csv'
import {useToast} from '../../shared/ui/Toast'
import {Table} from '../../shared/ui/Table'
import {filterJobHealth,filterJobStatus,nextActionDetail,nextActionHref,phaseSegments,type JobHealthFilter,type JobStatusFilter} from './jobHealth'

const filters:Array<[JobHealthFilter,string]>=[['all','All health'],['unowned','Unowned'],['empty','No candidates'],['stale','Stale'],['interview','Interview'],['offer','Offer'],['high_value','High value'],['urgent','Urgent']]
const statusFilters:Array<[JobStatusFilter,string]>=[['active','Active'],['filled','Filled'],['closed','Closed'],['all','All']]

export function JobsPage(){
  const {organization,membership}=useOrganization();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast();const navigate=useNavigate();const [open,setOpen]=useState(false);const [params,setParams]=useSearchParams()
  const search=params.get('q')||'';const filter=(params.get('health') as JobHealthFilter)||'all';const statusFilter=(params.get('status') as JobStatusFilter)||'active'
  const setParam=(key:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);setParams(next,{replace:true})}
  const currentMember=membership;const [companyId,setCompanyId]=useState('');const [title,setTitle]=useState('');const [owner,setOwner]=useState(currentMember?.id||'');const [location,setLocation]=useState('');const [priority,setPriority]=useState('normal')
  const [description,setDescription]=useState('');const [employment,setEmployment]=useState('permanent');const [salaryMin,setSalaryMin]=useState('');const [salaryMax,setSalaryMax]=useState('');const [currency,setCurrency]=useState(organization?.base_currency||'USD')
  const prefillCompany=useCallback((params:URLSearchParams)=>{const company=params.get('company');if(!company)return [];setCompanyId(company);return ['company']},[setCompanyId])
  useOpenOnNewParam(setOpen,prefillCompany)
  const jobs=useQuery({queryKey:['job-health',organization?.id],enabled:Boolean(organization),queryFn:()=>listJobHealth(organization!.id)});const companies=useQuery({queryKey:['companies',organization?.id],enabled:Boolean(organization),queryFn:()=>listCompanies(organization!.id)});const team=useQuery({queryKey:['team',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  /* Job, pipeline, stages and commercial details are committed by one database transaction. */
  const mutation=useMutation({
    mutationFn:async()=>{
      const details={location:location||null,priority,employment_type:employment||null,description:description||null,salary_min:salaryMin?Number(salaryMin):null,salary_max:salaryMax?Number(salaryMax):null,currency:currency||null}
      return createJob(organization!.id,{company_id:companyId,title,owner_member_id:owner||undefined,details})
    },
    onSuccess:async(id)=>{
      setOpen(false);setTitle('');setLocation('');setDescription('');setSalaryMin('');setSalaryMax('')
      await Promise.all([cache.invalidateQueries({queryKey:['jobs',organization?.id]}),cache.invalidateQueries({queryKey:['job-health',organization?.id]})])
      navigate(`/app/${organization!.slug}/jobs/${id}`)
      toast.success(`${title} is open and ready for candidates.`)
    },
    onError:(error)=>toast.error(error,'The job was not created.'),
  })
  const assign=useMutation({mutationFn:({id,ownerId}:{id:string;ownerId:string})=>updateJob(organization!.id,id,{owner_member_id:ownerId||null}),onSuccess:async(_data,{id,ownerId})=>{await cache.invalidateQueries({queryKey:['job-health',organization?.id]});const job=jobs.data?.find((entry)=>entry.id===id);const owner=team.data?.find((member)=>member.id===ownerId);toast.success(owner?`${owner.profiles?.full_name||owner.profiles?.email||'A consultant'} now owns ${job?.title||'this job'}.`:`${job?.title||'This job'} has no owner.`)},onError:(error)=>toast.error(error,'Ownership is unchanged.')})
  const needle=search.trim().toLowerCase();const visible=filterJobHealth(filterJobStatus(jobs.data||[],statusFilter),filter).filter((job)=>!needle||[job.title,job.company_name,job.location,job.owner_name].some((value)=>value?.toLowerCase().includes(needle))).sort((a,b)=>(a.priority==='urgent'?0:a.priority==='high'?1:2)-(b.priority==='urgent'?0:b.priority==='high'?1:2)||b.days_open-a.days_open)
  // Jobs are already fully loaded and filtered in memory, so the export writes exactly what the
  // table is showing -- no second fetch that could disagree with it.
  const exportView=useMutation({
    mutationFn:async()=>visible,
    onSuccess:(rows)=>{
      downloadCsv(csvFilename('jobs'),toCsv(rows.map((job)=>({title:job.title,client:job.company_name,owner:job.owner_name||'',status:job.status,priority:job.priority,location:job.location||'',days_open:job.days_open,candidates:job.candidate_count,waiting:job.waiting_count,salary_min:job.salary_min??'',salary_max:job.salary_max??'',expected_fee:job.expected_fee??'',fee_source:job.fee_source||'',next_action:job.next_action||''}))))
      toast.success(`Exported ${rows.length} ${rows.length===1?'job':'jobs'}.`)
    },
    onError:(error)=>toast.error(error,'Nothing was exported.'),
  })
  const loading=jobs.isLoading||companies.isLoading||team.isLoading||capabilities.isLoading
  const pageError=jobs.error||companies.error||team.error
  return <Page title="Jobs" eyebrow="Recruitment delivery" actions={capabilities.data?.canWriteJobs?<Button leadingIcon={<Plus size={15}/>} onClick={()=>setOpen(true)} disabled={!companies.data?.length}>Create job</Button>:undefined}>
    {/* Loading and error states render inside the Page shell, not in place of it -- the header used
      * to pop in only once data resolved, which reads as a layout shift on every visit. */}
    {loading?<Panel><TableSkeleton rows={8} columns={6} label="Opening job health…"/></Panel>:pageError?<ErrorState error={pageError}/>:<>
    <Panel><SavedViewBar resource="jobs" paramKeys={['q','health','status']} params={params} onApply={(next)=>setParams(next,{replace:true})} onExport={()=>exportView.mutate()} exporting={exportView.isPending}/><div className="toolbar"><div className="search-box"><Search size={15}/><Input aria-label="Search jobs" placeholder="Job, client, location, or owner" value={search} onChange={(event)=>setParam('q',event.target.value)}/></div>
      {/* Two filters, not one merged set: status is which jobs exist for this question, health is what
        * is wrong with them. Defaulting to Active keeps the list about live work, but Filled and
        * Closed are now one click away instead of URL-only. */}
      <div className="segmented-control" role="group" aria-label="Job status filter">{statusFilters.map(([key,label])=><button key={key} className={statusFilter===key?'active':''} onClick={()=>setParam('status',key==='active'?'':key)}>{label}</button>)}</div>
      <div className="segmented-control job-health-filters" role="group" aria-label="Job health filter">{filters.map(([key,label])=><button key={key} className={filter===key?'active':''} onClick={()=>setParam('health',key==='all'?'':key)}>{label}</button>)}</div></div>
      {visible.length===0?<EmptyState title="No matching jobs" description={companies.data?.length?'Create a job or change the filters.':'Add a client before creating the first job.'}/>:<Table className="jobs-table" caption={`${statusFilters.find(([key])=>key===statusFilter)?.[1]||'Active'} job health`} headers={['Job','Client and owner','Pipeline','Candidates','Salary and fee','Next action']}>{visible.map((job)=><tr key={job.id}><td><Link className="record-link" to={`/app/${organization?.slug}/jobs/${job.id}`}><strong>{job.title}</strong></Link><span>{job.days_open} days open · {job.location||'Location not set'}</span><StatusBadge map={jobStatus} value={job.status}/></td><td><strong>{job.company_name}</strong>{capabilities.data?.canWriteJobs?<Select aria-label={`Owner for ${job.title}`} value={job.owner_member_id||''} onChange={(event)=>assign.mutate({id:job.id,ownerId:event.target.value})}><option value="">Unassigned</option>{team.data?.filter((member)=>member.status==='active').map((member)=><option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select>:<span>{job.owner_name||'Unassigned'}</span>}</td><td><div className="pipeline-mini" aria-label={`${job.candidate_count} candidates by phase`}>{phaseSegments(job).map((segment)=><span key={segment.key} className={`phase-${segment.key}`} style={{flexGrow:segment.count}} title={`${segment.key.replace('_',' ')}: ${segment.count}`}/>)}</div><small>{phaseSegments(job).map((segment)=>`${segment.count} ${segment.key.replace('_',' ')}`).join(' · ')||'Empty pipeline'}</small></td><td><strong>{job.candidate_count}</strong><span>{job.candidate_count===1?'candidate':'candidates'}</span></td><td><span>{formatSalary(job.salary_min,job.currency)}{job.salary_max?` – ${formatSalary(job.salary_max,job.currency)}`:''}</span><strong>{formatMoney(job.expected_fee,job.currency)}</strong><small>{job.fee_source||'Fee not set'}</small></td><td><Link className="button button-secondary button-sm" to={nextActionHref(`/app/${organization?.slug}/jobs/${job.id}`,job)}>{nextActionDetail(job)?.label||'Review job'}</Link></td></tr>)}</Table>}
    </Panel>
    <Drawer title="Create job" description="One job record represents one hire. Create a separate job for each seat; the default pipeline is added automatically." open={open} onClose={()=>setOpen(false)}>
<div className="stack"><Field label="Client"><Select value={companyId} onChange={(event)=>setCompanyId(event.target.value)}><option value="">Select client</option>{companies.data?.map((company)=><option value={company.id} key={company.id}>{company.name}</option>)}</Select></Field><Field label="Job title"><Input autoFocus value={title} onChange={(event)=>setTitle(event.target.value)}/></Field><div className="form-grid"><Field label="Owner"><Select value={owner} onChange={(event)=>setOwner(event.target.value)}><option value="">Unassigned</option>{team.data?.filter((member)=>member.status==='active').map((member)=><option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><LocationField value={location} onChange={setLocation}/><Field label="Priority"><Select value={priority} onChange={(event)=>setPriority(event.target.value)}>{Object.entries(jobPriority).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</Select></Field><Field label="Employment type"><OptionSelect label="Employment type" placeholder="Not specified" options={employmentType.options(employment)} value={employmentType.key(employment)} onChange={setEmployment}/></Field></div><Field label="Description"><Textarea value={description} onChange={(event)=>setDescription(event.target.value)}/></Field><div className="form-grid"><Field label={`Salary minimum (per ${organization?.salary_period==='monthly'?'month':'year'})`}><Input type="number" min="0" value={salaryMin} onChange={(event)=>setSalaryMin(event.target.value)}/></Field><Field label={`Salary maximum (per ${organization?.salary_period==='monthly'?'month':'year'})`}><Input type="number" min="0" value={salaryMax} onChange={(event)=>setSalaryMax(event.target.value)}/></Field><Field label="Currency"><Select value={currency} onChange={(event)=>setCurrency(event.target.value)}>{currencyOptions(organization?.base_currency).map((option)=><option key={option.code} value={option.code}>{option.code} — {option.name}</option>)}</Select></Field></div>{mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button loading={mutation.isPending} disabled={!companyId||title.trim().length<2} onClick={()=>mutation.mutate()}>Create job</Button></div></div></Drawer>
    </>}
  </Page>
}
