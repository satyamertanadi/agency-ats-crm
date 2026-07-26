import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ArrowRight,BriefcaseBusiness,CalendarClock,CheckCircle2,ChevronDown,ListChecks,OctagonAlert,Plus,TriangleAlert} from 'lucide-react'
import {Link,useSearchParams} from 'react-router-dom'
import {useOrganization} from '../../app/OrganizationProvider'
import {useAuth} from '../../app/AuthProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {createTask,dashboardSummary,listEmailDeliveryIssues,listInterviews,listJobHealth,listJobs,listOffers,listPlacements,listSubmissionPackages,listTasks} from '../core/repository'
import {ErrorState,TableSkeleton} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'
import {Page,Panel} from '../../shared/ui/Page'
import {Button} from '../../shared/ui/Button'
import {Modal} from '../../shared/ui/Modal'
import {Field,Input,Select} from '../../shared/ui/Field'
import {formatTime} from '../../shared/lib/format'
import {lookup,todayWorkKind} from '../../shared/lib/status'
import {buildTodayWorkItems, type TodayWorkItem} from '../workflow/workflow'
import {phaseSegments} from '../jobs/jobHealth'
import {SetupChecklist,buildSetupSteps} from './SetupChecklist'

const latenessLabel=(dueAt:string,now:Date)=>{const days=Math.max(1,Math.ceil((now.getTime()-new Date(dueAt).getTime())/86_400_000));return `${days} day${days===1?'':'s'} late`}

/* Badge weight, not just colour, is what separates "Do now" from "Today" -- solid fill for the red
 * band, an outline/tint for the amber one, nothing at all in "Later". Overdue items read their exact
 * lateness instead of the generic word "Overdue", per the redesign brief. */
function WorkQueueBadge({item,now}:{item:TodayWorkItem;now:Date}){
  if(item.kind==='blocked')return <span className="work-queue-badge work-queue-badge-solid"><OctagonAlert size={11}/>{lookup(todayWorkKind,item.kind).label}</span>
  if(item.kind==='overdue')return <span className="work-queue-badge work-queue-badge-solid">{item.dueAt?latenessLabel(item.dueAt,now):lookup(todayWorkKind,item.kind).label}</span>
  if(item.kind==='today')return <span className="work-queue-badge work-queue-badge-outline">{item.dueAt?formatTime(item.dueAt):lookup(todayWorkKind,item.kind).label}</span>
  return null
}

function WorkQueueRow({item,now}:{item:TodayWorkItem;now:Date}){
  if(item.group)return <li key={item.id} className={`work-queue-row work-queue-group kind-${item.kind}`}><details><summary><div className="work-queue-main"><WorkQueueBadge item={item} now={now}/><div><strong>{item.title}</strong><p>{item.reason}</p></div></div><span className="work-queue-group-toggle">{item.group.length} {item.groupNoun||'items'}<ChevronDown size={14}/></span></summary><ul className="work-queue-group-list">{item.group.map((sub)=><li key={sub.href}><span>{sub.label}</span><Link className="button button-secondary button-sm" to={sub.href}>{sub.cta}<ArrowRight size={13}/></Link></li>)}</ul></details></li>
  if(item.kind==='upcoming'||item.kind==='recommended')return <li key={item.id} className="work-queue-later-row"><span className="work-queue-dot" aria-hidden="true"/><span className="work-queue-later-main"><strong>{item.title}</strong><span>{item.reason}</span></span><Link className="icon-button" to={item.href} aria-label={item.cta}><ArrowRight size={14}/></Link></li>
  return <li key={item.id} className={`work-queue-row kind-${item.kind}`}><div className="work-queue-main"><WorkQueueBadge item={item} now={now}/><div><strong>{item.title}</strong><p>{item.reason}</p></div></div><Link className="button button-secondary button-sm" to={item.href}>{item.cta}<ArrowRight size={13}/></Link></li>
}

export function TodayPage(){
  const {organization,memberships}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast();const [params,setParams]=useSearchParams();const [scope,setScope]=useState<'mine'|'team'>('mine')
  const [taskTitle,setTaskTitle]=useState('');const [taskDue,setTaskDue]=useState('');const [taskJobId,setTaskJobId]=useState('')
  const currentMember=memberships.find((item)=>item.organization_id===organization?.id&&item.user_id===user?.id)
  const query=useQuery({queryKey:['today',organization?.id],enabled:Boolean(organization),queryFn:async()=>{
    const [tasks,interviews,offers,placements,jobs,summary,deliveryIssues,submissions,jobHealth]=await Promise.all([listTasks(organization!.id),listInterviews(organization!.id),listOffers(organization!.id),listPlacements(organization!.id),listJobs(organization!.id),dashboardSummary(organization!.id),listEmailDeliveryIssues(organization!.id),listSubmissionPackages(organization!.id),listJobHealth(organization!.id)])
    return {tasks,interviews,offers,placements,jobs,summary,deliveryIssues,submissions,jobHealth}
  }})
  const taskOpen=params.get('action')==='task'&&!capabilities.data?.readOnly
  const closeTask=()=>{const next=new URLSearchParams(params);next.delete('action');setParams(next,{replace:true})}
  const createFollowUp=useMutation({mutationFn:()=>createTask(organization!.id,user!.id,{title:taskTitle.trim(),priority:'normal',due_at:taskDue?new Date(taskDue).toISOString():undefined,owner_member_id:currentMember?.id,link:taskJobId?{type:'job',id:taskJobId}:undefined}),onSuccess:async()=>{const created=taskTitle.trim();setTaskTitle('');setTaskDue('');setTaskJobId('');closeTask();await cache.invalidateQueries({queryKey:['today',organization?.id]});toast.success(`Task added: ${created}`)},onError:(error)=>toast.error(error,'The follow-up was not created.')})
  const name=(user?.user_metadata.full_name as string|undefined)?.split(' ')[0]
  if(query.isLoading||capabilities.isLoading)return <Page title={name?`Today, ${name}`:'Today'} eyebrow={organization?.name} description="Your next recruitment actions, in the order they need attention." className="today-page"><Panel><TableSkeleton rows={6} columns={2} label="Preparing your work for today…"/></Panel></Page>
  if(query.error||!query.data)return <ErrorState error={query.error} retry={()=>void query.refetch()}/>
  const base=`/app/${organization!.slug}`
  const now=new Date()
  const items=buildTodayWorkItems({base,now,currentMemberId:scope==='mine'?currentMember?.id:undefined,tasks:query.data.tasks,interviews:query.data.interviews,offers:query.data.offers,placements:query.data.placements,jobs:query.data.jobs,deliveryIssues:query.data.deliveryIssues,submissions:query.data.submissions})
  const steps=buildSetupSteps(query.data.summary,base);const setupComplete=steps.length>0&&steps.every((step)=>step.done)
  const urgent=items.filter((item)=>item.kind==='blocked'||item.kind==='overdue').length
  // Three bands, split by the same `kind` buildTodayWorkItems already assigns -- no second urgency
  // model to keep in sync with the first.
  const doNow=items.filter((item)=>item.kind==='blocked'||item.kind==='overdue')
  const todayItems=items.filter((item)=>item.kind==='today')
  const later=items.filter((item)=>item.kind==='upcoming'||item.kind==='recommended')
  const activeJobs=query.data.jobs.filter((job)=>job.status==='open'&&(scope==='team'||!job.owner_member_id||job.owner_member_id===currentMember?.id))
  const healthByJob=new Map(query.data.jobHealth.map((health)=>[health.id,health]))
  return <Page title={name?`Today, ${name}`:'Today'} eyebrow={organization?.name} description="Your next recruitment actions, in the order they need attention." className="today-page" actions={<div className="page-scope-actions">{capabilities.data?.canViewTeamReports&&<div className="segmented-control" aria-label="Work scope"><button className={scope==='mine'?'active':''} onClick={()=>setScope('mine')}>My work</button><button className={scope==='team'?'active':''} onClick={()=>setScope('team')}>Team view</button></div>}{capabilities.data?.canWriteCandidates&&<Link className="button button-primary" to={`${base}/candidates?new=1`}><Plus size={15}/>Add candidate</Link>}</div>}>
    {!setupComplete&&<SetupChecklist steps={steps}/>}
    {setupComplete&&<section className={`today-brief ${urgent?'today-brief-alert':''}`}><div className="today-brief-main"><span>{urgent?<TriangleAlert size={21}/>:<CheckCircle2 size={21}/>}</span><div><p className="eyebrow">Operating brief</p><h2>{urgent?`${urgent} action${urgent===1?'':'s'} need attention`:'You are clear for today'}</h2>{items.length===0&&<p>No overdue or upcoming work is waiting.</p>}</div></div>{items.length>0&&<div className="today-brief-stats"><div className="today-brief-stat"><strong>{items.length}</strong><span>total items</span></div><div className="today-brief-stat"><strong>{activeJobs.length}</strong><span>active jobs</span></div></div>}</section>}
    <div className="today-layout">
      <Panel title="Next actions" subtitle="One click opens the right record with its context preserved." icon={<ListChecks size={16}/>} elevation="raised">
        {items.length===0?<div className="today-clear"><CheckCircle2 size={24}/><div><strong>Nothing needs attention</strong><p>Open a job to continue sourcing or add a follow-up when new work arrives.</p></div></div>:<>
          {doNow.length>0&&<div className="work-queue-band"><p className="work-queue-band-label work-queue-band-label-bad">Do now · {doNow.length}</p><ol className="work-queue">{doNow.map((item)=><WorkQueueRow item={item} now={now} key={item.id}/>)}</ol></div>}
          {todayItems.length>0&&<div className="work-queue-band"><p className="work-queue-band-label work-queue-band-label-warn">Today · {todayItems.length}</p><ol className="work-queue">{todayItems.map((item)=><WorkQueueRow item={item} now={now} key={item.id}/>)}</ol></div>}
          {later.length>0&&<div className="work-queue-band"><p className="work-queue-band-label work-queue-band-label-faint">Later · {later.length}</p><ol className="work-queue work-queue-later">{later.map((item)=><WorkQueueRow item={item} now={now} key={item.id}/>)}</ol></div>}
        </>}
      </Panel>
      <Panel title={scope==='mine'?'My active jobs':'Active jobs'} subtitle="Pipeline health at a glance." icon={<BriefcaseBusiness size={16}/>}>
        <div className="today-job-list">{activeJobs.slice(0,6).map((job)=>{
          const health=healthByJob.get(job.id)
          // waiting_count already IS list_job_health's stalled signal (candidates untouched 7+ days
          // in an active stage) -- reused as-is rather than recomputed against the board's SLA targets.
          const chip=!health||health.candidate_count===0?{label:'Empty',tone:'bad'}:health.waiting_count>0?{label:`${health.waiting_count} stalled`,tone:health.waiting_count>=3?'bad':'warn'}:{label:'Healthy',tone:'good'}
          return <Link to={`${base}/jobs/${job.id}`} key={job.id} className="today-job-row">
            <div className="today-job-row-top"><strong>{job.title}</strong><span className={`today-job-chip tone-${chip.tone}`}>{chip.label}</span></div>
            <small>{job.companies?.name||'Client'} · {job.location||'Location not set'}{health?` · ${health.candidate_count} candidates`:''}</small>
            {health&&health.candidate_count>0&&<div className="pipeline-mini" aria-label={`${health.candidate_count} candidates by phase`}>{phaseSegments(health).map((segment)=><span key={segment.key} className={`phase-${segment.key}`} style={{flexGrow:segment.count}}/>)}</div>}
          </Link>
        })}{activeJobs.length===0&&<p className="muted">No active jobs in this view.</p>}</div>
        <div className="panel-footer-action"><Link className="record-link" to={`${base}/jobs`}>View all jobs <ArrowRight size={13}/></Link></div>
      </Panel>
    </div>
    {!capabilities.data?.readOnly&&<section className="today-shortcuts" aria-label="Common actions">{capabilities.data?.canWriteJobs&&<Link to={`${base}/jobs?new=1`}><BriefcaseBusiness size={18}/><span><strong>Create job</strong><small>Start a client search</small></span></Link>}<Link to={`${base}/today?action=task`}><CalendarClock size={18}/><span><strong>Add follow-up</strong><small>Capture the next action</small></span></Link></section>}
    <Modal title="Add follow-up" open={taskOpen} onClose={closeTask}><form className="stack" onSubmit={(event)=>{event.preventDefault();createFollowUp.mutate()}}><Field label="What needs to happen?"><Input autoFocus value={taskTitle} onChange={(event)=>setTaskTitle(event.target.value)} required/></Field><div className="form-grid"><Field label="Due"><Input type="datetime-local" value={taskDue} onChange={(event)=>setTaskDue(event.target.value)}/></Field><Field label="Job"><Select value={taskJobId} onChange={(event)=>setTaskJobId(event.target.value)}><option value="">No linked job</option>{query.data.jobs.filter((job)=>job.status==='open').map((job)=><option key={job.id} value={job.id}>{job.title} · {job.companies?.name||'Client'}</option>)}</Select></Field></div><p className="muted">This follow-up is assigned to you. Ownership and priority can be changed later if needed.</p>{createFollowUp.error&&<p className="form-error" role="alert">{createFollowUp.error.message}</p>}<div className="form-actions"><Button type="button" variant="quiet" onClick={closeTask}>Cancel</Button><Button loading={createFollowUp.isPending} disabled={!taskTitle.trim()}>Create follow-up</Button></div></form></Modal>
  </Page>
}
