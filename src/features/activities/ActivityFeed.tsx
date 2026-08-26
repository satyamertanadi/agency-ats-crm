import {useState,type FormEvent,type ReactNode} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ArrowDownLeft,ArrowUpRight,CircleDot,Handshake,Mail,MessageSquare,Phone,Send,StickyNote,Users} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {createActivityWithFollowUp,listActivities,type ActivityLink} from '../core/repository'
import {listTeamMembers} from '../core/commercialRepository'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Panel} from '../../shared/ui/Page'
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'
import {formatDate,formatDateTime} from '../../shared/lib/format'
import {dateTimeHint} from '../../shared/lib/datetimeField'
import type {ActivityType} from '../../shared/types/domain'
import {presentActivity} from './activityPresentation'

const manualTypes=[{value:'call',label:'Call'},{value:'email',label:'Email'},{value:'whatsapp',label:'WhatsApp'},{value:'meeting',label:'Meeting'},{value:'other',label:'Other'}] as const
const icons:Record<ActivityType,typeof Phone>={call:Phone,email:Mail,whatsapp:MessageSquare,meeting:Users,interview:Users,status_change:CircleDot,submission:Send,client_feedback:ArrowDownLeft,placement:Handshake,note:StickyNote,other:CircleDot}

// datetime-local wants `YYYY-MM-DDTHH:mm` in local time; toISOString would shift it by the offset.
const localNow=()=>{const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());return now.toISOString().slice(0,16)}
/* Copied deliberately from QuickTaskModal rather than imported through it: the two must agree, and
 * the alternative -- ActivityFeed importing a modal to borrow a date -- would couple a panel to a
 * dialog it has nothing else to do with. Same shortcuts, same 17:00-today / 09:00-later convention,
 * so a follow-up booked from here lands where one booked from the task button lands. */
const dueValue=(days:number)=>{const date=new Date();date.setDate(date.getDate()+days);date.setHours(days===0?17:9,0,0,0);const local=new Date(date.getTime()-date.getTimezoneOffset()*60_000);return local.toISOString().slice(0,16)}
const DUE_SHORTCUTS=[['Today',0],['Tomorrow',1],['In 3 days',3],['Next week',7]] as const
const relative=(iso:string)=>{const diff=Date.now()-new Date(iso).getTime();const mins=Math.round(diff/60000)
  if(mins<1)return 'just now';if(mins<60)return `${mins}m ago`
  const hours=Math.round(mins/60);if(hours<24)return `${hours}h ago`
  const days=Math.round(hours/24);if(days<30)return `${days}d ago`
  return formatDate(iso)}

/**
 * Reads and writes the shared activity journal for one record. `links` names every record the
 * entry should appear on: logging a call from a vacancy's pipeline can file it against the
 * candidate and the vacancy at once.
 */
export function ActivityFeed({links,title='Activity',subtitle='Calls, emails, and meetings, plus pipeline movement recorded automatically.',readOnly=false,headerAction}:{
  links:ActivityLink[]
  title?:string
  subtitle?:string
  readOnly?:boolean
  /* An extra control for this panel's header, rendered beside "Log activity".
   *
   * It exists so "Add task" can live next to the history it belongs to instead of as a full-width
   * bar of its own above the panel -- a bare <Button> as a direct child of the page grid stretched
   * edge to edge and read as a section, not a control. Scheduling the next contact and reading the
   * last one are the same moment of work, so they belong in the same header. */
  headerAction?:ReactNode
}){
  const {organization,membership}=useOrganization();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast()
  const primary=links[0]
  const [open,setOpen]=useState(false)
  const [type,setType]=useState<string>('call')
  const [direction,setDirection]=useState('outbound')
  const [subject,setSubject]=useState('')
  const [summary,setSummary]=useState('')
  const [occurredAt,setOccurredAt]=useState(localNow)
  /* The follow-up half. Closed by default and opened by a checkbox rather than always shown: most
   * entries in this journal are a note about something finished, and a form that demanded a next
   * action every time would teach people to type something into it. */
  const [followUp,setFollowUp]=useState(false)
  const [taskTitle,setTaskTitle]=useState('')
  const [taskDueAt,setTaskDueAt]=useState(()=>dueValue(0))
  const [taskPriority,setTaskPriority]=useState('normal')
  const [taskOwnerId,setTaskOwnerId]=useState('')
  /* A follow-up needs somewhere to point, and task_links only reaches these four. An activity filed
   * only against a submission or a placement has no valid target -- the RPC refuses it -- so the
   * section is not offered rather than offered and then refused. */
  const canFollowUp=Boolean(links.some((link)=>link.candidate_id||link.company_id||link.contact_id||link.job_id))
    &&!capabilities.data?.readOnly
  // Only fetched once the section is actually open. A closed panel must not cost a team request.
  const team=useQuery({queryKey:['team',organization?.id],enabled:followUp&&Boolean(organization),
    queryFn:()=>listTeamMembers(organization!.id)})

  const query=useQuery({queryKey:['activities',organization?.id,primary],enabled:Boolean(organization&&primary),queryFn:()=>listActivities(organization!.id,primary!)})
  const reset=()=>{setSubject('');setSummary('');setType('call');setDirection('outbound');setOccurredAt(localNow())
    setFollowUp(false);setTaskTitle('');setTaskDueAt(dueValue(0));setTaskPriority('normal');setTaskOwnerId('')}
  const log=useMutation({
    /* One call, one transaction. Never createActivity followed by createTask: those can half-succeed,
     * and the half that survives is the note claiming a follow-up was booked. */
    mutationFn:()=>createActivityWithFollowUp(organization!.id,
      {activity_type:type,direction,subject:subject.trim()||undefined,summary:summary.trim(),occurred_at:new Date(occurredAt).toISOString()},
      links,
      followUp&&taskTitle.trim()
        ?{title:taskTitle.trim(),dueAt:taskDueAt?new Date(taskDueAt).toISOString():undefined,
          ownerMemberId:taskOwnerId||membership?.id,priority:taskPriority}
        :undefined),
    onSuccess:async(result)=>{const scheduled=Boolean(result.task_id);reset();setOpen(false)
      await cache.invalidateQueries({queryKey:['activities',organization?.id]})
      /* The dashboard reads the same journal, so its feed would otherwise lag behind this one.
       * `tasks` joins them because a follow-up written here belongs to the same list the task button
       * writes to, and Today is where it will actually be read. One invalidation pass, not one per
       * write -- the two writes were one statement and the refresh is one act. */
      await Promise.all([
        cache.invalidateQueries({queryKey:['dashboard',organization?.id]}),
        cache.invalidateQueries({queryKey:['today',organization?.id]}),
        cache.invalidateQueries({queryKey:['tasks',organization?.id]}),
      ])
      if(scheduled)toast.success('Activity logged and follow-up scheduled.','It appears in Today as soon as it is due.')},
    /* One message for both halves, because one is what happened: the transaction either wrote both or
     * wrote neither, and a message naming only the activity would leave the user guessing about the
     * task. */
    onError:(error)=>toast.error(error,followUp?'Nothing was saved — the activity and the follow-up are recorded together.':'The activity was not logged.'),
  })
  // A follow-up that was asked for and left unnamed blocks submission, rather than being dropped
  // silently on the way to the server.
  const ready=Boolean(summary.trim())&&(!followUp||Boolean(taskTitle.trim()))
  const submit=(event:FormEvent)=>{event.preventDefault();if(ready)log.mutate()}

  return <Panel title={title} subtitle={subtitle} elevation="raised"
    action={<span className="panel-header-actions">{headerAction}{!readOnly&&<Button variant={open?'quiet':'secondary'} onClick={()=>{setOpen(!open);log.reset()}} aria-expanded={open}>{open?'Cancel':'Log activity'}</Button>}</span>}>
    {open&&!readOnly&&<form className="form-grid activity-form" onSubmit={submit}>
      <Field label="Type"><Select value={type} onChange={(event)=>setType(event.target.value)}>{manualTypes.map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
      <Field label="Direction"><Select value={direction} onChange={(event)=>setDirection(event.target.value)}><option value="outbound">Outbound</option><option value="inbound">Inbound</option><option value="internal">Internal</option></Select></Field>
      <Field label="When" hint={dateTimeHint(occurredAt,organization?.timezone)}><Input type="datetime-local" max={localNow()} value={occurredAt} onChange={(event)=>setOccurredAt(event.target.value)}/></Field>
      <Field label="Subject (optional)"><Input value={subject} maxLength={120} placeholder="Intro call" onChange={(event)=>setSubject(event.target.value)}/></Field>
      <div className="full"><Field label="What happened"><Textarea rows={3} value={summary} required placeholder="She is interested but needs three months' notice." onChange={(event)=>setSummary(event.target.value)}/></Field></div>
      {canFollowUp&&<div className="full activity-follow-up">
        <label className="checkbox-row">
          <input type="checkbox" checked={followUp} onChange={(event)=>setFollowUp(event.target.checked)}/>
          <span>Schedule a follow-up <small>Saved with this activity. If the follow-up cannot be created, neither is saved.</small></span>
        </label>
        {followUp&&<div className="stack activity-follow-up-fields">
          <Field label="What needs to happen next?">
            <Input autoFocus value={taskTitle} maxLength={200} placeholder="Call back about the counter-offer"
              onChange={(event)=>setTaskTitle(event.target.value)}/>
          </Field>
          <div className="task-date-shortcuts" aria-label="Due date shortcuts">
            {DUE_SHORTCUTS.map(([label,days])=><Button type="button" size="sm" variant="quiet" key={label}
              onClick={()=>setTaskDueAt(dueValue(days))}>{label}</Button>)}
          </div>
          <div className="form-grid">
            <Field label="Due" hint={dateTimeHint(taskDueAt,organization?.timezone)}><Input type="datetime-local" value={taskDueAt} onChange={(event)=>setTaskDueAt(event.target.value)}/></Field>
            <Field label="Owner"><Select value={taskOwnerId||membership?.id||''} onChange={(event)=>setTaskOwnerId(event.target.value)}>
              <option value="">Unassigned</option>
              {team.data?.filter((member)=>member.status==='active').map((member)=>
                <option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}
            </Select></Field>
            <Field label="Priority"><Select value={taskPriority} onChange={(event)=>setTaskPriority(event.target.value)}>
              <option value="normal">Normal</option><option value="high">High</option>
              <option value="urgent">Urgent</option><option value="low">Low</option>
            </Select></Field>
          </div>
        </div>}
      </div>}
      {log.error&&<p className="form-error full" role="alert">{log.error.message}</p>}
      <div className="form-actions full"><Button type="submit" loading={log.isPending} disabled={!ready}>
        {followUp?'Save activity and follow-up':'Save activity'}
      </Button></div>
    </form>}
    {query.isLoading?<LoadingState label="Loading activity…"/>
      :query.error?<ErrorState error={query.error} retry={()=>void query.refetch()}/>
      :query.data?.length===0?<EmptyState title="No activity yet" description="Log a call, email, or meeting. Pipeline moves and client feedback appear here on their own."/>
      :<ol className="activity-list">{query.data?.map((activity)=>{const Icon=icons[activity.activity_type]??CircleDot;const presentation=presentActivity(activity);return <li className="activity-item" key={activity.id}>
        <span className={`activity-icon activity-icon-${activity.activity_type}`} aria-hidden="true"><Icon size={13}/></span>
        <div className="activity-body">
          <div className="activity-heading"><strong>{presentation.title||manualTypes.find((item)=>item.value===activity.activity_type)?.label||'Update'}</strong>
            {activity.direction==='inbound'&&<ArrowDownLeft size={12} aria-label="Inbound"/>}
            {activity.direction==='outbound'&&<ArrowUpRight size={12} aria-label="Outbound"/>}</div>
          <p>{presentation.detail&&<small>{presentation.detail}: </small>}{presentation.summary}</p>
          <small>{activity.profiles?.full_name||activity.actor_name_snapshot||'Unknown former user'} · <time className="activity-time" tabIndex={0} dateTime={activity.occurred_at}><span>{relative(activity.occurred_at)}</span><span className="activity-time-exact">{formatDateTime(activity.occurred_at)}</span></time></small>
        </div>
      </li>})}</ol>}
  </Panel>
}
