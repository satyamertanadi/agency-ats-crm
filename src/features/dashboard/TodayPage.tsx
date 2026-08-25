import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ArrowRight,BriefcaseBusiness,CalendarClock,CheckCircle2,ChevronDown,ListChecks,Plus} from 'lucide-react'
import {Link,useSearchParams} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {useAuth} from '../../app/AuthProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {completeTask,dashboardSummary,listEmailDeliveryIssues,listInterviews,listJobHealth,listJobs,listOffers,listPlacedJobCandidates,listRecentSubmissionFeedback,listSubmissionPackages,listTasks,snoozeTask} from '../core/repository'
import {ErrorState,TableSkeleton} from '../../shared/ui/States'
import {Page,Panel} from '../../shared/ui/Page'
import {formatTime} from '../../shared/lib/format'
import {lookup,todayWorkKind} from '../../shared/lib/status'
import {buildTodayWorkItems,type TodayFeedback,type TodayWorkItem} from '../workflow/workflow'
import {nextActionDetail,phaseSegments} from '../jobs/jobHealth'
import {SetupChecklist,buildSetupSteps} from './SetupChecklist'
import {Button} from '../../shared/ui/Button'
import {useToast} from '../../shared/ui/Toast'
import {NOT_RECORDED} from '../../shared/lib/labels'
import {DeliveryWorkbench} from '../submissions/DeliveryWorkbench'
import {SegmentedControl} from '../../shared/ui/SegmentedControl'

/* Deliberately short. This is a work queue: a client response from three weeks ago has either been
 * actioned or turned into a different problem, so surfacing it today is noise rather than work. */
const FEEDBACK_WINDOW_HOURS=72
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
/* Dismissal is per workspace and local to the browser. It records a preference about a checklist, not
 * a fact about the organization -- a second consultant joining should still get their own onboarding
 * -- so it does not warrant a column, a migration, or an RLS policy. */
const setupKey=(organizationId?:string)=>`setup-dismissed:${organizationId||'unknown'}`
const readSetupDismissed=(organizationId?:string)=>{try{return localStorage.getItem(setupKey(organizationId))==='1'}catch{return false}}
const writeSetupDismissed=(organizationId?:string)=>{try{localStorage.setItem(setupKey(organizationId),'1')}catch{/* private mode: the checklist simply returns next visit */}}

const latenessLabel=(dueAt:string,now:Date)=>{const days=Math.max(1,Math.ceil((now.getTime()-new Date(dueAt).getTime())/86_400_000));return `${days} day${days===1?'':'s'} late`}

/* A badge only where it says something the band heading has not already said.
 *
 * Every row used to carry one, and inside a band those badges were identical to each other and to
 * the heading above them: eight rows under "Do now", each stamped with a solid red "BLOCKED". Red
 * repeated eight times down a column is not eight warnings, it is a red column -- and once the whole
 * band is red, the genuinely worst row in it has no way to stand out. Alarm fatigue, built in.
 *
 * So 'blocked' now renders nothing: the band it sits in is called Blocked, and the row's own reason
 * line says what is blocking it. 'overdue' and 'today' keep theirs, because those carry a value that
 * DIFFERS per row -- "6 days late" against "1 day late", "09:30" against "16:00" -- which is the
 * information the reader is actually sorting by. */
function WorkQueueBadge({item,now}:{item:TodayWorkItem;now:Date}){
  if(item.kind==='overdue')return <span className="work-queue-badge work-queue-badge-solid">{item.dueAt?latenessLabel(item.dueAt,now):lookup(todayWorkKind,item.kind).label}</span>
  if(item.kind==='today')return <span className="work-queue-badge work-queue-badge-outline">{item.dueAt?formatTime(item.dueAt):lookup(todayWorkKind,item.kind).label}</span>
  return null
}

/* One band of the queue, capped.
 *
 * An agency mid-import can land forty overdue follow-ups in one band, which buries every other kind
 * of work under a wall of the same row. Showing the first few and counting the rest keeps the page
 * about "what needs doing" rather than "how far behind are we". The count states the full size
 * honestly, so nothing is concealed, and one click expands it in place. */
const BAND_LIMIT=6
function WorkQueueBand({label,tone,items,now,working,onTaskAction}:{
  label:string
  tone:'bad'|'warn'|'neutral'
  items:TodayWorkItem[]
  now:Date
  working:boolean
  onTaskAction:(taskId:string,action:'complete'|'snooze')=>void
}){
  const [expanded,setExpanded]=useState(false)
  if(items.length===0)return null
  const visible=expanded?items:items.slice(0,BAND_LIMIT)
  const hidden=items.length-visible.length
  return <div className="work-queue-band">
    <p className={`work-queue-band-label work-queue-band-${tone}`}>{label} <span>{items.length}</span></p>
    <ol className={`work-queue${tone==='neutral'?' work-queue-later':''}`}>
      {visible.map((item)=><WorkQueueRow item={item} now={now} working={working} onTaskAction={onTaskAction} key={item.id}/>)}
    </ol>
    {(hidden>0||expanded)&&<button type="button" className="work-queue-band-more" onClick={()=>setExpanded((value)=>!value)}>
      {expanded?`Show first ${BAND_LIMIT}`:`View all ${items.length}`}<ChevronDown size={13}/>
    </button>}
  </div>
}

function TaskActions({taskId,working,onAction}:{taskId?:string;working:boolean;onAction:(taskId:string,action:'complete'|'snooze')=>void}){
  if(!taskId)return null
  return <><Button size="sm" variant="quiet" leadingIcon={<CheckCircle2 size={13}/>} disabled={working} onClick={()=>onAction(taskId,'complete')}>Done</Button><Button size="sm" variant="quiet" disabled={working} onClick={()=>onAction(taskId,'snooze')}>Tomorrow</Button></>
}

function WorkQueueRow({item,now,working,onTaskAction}:{item:TodayWorkItem;now:Date;working:boolean;onTaskAction:(taskId:string,action:'complete'|'snooze')=>void}){
  if(item.group)return <li key={item.id} className="work-queue-row work-queue-group"><details><summary><div className="work-queue-main"><WorkQueueBadge item={item} now={now}/><div><strong>{item.title}</strong><p>{item.reason}</p></div></div><span className="work-queue-group-toggle">{item.group.length} {item.groupNoun||'items'}<ChevronDown size={14}/></span></summary><ul className="work-queue-group-list">{item.group.map((sub)=><li key={`${sub.href}-${sub.taskId||sub.label}`}><span>{sub.label}</span><div className="lifecycle-actions"><TaskActions taskId={sub.taskId} working={working} onAction={onTaskAction}/><Link className="button button-secondary button-sm" to={sub.href}>{sub.cta}<ArrowRight size={13}/></Link></div></li>)}</ul></details></li>
  if(item.kind==='upcoming'||item.kind==='recommended')return <li key={item.id} className="work-queue-later-row"><span className="work-queue-dot" aria-hidden="true"/><span className="work-queue-later-main"><strong>{item.title}</strong><span>{item.reason}</span></span><div className="lifecycle-actions"><TaskActions taskId={item.taskId} working={working} onAction={onTaskAction}/><Link className="icon-button" to={item.href} aria-label={item.cta}><ArrowRight size={14}/></Link></div></li>
  return <li key={item.id} className="work-queue-row"><div className="work-queue-main"><WorkQueueBadge item={item} now={now}/><div><strong>{item.title}</strong><p>{item.reason}</p></div></div><div className="lifecycle-actions"><TaskActions taskId={item.taskId} working={working} onAction={onTaskAction}/><Link className="button button-secondary button-sm" to={item.href}>{item.cta}<ArrowRight size={13}/></Link></div></li>
}

export function TodayPage(){
  const {organization,membership}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast();const [scope,setScope]=useState<'mine'|'team'>('mine')
  const [params,setParams]=useSearchParams()
  /* Today has two halves now: the action queue it has always been, and the cross-job view of what has
   * been sent to clients. A switch inside Today rather than a seventh sidebar item, because both
   * answer the same question -- what needs me today -- and a nav item for the second would put the
   * work a consultant does every morning in two places.
   *
   * `?view=delivery` so it survives a reload and can be linked between colleagues. Anything else is
   * the action queue, so a typo lands on the default rather than on nothing. */
  const deliveryView=params.get('view')==='delivery'
  const currentMember=membership
  const [setupHidden,setSetupHidden]=useState(()=>readSetupDismissed(organization?.id))
  /* Ten parallel list queries. Deliberately NOT run while Delivery is showing: the two halves of
   * this page fetch entirely different things, and paying for both because they share a route is how
   * a switch becomes slower than a navigation. The same rule applies in reverse -- DeliveryWorkbench
   * is not mounted at all below unless it is the active half. */
  const query=useQuery({queryKey:['today',organization?.id],enabled:Boolean(organization)&&!deliveryView,queryFn:async()=>{
    /* The windows the notification-lite items are built from, bounded on the server: an unbounded
     * feedback list would be an archive rather than a queue. */
    const feedbackSince=new Date(Date.now()-FEEDBACK_WINDOW_HOURS*3_600_000).toISOString()
    const workQueueSince=new Date(Date.now()-WORK_QUEUE_LOOKBACK_DAYS*86_400_000).toISOString()
    /* Offers are bounded by status rather than by date: the queue only ever builds items from
     * 'presented' and 'accepted', so the other statuses were fetched and discarded. Placements are
     * needed only as a set of already-placed job candidates, which is two columns rather than the
     * full rows with their revenue splits and invoices. */
    const [tasks,interviews,offers,placements,jobs,summary,deliveryIssues,submissions,jobHealth,feedback]=await Promise.all([listTasks(organization!.id),listInterviews(organization!.id,{since:workQueueSince}),listOffers(organization!.id,{statuses:['presented','accepted']}),listPlacedJobCandidates(organization!.id),listJobs(organization!.id),dashboardSummary(organization!.id),listEmailDeliveryIssues(organization!.id),listSubmissionPackages(organization!.id,{since:workQueueSince}),listJobHealth(organization!.id),listRecentSubmissionFeedback(organization!.id,feedbackSince)])
    return {tasks,interviews,offers,placements,jobs,summary,deliveryIssues,submissions,jobHealth,feedback}
  }})
  const taskAction=useMutation({mutationFn:({taskId,action}:{taskId:string;action:'complete'|'snooze'})=>{if(action==='complete')return completeTask(organization!.id,taskId);const due=new Date();due.setDate(due.getDate()+1);due.setHours(9,0,0,0);return snoozeTask(organization!.id,taskId,due.toISOString())},onSuccess:async(_result,variables)=>{toast.success(variables.action==='complete'?'Follow-up completed.':'Follow-up moved to tomorrow.');await Promise.all([cache.invalidateQueries({queryKey:['today',organization?.id]}),cache.invalidateQueries({queryKey:['tasks',organization?.id]}),cache.invalidateQueries({queryKey:['agency-performance',organization?.id]})])},onError:(error)=>toast.error(error,'The follow-up was not changed.')})
  const actOnTask=(taskId:string,action:'complete'|'snooze')=>taskAction.mutate({taskId,action})
  const name=(user?.user_metadata.full_name as string|undefined)?.split(' ')[0]
  const base=`/app/${organization?.slug||'workspace'}`
  /* One header for both halves, so the switch stays in the same place while the action queue is
   * still loading. It used to be built twice -- the skeleton return below rendered a Page with no
   * actions at all -- which meant the controls appeared a beat after the page did. */
  const shell={
    title:name?`Today, ${name}`:'Today',
    eyebrow:organization?.name,
    description:deliveryView
      ?'Everything you have sent to clients, and what each one is waiting on.'
      :'Your next recruitment actions, in the order they need attention.',
    className:'today-page',
    actions:<div className="page-scope-actions">
      <SegmentedControl label="Today view" value={deliveryView?'delivery':'actions'}
        options={[{id:'actions' as const,label:'Actions'},{id:'delivery' as const,label:'Delivery'}]}
        onChange={(next)=>{
          const nextParams=new URLSearchParams(params)
          if(next==='delivery')nextParams.set('view','delivery');else nextParams.delete('view')
          setParams(nextParams,{replace:true})
        }}/>
      {/* Unchanged: My work / Team view still scopes both halves, and is still only offered to
        * members who can see other people's work at all. */}
      {capabilities.data?.canViewTeamReports&&<SegmentedControl label="Work scope" value={scope} onChange={setScope}
        options={[{id:'mine' as const,label:'My work'},{id:'team' as const,label:'Team view'}]}/>}
      {capabilities.data?.canWriteCandidates&&<Link className="button button-primary" to={`${base}/candidates?new=1`}><Plus size={15}/>Add candidate</Link>}
    </div>,
  }
  /* Returned before the action queue's guards, because that query is disabled in this view -- a
   * disabled query has no data, and falling through to the `!query.data` check below would render
   * the error state for a page that is working perfectly. */
  if(deliveryView)return <Page {...shell}>
    <Panel elevation="raised"><DeliveryWorkbench scope={scope} currentMemberId={currentMember?.id}/></Panel>
  </Page>
  if(query.isLoading||capabilities.isLoading)return <Page {...shell}><Panel><TableSkeleton rows={6} columns={2} label="Preparing your work for today…"/></Panel></Page>
  if(query.error||!query.data)return <ErrorState error={query.error} retry={()=>void query.refetch()}/>
  const now=new Date()
  const items=buildTodayWorkItems({base,now,currentMemberId:scope==='mine'?currentMember?.id:undefined,tasks:query.data.tasks,interviews:query.data.interviews,offers:query.data.offers,placements:query.data.placements,jobs:query.data.jobs,deliveryIssues:query.data.deliveryIssues,submissions:query.data.submissions,feedback:toTodayFeedback(query.data.feedback)})
  const steps=buildSetupSteps(query.data.summary,base);const setupComplete=steps.length>0&&steps.every((step)=>step.done)
  // Complete or hidden both mean the same thing to the page below: show the brief. The checklist used
  // to render a `onDismiss` prop nobody passed, so a solo consultant who would never invite a team
  // was stuck on a permanently unfinished list with the operating brief suppressed behind it.
  const showSetup=!setupComplete&&!setupHidden
  const dismissSetup=()=>{writeSetupDismissed(organization?.id);setSetupHidden(true)}
  /* Four bands, split by the same `kind` buildTodayWorkItems already assigns -- no second urgency
   * model to keep in sync with the first.
   *
   * Blocked and Overdue used to share one "Do now" band, which conflated two different problems with
   * two different fixes: blocked means something is preventing the work (a bounced email, a missing
   * approval) and is usually not the consultant's own doing, while overdue means a commitment they
   * made has passed. Read as one list, the blocked items look like personal backlog. */
  const blocked=items.filter((item)=>item.kind==='blocked')
  const overdue=items.filter((item)=>item.kind==='overdue')
  const todayItems=items.filter((item)=>item.kind==='today')
  const later=items.filter((item)=>item.kind==='upcoming'||item.kind==='recommended')
  const activeJobs=query.data.jobs.filter((job)=>job.status==='open'&&(scope==='team'||!job.owner_member_id||job.owner_member_id===currentMember?.id))
  const healthByJob=new Map(query.data.jobHealth.map((health)=>[health.id,health]))
  return <Page {...shell}>
    {showSetup&&<SetupChecklist steps={steps} onDismiss={dismissSetup}/>}
    {/* The KPI row this used to open with is gone -- "Do now"/"Due today"/"Later" restated the exact
      * counts the three bands below already carry in their own labels ("Do now · 3"), one scroll
      * apart. Same numbers, twice, before the queue that actually needed the space. */}
    <div className="today-layout">
      {/* The subtitle "One click opens the right record with its context preserved." is gone. It
        * described the behaviour of a link, above a list of links, to people who click links for a
        * living. */}
      <Panel title="Next actions" icon={<ListChecks size={16}/>} elevation="raised">
        {items.length===0?<div className="today-clear"><CheckCircle2 size={24}/><div><strong>Nothing needs attention</strong><p>Open a job to continue sourcing or add a follow-up when new work arrives.</p></div></div>:<>
          <WorkQueueBand label="Blocked" tone="bad" items={blocked} now={now} working={taskAction.isPending} onTaskAction={actOnTask}/>
          <WorkQueueBand label="Overdue" tone="bad" items={overdue} now={now} working={taskAction.isPending} onTaskAction={actOnTask}/>
          <WorkQueueBand label="Due today" tone="warn" items={todayItems} now={now} working={taskAction.isPending} onTaskAction={actOnTask}/>
          <WorkQueueBand label="Later" tone="neutral" items={later} now={now} working={taskAction.isPending} onTaskAction={actOnTask}/>
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
            <small>{job.companies?.name||'Client'} · {job.location||NOT_RECORDED}{health?` · ${health.candidate_count} candidates`:''}</small>
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
