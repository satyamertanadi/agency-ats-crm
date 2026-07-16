import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ArrowRight,BriefcaseBusiness,CalendarClock,CheckCircle2,Plus,TriangleAlert} from 'lucide-react'
import {Link,useSearchParams} from 'react-router-dom'
import {useOrganization} from '../../app/OrganizationProvider'
import {useAuth} from '../../app/AuthProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {createTask,dashboardSummary,listEmailDeliveryIssues,listInterviews,listJobs,listOffers,listSubmissionPackages,listTasks} from '../core/repository'
import {ErrorState,LoadingState} from '../../shared/ui/States'
import {Badge,Page,Panel} from '../../shared/ui/Page'
import {Button} from '../../shared/ui/Button'
import {Modal} from '../../shared/ui/Modal'
import {Field,Input,Select} from '../../shared/ui/Field'
import {formatDateTime} from '../../shared/lib/format'
import {buildTodayWorkItems,type TodayWorkKind} from '../workflow/workflow'
import {SetupChecklist,buildSetupSteps} from './SetupChecklist'

const kindMeta:Record<TodayWorkKind,{label:string;tone:'bad'|'warn'|'info'|'neutral'}>={
  blocked:{label:'Needs attention',tone:'bad'},overdue:{label:'Overdue',tone:'bad'},today:{label:'Today',tone:'warn'},upcoming:{label:'Upcoming',tone:'info'},recommended:{label:'Next step',tone:'neutral'},
}

export function TodayPage(){
  const {organization,memberships}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const [params,setParams]=useSearchParams();const [scope,setScope]=useState<'mine'|'team'>('mine')
  const [taskTitle,setTaskTitle]=useState('');const [taskDue,setTaskDue]=useState('');const [taskJobId,setTaskJobId]=useState('')
  const currentMember=memberships.find((item)=>item.organization_id===organization?.id&&item.user_id===user?.id)
  const query=useQuery({queryKey:['today',organization?.id],enabled:Boolean(organization),queryFn:async()=>{
    const [tasks,interviews,offers,jobs,summary,deliveryIssues,submissions]=await Promise.all([listTasks(organization!.id),listInterviews(organization!.id),listOffers(organization!.id),listJobs(organization!.id),dashboardSummary(organization!.id),listEmailDeliveryIssues(organization!.id),listSubmissionPackages(organization!.id)])
    return {tasks,interviews,offers,jobs,summary,deliveryIssues,submissions}
  }})
  const taskOpen=params.get('action')==='task'&&!capabilities.data?.readOnly
  const closeTask=()=>{const next=new URLSearchParams(params);next.delete('action');setParams(next,{replace:true})}
  const createFollowUp=useMutation({mutationFn:()=>createTask(organization!.id,user!.id,{title:taskTitle.trim(),priority:'normal',due_at:taskDue?new Date(taskDue).toISOString():undefined,owner_member_id:currentMember?.id,link:taskJobId?{type:'job',id:taskJobId}:undefined}),onSuccess:async()=>{setTaskTitle('');setTaskDue('');setTaskJobId('');closeTask();await cache.invalidateQueries({queryKey:['today',organization?.id]})}})
  if(query.isLoading||capabilities.isLoading)return <LoadingState label="Preparing your work for today…"/>
  if(query.error||!query.data)return <ErrorState error={query.error} retry={()=>void query.refetch()}/>
  const base=`/app/${organization!.slug}`;const name=(user?.user_metadata.full_name as string|undefined)?.split(' ')[0]
  const items=buildTodayWorkItems({base,now:new Date(),currentMemberId:scope==='mine'?currentMember?.id:undefined,tasks:query.data.tasks,interviews:query.data.interviews,offers:query.data.offers,jobs:query.data.jobs,deliveryIssues:query.data.deliveryIssues,submissions:query.data.submissions})
  const steps=buildSetupSteps(query.data.summary,base);const setupComplete=steps.length>0&&steps.every((step)=>step.done)
  const urgent=items.filter((item)=>item.kind==='blocked'||item.kind==='overdue').length
  const activeJobs=query.data.jobs.filter((job)=>job.status==='open'&&(scope==='team'||!job.owner_member_id||job.owner_member_id===currentMember?.id))
  return <Page title={name?`Today, ${name}`:'Today'} eyebrow={organization?.name} description="Your next recruitment actions, in the order they need attention." className="today-page" actions={<div className="page-scope-actions">{capabilities.data?.canViewTeamReports&&<div className="segmented-control" aria-label="Work scope"><button className={scope==='mine'?'active':''} onClick={()=>setScope('mine')}>My work</button><button className={scope==='team'?'active':''} onClick={()=>setScope('team')}>Team view</button></div>}{capabilities.data?.canWriteCandidates&&<Link className="button button-primary button-md" to={`${base}/candidates?new=1`}><Plus size={15}/>Add candidate</Link>}</div>}>
    {!setupComplete&&<SetupChecklist steps={steps}/>}
    {setupComplete&&<section className={`today-brief ${urgent?'today-brief-alert':''}`}><span>{urgent?<TriangleAlert size={21}/>:<CheckCircle2 size={21}/>}</span><div><p className="eyebrow">Operating brief</p><h2>{urgent?`${urgent} action${urgent===1?'':'s'} need attention`:'You are clear for today'}</h2><p>{items.length?`${items.length} total items · ${activeJobs.length} active jobs in this view`:'No overdue or upcoming work is waiting.'}</p></div></section>}
    <div className="today-layout">
      <Panel title="Next actions" subtitle="One click opens the right record with its context preserved." elevation="raised">
        {items.length===0?<div className="today-clear"><CheckCircle2 size={24}/><div><strong>Nothing needs attention</strong><p>Open a job to continue sourcing or add a follow-up when new work arrives.</p></div></div>:<ol className="work-queue">{items.map((item)=>{const meta=kindMeta[item.kind];return <li key={item.id}><div className="work-queue-main"><Badge tone={meta.tone}>{meta.label}</Badge><div><strong>{item.title}</strong><p>{item.reason}</p>{item.dueAt&&<time dateTime={item.dueAt}>{formatDateTime(item.dueAt)}</time>}</div></div><Link className="button button-secondary button-sm" to={item.href}>{item.cta}<ArrowRight size={13}/></Link></li>})}</ol>}
      </Panel>
      <Panel title={scope==='mine'?'My active jobs':'Active jobs'} subtitle="Jobs most likely to need your attention next.">
        <div className="today-job-list">{activeJobs.slice(0,6).map((job)=><Link to={`${base}/jobs/${job.id}`} key={job.id}><span><BriefcaseBusiness size={16}/><span><strong>{job.title}</strong><small>{job.companies?.name||'Client'} · {job.location||'Location not set'}</small></span></span><ArrowRight size={14}/></Link>)}{activeJobs.length===0&&<p className="muted">No active jobs in this view.</p>}</div>
        <div className="panel-footer-action"><Link className="record-link" to={`${base}/jobs`}>View all jobs <ArrowRight size={13}/></Link></div>
      </Panel>
    </div>
    {!capabilities.data?.readOnly&&<section className="today-shortcuts" aria-label="Common actions">{capabilities.data?.canWriteJobs&&<Link to={`${base}/jobs?new=1`}><BriefcaseBusiness size={18}/><span><strong>Create job</strong><small>Start a client search</small></span></Link>}<Link to={`${base}/today?action=task`}><CalendarClock size={18}/><span><strong>Add follow-up</strong><small>Capture the next action</small></span></Link></section>}
    <Modal title="Add follow-up" open={taskOpen} onClose={closeTask}><form className="stack" onSubmit={(event)=>{event.preventDefault();createFollowUp.mutate()}}><Field label="What needs to happen?"><Input autoFocus value={taskTitle} onChange={(event)=>setTaskTitle(event.target.value)} required/></Field><div className="form-grid"><Field label="Due"><Input type="datetime-local" value={taskDue} onChange={(event)=>setTaskDue(event.target.value)}/></Field><Field label="Job"><Select value={taskJobId} onChange={(event)=>setTaskJobId(event.target.value)}><option value="">No linked job</option>{query.data.jobs.filter((job)=>job.status==='open').map((job)=><option key={job.id} value={job.id}>{job.title} · {job.companies?.name||'Client'}</option>)}</Select></Field></div><p className="muted">This follow-up is assigned to you. Ownership and priority can be changed later if needed.</p>{createFollowUp.error&&<p className="form-error" role="alert">{createFollowUp.error.message}</p>}<div className="form-actions"><Button type="button" variant="quiet" onClick={closeTask}>Cancel</Button><Button loading={createFollowUp.isPending} disabled={!taskTitle.trim()}>Create follow-up</Button></div></form></Modal>
  </Page>
}
