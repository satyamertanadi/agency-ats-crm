import {useCallback,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Pencil,Plus,Search} from 'lucide-react'
import {Link,useNavigate,useSearchParams} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {createJob,listCompanies,listJobHealth} from '../core/repository'
import {listTeamMembers,updateJob} from '../core/commercialRepository'
import {formatMoney,formatSalaryRangeCompact} from '../../shared/lib/format'
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
import {Menu,type MenuItemSpec} from '../../shared/ui/Menu'
import type {JobHealth,TeamMember} from '../../shared/types/domain'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {ViewMenu} from '../core/ViewMenu'
import {csvFilename,downloadCsv,toCsv} from '../../shared/lib/csv'
import {useToast} from '../../shared/ui/Toast'
import {Table} from '../../shared/ui/Table'
import {filterJobHealth,filterJobStatus,nextActionDetail,nextActionHref,phaseSegments,type JobHealthFilter,type JobStatusFilter} from './jobHealth'
import {NOT_RECORDED} from '../../shared/lib/labels'

/* Both were rows of buttons in a `.segmented-control`. Status has four options and just about fitted;
 * health has eight, and at 1366px the eight-button strip overflowed into a horizontally scrolling
 * control -- so two of the filters were literally off the edge of the rail unless you thought to drag
 * it sideways. As selects they are two fixed-width controls that cannot overflow at any width, they
 * state the current choice in their own closed state rather than relying on which button is tinted,
 * and single-choice-from-a-list is what a select already means. */
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
    <Panel>
      <div className="toolbar">
        <ViewMenu resource="jobs" baseLabel="Active jobs" paramKeys={['q','health','status']} params={params}
          onApply={(next)=>setParams(next,{replace:true})} onExport={()=>exportView.mutate()} exporting={exportView.isPending}/>
        <div className="search-box"><Search size={15}/><Input aria-label="Search jobs" placeholder="Job, client, location, or owner" value={search} onChange={(event)=>setParam('q',event.target.value)}/></div>
        {/* Two filters, not one merged set: status is which jobs exist for this question, health is
          * what is wrong with them. Defaulting to Active keeps the list about live work, but Filled
          * and Closed are one click away rather than URL-only. */}
        <Select aria-label="Job status" value={statusFilter} onChange={(event)=>setParam('status',event.target.value==='active'?'':event.target.value)}>{statusFilters.map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select>
        <Select aria-label="Job health" value={filter} onChange={(event)=>setParam('health',event.target.value==='all'?'':event.target.value)}>{filters.map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select>
        <span className="toolbar-count">{visible.length} {visible.length===1?'job':'jobs'}</span>
      </div>
      {visible.length===0?<EmptyState title="No matching jobs" description={companies.data?.length?'Create a job or change the filters.':'Add a client before creating the first job.'}/>:<Table
        className="jobs-table"
        caption={`${statusFilters.find(([key])=>key===statusFilter)?.[1]||'Active'} job health`}
        /* Five columns, allocated rather than inferred. The previous six -- Job, Client and owner,
         * Pipeline, Candidates, Salary and fee, Next action -- split facts that answer one question
         * across two cells and gave a whole column to a single integer.
         *
         *   Job / client        the job, its status, and whose account it is: one identity.
         *   Owner               a name, with an edit affordance on hover/focus (see JobOwnerCell).
         *   Pipeline health     the phase bar and the candidate count that describes it, together.
         *                       They were adjacent columns saying the same thing at two resolutions.
         *   Age / next action   how long it has been open, and the one thing to do about that.
         *   Expected fee        right-aligned and tabular, with the salary band beneath it as
         *                       supporting detail rather than as its equal.
         */
        headers={[
          {label:'Job / client'},
          {label:'Owner',width:'140px'},
          {label:'Pipeline health',width:'210px'},
          {label:'Age / next action',width:'190px'},
          {label:'Expected fee',width:'160px',align:'right'},
        ]}>{visible.map((job)=>{
          const segments=phaseSegments(job)
          const salary=formatSalaryRangeCompact(job.salary_min,job.salary_max,job.currency,organization?.salary_period)
          const action=nextActionDetail(job)
          return <tr key={job.id}>
            <td>
              <Link className="record-link" to={`/app/${organization?.slug}/jobs/${job.id}`}><strong>{job.title}</strong></Link>
              <span title={`${job.company_name}${job.location?` · ${job.location}`:''}`}>{job.company_name}{job.location?` · ${job.location}`:''}</span>
              {/* Status under the name, and only when it is not the ordinary case -- an "Open" badge
                * on every row of a list filtered to Active jobs is a chip that carries no news. */}
              {job.status!=='open'&&<StatusBadge map={jobStatus} value={job.status}/>}
            </td>
            <td><JobOwnerCell job={job} team={team.data||[]} canEdit={Boolean(capabilities.data?.canWriteJobs)}
              onAssign={(ownerId)=>assign.mutate({id:job.id,ownerId})}/></td>
            <td>
              <div className="pipeline-mini" aria-hidden="true">{segments.map((segment)=>
                <span key={segment.key} className={`phase-${segment.key}`} style={{flexGrow:segment.count}} title={`${segment.key.replaceAll('_',' ')}: ${segment.count}`}/>)}</div>
              {/* The count and the bar describe the same pipeline, so they are one cell. The bar is
                * aria-hidden and this line is its text equivalent -- a screen reader gets the numbers,
                * not a row of unlabelled spans. */}
              <span>{job.candidate_count===0?'Empty pipeline':`${job.candidate_count} ${job.candidate_count===1?'candidate':'candidates'} · ${segments.map((segment)=>`${segment.count} ${segment.key.replaceAll('_',' ')}`).join(', ')}`}</span>
            </td>
            <td>
              <Link className="record-link" to={nextActionHref(`/app/${organization?.slug}/jobs/${job.id}`,job)}><strong>{action?.label||'Review job'}</strong></Link>
              <span>{job.days_open} {job.days_open===1?'day':'days'} open</span>
            </td>
            <td className="money">
              <strong>{formatMoney(job.expected_fee,job.currency)}</strong>
              <span title={salary?.full||undefined}>{salary?.short||job.fee_source||NOT_RECORDED}</span>
            </td>
          </tr>
        })}</Table>}
    </Panel>
    <Drawer title="Create job" description="One job record represents one hire. Create a separate job for each seat; the default pipeline is added automatically." open={open} onClose={()=>setOpen(false)}>
<div className="stack"><Field label="Client"><Select value={companyId} onChange={(event)=>setCompanyId(event.target.value)}><option value="">Select client</option>{companies.data?.map((company)=><option value={company.id} key={company.id}>{company.name}</option>)}</Select></Field><Field label="Job title"><Input autoFocus value={title} onChange={(event)=>setTitle(event.target.value)}/></Field><div className="form-grid"><Field label="Owner"><Select value={owner} onChange={(event)=>setOwner(event.target.value)}><option value="">Unassigned</option>{team.data?.filter((member)=>member.status==='active').map((member)=><option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><LocationField value={location} onChange={setLocation}/><Field label="Priority"><Select value={priority} onChange={(event)=>setPriority(event.target.value)}>{Object.entries(jobPriority).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</Select></Field><Field label="Employment type"><OptionSelect label="Employment type" placeholder="Not specified" options={employmentType.options(employment)} value={employmentType.key(employment)} onChange={setEmployment}/></Field></div><Field label="Description"><Textarea value={description} onChange={(event)=>setDescription(event.target.value)}/></Field><div className="form-grid"><Field label={`Salary minimum (per ${organization?.salary_period==='monthly'?'month':'year'})`}><Input type="number" min="0" value={salaryMin} onChange={(event)=>setSalaryMin(event.target.value)}/></Field><Field label={`Salary maximum (per ${organization?.salary_period==='monthly'?'month':'year'})`}><Input type="number" min="0" value={salaryMax} onChange={(event)=>setSalaryMax(event.target.value)}/></Field><Field label="Currency"><Select value={currency} onChange={(event)=>setCurrency(event.target.value)}>{currencyOptions(organization?.base_currency).map((option)=><option key={option.code} value={option.code}>{option.code} — {option.name}</option>)}</Select></Field></div>{mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button loading={mutation.isPending} disabled={!companyId||title.trim().length<2} onClick={()=>mutation.mutate()}>Create job</Button></div></div></Drawer>
    </>}
  </Page>
}

/* The owner, as a name -- with the picker one click away rather than permanently on screen.
 *
 * Every row used to render a full <select> listing every active team member. Fifty rows meant fifty
 * dropdowns, so the column that answers "whose job is this" was drawn as fifty identical controls and
 * the answer itself was the smallest thing in it. It also meant fifty subscriptions to the same team
 * list rendered as fifty x N <option> elements.
 *
 * The affordance appears on hover and on focus-within, and the trigger is a real button at all times
 * (opacity, not display), so keyboard and screen-reader users reach it exactly as before -- what
 * changed is that a pointer user sees it only on the row they are pointing at. Read-only members get
 * the name with no affordance at all, which is the same permission gate the <select> had. */
function JobOwnerCell({job,team,canEdit,onAssign}:{
  job:JobHealth
  team:TeamMember[]
  canEdit:boolean
  onAssign:(ownerId:string)=>void
}){
  const name=job.owner_name||'Unassigned'
  if(!canEdit)return <span className={job.owner_name?undefined:'cell-gap'}>{name}</span>
  const items:MenuItemSpec[]=[
    {id:'__unassigned',label:'Unassigned',disabled:!job.owner_member_id,onSelect:()=>onAssign('')},
    ...team.filter((member)=>member.status==='active').map((member,index)=>{
      const label=member.profiles?.full_name||member.profiles?.email||'Team member'
      return {id:member.id,label,text:label,separatorBefore:index===0,
        disabled:member.id===job.owner_member_id,onSelect:()=>onAssign(member.id)}
    }),
  ]
  return <span className="owner-cell">
    <span className={job.owner_name?'owner-cell-name':'owner-cell-name cell-gap'}>{name}</span>
    <Menu align="start" label={`Change the owner of ${job.title}`} items={items} trigger={(props)=>
      <button {...props} type="button" className="icon-button icon-button-sm row-menu-trigger" aria-label={`Change the owner of ${job.title}`}>
        <Pencil size={13}/>
      </button>}/>
  </span>
}
