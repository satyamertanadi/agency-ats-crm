import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ArrowRight,BriefcaseBusiness,CalendarClock,CheckCircle2,ChevronDown,ListChecks,OctagonAlert,Plus,TriangleAlert} from 'lucide-react'
import {Link} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {useAuth} from '../../app/AuthProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {completeTask,dashboardSummary,listEmailDeliveryIssues,listExpiringConsent,listInterviews,listJobHealth,listJobs,listOffers,listPlacedJobCandidates,listRecentSubmissionFeedback,listSubmissionPackages,listTasks,snoozeTask} from '../core/repository'
import {ErrorState,TableSkeleton} from '../../shared/ui/States'
import {Page,Panel} from '../../shared/ui/Page'
import {formatTime} from '../../shared/lib/format'
import {lookup,todayWorkKind} from '../../shared/lib/status'
import {buildTodayWorkItems,type TodayConsent,type TodayFeedback,type TodayWorkItem} from '../workflow/workflow'
import {nextActionDetail,phaseSegments} from '../jobs/jobHealth'
import {SetupChecklist,buildSetupSteps} from './SetupChecklist'
import {Button} from '../../shared/ui/Button'
import {useToast} from '../../shared/ui/Toast'

/* Both windows are deliberately short. This is a work queue: a client response from three weeks ago
 * has either been actioned or turned into a different problem, and consent lapsing next quarter is not
 * a thing to do today. Two weeks is roughly the notice a consultant needs to reach a candidate, get a
 * reply and record it before a live shortlist becomes unsendable. */
const FEEDBACK_WINDOW_HOURS=72
const CONSENT_WINDOW_DAYS=14
/* Today is a work queue, not an archive. Interviews and submission packages older than this cannot
 * produce an action anyone is still going to take -- an outcome unrecorded for three months is a
 * data-quality job, not today's -- and leaving them unbounded means the queue's cost grows with the
 * whole history of the workspace, which is precisely what the Vincere import lands on it. */
const WORK_QUEUE_LOOKBACK_DAYS=90

/* The nested Supabase rows flattened for the pure builder. Kept at this edge on purpose: workflow.ts
 * is tested, and its fixtures should express "this job is owned by someone else" as one field rather
 * than a four-level object. */
const toTodayFeedback=(rows:unknown[]):TodayFeedback[]=>rows.map((entry)=>{
  const row=entry as {id:string;decision:string;created_at:string;candidate_submissions?:{job_candidate_id:string;job_candidates?:{candidates?:{full_name:string|null}|null;jobs?:{id:string;title:string;owner_member_id:string|null}|null}|null}|null}
  const assignment=row.candidate_submissions?.job_candidates
  return {id:row.id,decision:row.decision,createdAt:row.created_at,jobCandidateId:row.candidate_submissions?.job_candidate_id||'',
    jobId:assignment?.jobs?.id??null,jobTitle:assignment?.jobs?.title??null,jobOwnerMemberId:assignment?.jobs?.owner_member_id??null,
    candidateName:assignment?.candidates?.full_name??null}
})
const toTodayConsent=(rows:unknown[]):TodayConsent[]=>rows.map((entry)=>{
  const row=entry as {candidate_id:string;consent_expires_at:string;candidates?:{full_name:string;status:string;owner_member_id:string|null}|null}
  return {candidateId:row.candidate_id,fullName:row.candidates?.full_name||'Candidate',expiresAt:row.consent_expires_at,
    status:row.candidates?.status||'active',ownerMemberId:row.candidates?.owner_member_id??null}
})

/* Dismissal is per workspace and local to the browser. It records a preference about a checklist, not
 * a fact about the organization -- a second consultant joining should still get their own onboarding
 * -- so it does not warrant a column, a migration, or an RLS policy. */
const setupKey=(organizationId?:string)=>`setup-dismissed:${organizationId||'unknown'}`
const readSetupDismissed=(organizationId?:string)=>{try{return localStorage.getItem(setupKey(organizationId))==='1'}catch{return false}}
const writeSetupDismissed=(organizationId?:string)=>{try{localStorage.setItem(setupKey(organizationId),'1')}catch{/* private mode: the checklist simply returns next visit */}}

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

function TaskActions({taskId,working,onAction}:{taskId?:string;working:boolean;onAction:(taskId:string,action:'complete'|'snooze')=>void}){
  if(!taskId)return null
  return <><Button size="sm" variant="quiet" leadingIcon={<CheckCircle2 size={13}/>} disabled={working} onClick={()=>onAction(taskId,'complete')}>Done</Button><Button size="sm" variant="quiet" disabled={working} onClick={()=>onAction(taskId,'snooze')}>Tomorrow</Button></>
}

function WorkQueueRow({item,now,working,onTaskAction}:{item:TodayWorkItem;now:Date;working:boolean;onTaskAction:(taskId:string,action:'complete'|'snooze')=>void}){
  if(item.group)return <li key={item.id} className={`work-queue-row work-queue-group kind-${item.kind}`}><details><summary><div className="work-queue-main"><WorkQueueBadge item={item} now={now}/><div><strong>{item.title}</strong><p>{item.reason}</p></div></div><span className="work-queue-group-toggle">{item.group.length} {item.groupNoun||'items'}<ChevronDown size={14}/></span></summary><ul className="work-queue-group-list">{item.group.map((sub)=><li key={`${sub.href}-${sub.taskId||sub.label}`}><span>{sub.label}</span><div className="lifecycle-actions"><TaskActions taskId={sub.taskId} working={working} onAction={onTaskAction}/><Link className="button button-secondary button-sm" to={sub.href}>{sub.cta}<ArrowRight size={13}/></Link></div></li>)}</ul></details></li>
  if(item.kind==='upcoming'||item.kind==='recommended')return <li key={item.id} className="work-queue-later-row"><span className="work-queue-dot" aria-hidden="true"/><span className="work-queue-later-main"><strong>{item.title}</strong><span>{item.reason}</span></span><div className="lifecycle-actions"><TaskActions taskId={item.taskId} working={working} onAction={onTaskAction}/><Link className="icon-button" to={item.href} aria-label={item.cta}><ArrowRight size={14}/></Link></div></li>
  return <li key={item.id} className={`work-queue-row kind-${item.kind}`}><div className="work-queue-main"><WorkQueueBadge item={item} now={now}/><div><strong>{item.title}</strong><p>{item.reason}</p></div></div><div className="lifecycle-actions"><TaskActions taskId={item.taskId} working={working} onAction={onTaskAction}/><Link className="button button-secondary button-sm" to={item.href}>{item.cta}<ArrowRight size={13}/></Link></div></li>
}

export function TodayPage(){
  const {organization,memberships}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast();const [scope,setScope]=useState<'mine'|'team'>('mine')
  const currentMember=memberships.find((item)=>item.organization_id===organization?.id&&item.user_id===user?.id)
  const [setupHidden,setSetupHidden]=useState(()=>readSetupDismissed(organization?.id))
  const query=useQuery({queryKey:['today',organization?.id],enabled:Boolean(organization),queryFn:async()=>{
    /* The two windows the notification-lite items are built from. Both are bounded on the server: an
     * unbounded feedback list would be an archive rather than a queue, and consent that lapses in six
     * months is not today's problem. */
    const feedbackSince=new Date(Date.now()-FEEDBACK_WINDOW_HOURS*3_600_000).toISOString()
    const consentBefore=new Date(Date.now()+CONSENT_WINDOW_DAYS*86_400_000).toISOString()
    const workQueueSince=new Date(Date.now()-WORK_QUEUE_LOOKBACK_DAYS*86_400_000).toISOString()
    /* Offers are bounded by status rather than by date: the queue only ever builds items from
     * 'presented' and 'accepted', so the other statuses were fetched and discarded. Placements are
     * needed only as a set of already-placed job candidates, which is two columns rather than the
     * full rows with their revenue splits and invoices. */
    const [tasks,interviews,offers,placements,jobs,summary,deliveryIssues,submissions,jobHealth,feedback,consent]=await Promise.all([listTasks(organization!.id),listInterviews(organization!.id,{since:workQueueSince}),listOffers(organization!.id,{statuses:['presented','accepted']}),listPlacedJobCandidates(organization!.id),listJobs(organization!.id),dashboardSummary(organization!.id),listEmailDeliveryIssues(organization!.id),listSubmissionPackages(organization!.id,{since:workQueueSince}),listJobHealth(organization!.id),listRecentSubmissionFeedback(organization!.id,feedbackSince),listExpiringConsent(organization!.id,consentBefore)])
    return {tasks,interviews,offers,placements,jobs,summary,deliveryIssues,submissions,jobHealth,feedback,consent}
  }})
  const taskAction=useMutation({mutationFn:({taskId,action}:{taskId:string;action:'complete'|'snooze'})=>{if(action==='complete')return completeTask(organization!.id,taskId);const due=new Date();due.setDate(due.getDate()+1);due.setHours(9,0,0,0);return snoozeTask(organization!.id,taskId,due.toISOString())},onSuccess:async(_result,variables)=>{toast.success(variables.action==='complete'?'Follow-up completed.':'Follow-up moved to tomorrow.');await Promise.all([cache.invalidateQueries({queryKey:['today',organization?.id]}),cache.invalidateQueries({queryKey:['tasks',organization?.id]}),cache.invalidateQueries({queryKey:['agency-performance',organization?.id]})])},onError:(error)=>toast.error(error,'The follow-up was not changed.')})
  const actOnTask=(taskId:string,action:'complete'|'snooze')=>taskAction.mutate({taskId,action})
  const name=(user?.user_metadata.full_name as string|undefined)?.split(' ')[0]
  if(query.isLoading||capabilities.isLoading)return <Page title={name?`Today, ${name}`:'Today'} eyebrow={organization?.name} description="Your next recruitment actions, in the order they need attention." className="today-page"><Panel><TableSkeleton rows={6} columns={2} label="Preparing your work for today…"/></Panel></Page>
  if(query.error||!query.data)return <ErrorState error={query.error} retry={()=>void query.refetch()}/>
  const base=`/app/${organization!.slug}`
  const now=new Date()
  const items=buildTodayWorkItems({base,now,currentMemberId:scope==='mine'?currentMember?.id:undefined,tasks:query.data.tasks,interviews:query.data.interviews,offers:query.data.offers,placements:query.data.placements,jobs:query.data.jobs,deliveryIssues:query.data.deliveryIssues,submissions:query.data.submissions,feedback:toTodayFeedback(query.data.feedback),consentExpiring:toTodayConsent(query.data.consent)})
  const steps=buildSetupSteps(query.data.summary,base);const setupComplete=steps.length>0&&steps.every((step)=>step.done)
  // Complete or hidden both mean the same thing to the page below: show the brief. The checklist used
  // to render a `onDismiss` prop nobody passed, so a solo consultant who would never invite a team
  // was stuck on a permanently unfinished list with the operating brief suppressed behind it.
  const showSetup=!setupComplete&&!setupHidden
  const dismissSetup=()=>{writeSetupDismissed(organization?.id);setSetupHidden(true)}
  const urgent=items.filter((item)=>item.kind==='blocked'||item.kind==='overdue').length
  // Three bands, split by the same `kind` buildTodayWorkItems already assigns -- no second urgency
  // model to keep in sync with the first.
  const doNow=items.filter((item)=>item.kind==='blocked'||item.kind==='overdue')
  const todayItems=items.filter((item)=>item.kind==='today')
  const later=items.filter((item)=>item.kind==='upcoming'||item.kind==='recommended')
  const activeJobs=query.data.jobs.filter((job)=>job.status==='open'&&(scope==='team'||!job.owner_member_id||job.owner_member_id===currentMember?.id))
  const healthByJob=new Map(query.data.jobHealth.map((health)=>[health.id,health]))
  return <Page title={name?`Today, ${name}`:'Today'} eyebrow={organization?.name} description="Your next recruitment actions, in the order they need attention." className="today-page" actions={<div className="page-scope-actions">{capabilities.data?.canViewTeamReports&&<div className="segmented-control" aria-label="Work scope"><button className={scope==='mine'?'active':''} onClick={()=>setScope('mine')}>My work</button><button className={scope==='team'?'active':''} onClick={()=>setScope('team')}>Team view</button></div>}{capabilities.data?.canWriteCandidates&&<Link className="button button-primary" to={`${base}/candidates?new=1`}><Plus size={15}/>Add candidate</Link>}</div>}>
    {showSetup&&<SetupChecklist steps={steps} onDismiss={dismissSetup}/>}
    {!showSetup&&<section className={`today-brief ${urgent?'today-brief-alert':''}`}><div className="today-brief-main"><span>{urgent?<TriangleAlert size={21}/>:<CheckCircle2 size={21}/>}</span><div><p className="eyebrow">Operating brief</p><h2>{urgent?`${urgent} action${urgent===1?'':'s'} need attention`:'You are clear for today'}</h2>{items.length===0&&<p>No overdue or upcoming work is waiting.</p>}</div></div>{items.length>0&&<div className="today-brief-stats"><div className="today-brief-stat"><strong>{items.length}</strong><span>total items</span></div><div className="today-brief-stat"><strong>{activeJobs.length}</strong><span>active jobs</span></div></div>}</section>}
    <div className="today-layout">
      <Panel title="Next actions" subtitle="One click opens the right record with its context preserved." icon={<ListChecks size={16}/>} elevation="raised">
        {items.length===0?<div className="today-clear"><CheckCircle2 size={24}/><div><strong>Nothing needs attention</strong><p>Open a job to continue sourcing or add a follow-up when new work arrives.</p></div></div>:<>
          {doNow.length>0&&<div className="work-queue-band"><p className="work-queue-band-label work-queue-band-label-bad">Do now · {doNow.length}</p><ol className="work-queue">{doNow.map((item)=><WorkQueueRow item={item} now={now} working={taskAction.isPending} onTaskAction={actOnTask} key={item.id}/>)}</ol></div>}
          {todayItems.length>0&&<div className="work-queue-band"><p className="work-queue-band-label work-queue-band-label-warn">Today · {todayItems.length}</p><ol className="work-queue">{todayItems.map((item)=><WorkQueueRow item={item} now={now} working={taskAction.isPending} onTaskAction={actOnTask} key={item.id}/>)}</ol></div>}
          {later.length>0&&<div className="work-queue-band"><p className="work-queue-band-label work-queue-band-label-faint">Later · {later.length}</p><ol className="work-queue work-queue-later">{later.map((item)=><WorkQueueRow item={item} now={now} working={taskAction.isPending} onTaskAction={actOnTask} key={item.id}/>)}</ol></div>}
        </>}
      </Panel>
      <Panel title={scope==='mine'?'My active jobs':'Active jobs'} subtitle="Pipeline health at a glance." icon={<BriefcaseBusiness size={16}/>}>
        <div className="today-job-list">{activeJobs.slice(0,6).map((job)=>{
          const health=healthByJob.get(job.id)
          const action=health?nextActionDetail(health):null
          const chip=action
            ?{label:action.label,tone:action.surface==='edit'?'bad':'warn',title:action.explain}
            :{label:`${health?.candidate_count||0} active`,tone:'info',title:'Candidates currently in this job pipeline.'}
          return <Link to={`${base}/jobs/${job.id}`} key={job.id} className="today-job-row">
            <div className="today-job-row-top"><strong>{job.title}</strong><span className={`today-job-chip tone-${chip.tone}`} title={chip.title}>{chip.label}</span></div>
            <small>{job.companies?.name||'Client'} · {job.location||'Location not set'}{health?` · ${health.candidate_count} candidates`:''}</small>
            {health&&health.candidate_count>0&&<div className="pipeline-mini" aria-label={`${health.candidate_count} candidates by phase`}>{phaseSegments(health).map((segment)=><span key={segment.key} className={`phase-${segment.key}`} style={{flexGrow:segment.count}}/>)}</div>}
          </Link>
        })}{activeJobs.length===0&&<p className="muted">No active jobs in this view.</p>}</div>
        <div className="panel-footer-action"><Link className="record-link" to={`${base}/jobs`}>View all jobs <ArrowRight size={13}/></Link></div>
      </Panel>
    </div>
    {!capabilities.data?.readOnly&&<section className="today-shortcuts" aria-label="Common actions">{capabilities.data?.canWriteJobs&&<Link to={`${base}/jobs?new=1`}><BriefcaseBusiness size={18}/><span><strong>Create job</strong><small>Start a client search</small></span></Link>}<Link to={`${base}/today?action=task`}><CalendarClock size={18}/><span><strong>Add follow-up</strong><small>Capture the next action</small></span></Link></section>}
    {/* The inline "Add follow-up" modal that used to live here is gone: `?action=task` now opens the
      * one shared QuickTaskModal mounted in AppShell, which carries this modal's job picker plus the
      * description, owner, priority and due shortcuts this one never had. */}
  </Page>
}
