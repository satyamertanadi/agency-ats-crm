import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ArrowRight,Plus,Search} from 'lucide-react'
import {Link,useNavigate} from 'react-router-dom'
import {useOrganization} from '../../app/OrganizationProvider'
import {useAuth} from '../../app/AuthProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {createJob,listCompanies,listJobs} from '../core/repository'
import {listTeamMembers,updateJob} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select} from '../../shared/ui/Field'
import {Drawer} from '../../shared/ui/Drawer'
import {Page,Panel,StatusBadge} from '../../shared/ui/Page'
import {jobPriority,jobStatus} from '../../shared/lib/status'
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/States'
import {formatDate} from '../../shared/lib/format'
import {useOpenOnNewParam} from '../../shared/lib/useOpenOnNewParam'
import {Table} from '../../shared/ui/Table'

export function JobsPage(){
  const {organization,memberships}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const navigate=useNavigate();const [open,setOpen]=useState(false);const [search,setSearch]=useState('');const [statusFilter,setStatusFilter]=useState('active')
  const currentMember=memberships.find((item)=>item.organization_id===organization?.id&&item.user_id===user?.id)
  const [companyId,setCompanyId]=useState('');const [title,setTitle]=useState('');const [owner,setOwner]=useState(currentMember?.id||'');const [location,setLocation]=useState('');const [priority,setPriority]=useState('normal')
  useOpenOnNewParam(setOpen)
  const jobs=useQuery({queryKey:['jobs',organization?.id],enabled:Boolean(organization),queryFn:()=>listJobs(organization!.id)});const companies=useQuery({queryKey:['companies',organization?.id],enabled:Boolean(organization),queryFn:()=>listCompanies(organization!.id)});const team=useQuery({queryKey:['members',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  const mutation=useMutation({mutationFn:async()=>{const id=await createJob(organization!.id,{company_id:companyId,title,owner_member_id:owner||undefined});await updateJob(organization!.id,id,{location:location||null,priority});return id},onSuccess:async(id)=>{setOpen(false);setTitle('');setLocation('');await cache.invalidateQueries({queryKey:['jobs',organization?.id]});navigate(`/app/${organization!.slug}/jobs/${id}`)}})
  if(jobs.isLoading||companies.isLoading||team.isLoading||capabilities.isLoading)return <LoadingState label="Opening jobs…"/>
  if(jobs.error||companies.error||team.error)return <ErrorState error={jobs.error||companies.error||team.error}/>
  const needle=search.trim().toLowerCase();const visible=(jobs.data||[]).filter((job)=>statusFilter==='all'||(statusFilter==='active'?['draft','open','on_hold'].includes(job.status):['filled','closed','cancelled'].includes(job.status))).filter((job)=>!needle||[job.title,job.companies?.name,job.location].some((value)=>value?.toLowerCase().includes(needle))).sort((a,b)=>(a.status==='open'?0:1)-(b.status==='open'?0:1)||b.updated_at.localeCompare(a.updated_at))
  return <Page title="Jobs" eyebrow="Recruitment delivery" description="Open a job to manage its pipeline, client review, interviews, offers, and placement." actions={capabilities.data?.canWriteJobs?<Button leadingIcon={<Plus size={15}/>} onClick={()=>setOpen(true)} disabled={!companies.data?.length}>Create job</Button>:undefined}>
    <Panel><div className="toolbar"><div className="search-box"><Search size={15}/><Input aria-label="Search jobs" placeholder="Job or client" value={search} onChange={(event)=>setSearch(event.target.value)}/></div><Select aria-label="Job status" value={statusFilter} onChange={(event)=>setStatusFilter(event.target.value)}><option value="active">Active jobs</option><option value="closed">Closed jobs</option><option value="all">All jobs</option></Select></div>{visible.length===0?<EmptyState title="No matching jobs" description={companies.data?.length?'Create a job or change the filters.':'Add a client before creating the first job.'} action={companies.data?.length&&capabilities.data?.canWriteJobs?<Button onClick={()=>setOpen(true)}>Create job</Button>:undefined}/>:<Table caption="Client jobs" headers={['Job','Client','Location','Priority','Status','Workspace']}>{visible.map((job)=><tr key={job.id}><td><Link className="record-link" to={`/app/${organization?.slug}/jobs/${job.id}`}><strong>{job.title}</strong></Link><span>Opened {formatDate(job.opened_at)}</span></td><td>{job.companies?.name||'—'}</td><td>{job.location||'—'}</td><td><StatusBadge map={jobPriority} value={job.priority}/></td><td><StatusBadge map={jobStatus} value={job.status}/></td><td><Link className="button button-secondary" to={`/app/${organization?.slug}/jobs/${job.id}`}>Open job <ArrowRight size={14}/></Link></td></tr>)}</Table>}</Panel>
    <Drawer title="Create job" description="Start with the client and role. The default pipeline is added automatically." open={open} onClose={()=>setOpen(false)}><div className="stack"><Field label="Client"><Select value={companyId} onChange={(event)=>setCompanyId(event.target.value)}><option value="">Select client</option>{companies.data?.map((company)=><option value={company.id} key={company.id}>{company.name}</option>)}</Select></Field><Field label="Job title"><Input autoFocus value={title} onChange={(event)=>setTitle(event.target.value)}/></Field><div className="form-grid"><Field label="Owner"><Select value={owner} onChange={(event)=>setOwner(event.target.value)}><option value="">Unassigned</option>{team.data?.filter((member)=>member.status==='active').map((member)=><option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><Field label="Location"><Input value={location} onChange={(event)=>setLocation(event.target.value)}/></Field><Field label="Priority"><Select value={priority} onChange={(event)=>setPriority(event.target.value)}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></Select></Field></div>{mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button loading={mutation.isPending} disabled={!companyId||title.trim().length<2} onClick={()=>mutation.mutate()}>Create job</Button></div></div></Drawer>
  </Page>
}
