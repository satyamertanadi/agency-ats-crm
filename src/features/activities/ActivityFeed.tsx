import {useState,type FormEvent} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ArrowDownLeft,ArrowUpRight,CircleDot,Handshake,Mail,MessageSquare,Phone,Send,Users} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {createActivity,listActivities,type ActivityLink} from '../core/repository'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Panel} from '../../shared/ui/Page'
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/States'
import type {ActivityType} from '../../shared/types/domain'

const manualTypes=[{value:'call',label:'Call'},{value:'email',label:'Email'},{value:'whatsapp',label:'WhatsApp'},{value:'meeting',label:'Meeting'},{value:'other',label:'Other'}] as const
const icons:Record<ActivityType,typeof Phone>={call:Phone,email:Mail,whatsapp:MessageSquare,meeting:Users,interview:Users,status_change:CircleDot,submission:Send,client_feedback:ArrowDownLeft,placement:Handshake,other:CircleDot}

// datetime-local wants `YYYY-MM-DDTHH:mm` in local time; toISOString would shift it by the offset.
const localNow=()=>{const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());return now.toISOString().slice(0,16)}
const relative=(iso:string)=>{const diff=Date.now()-new Date(iso).getTime();const mins=Math.round(diff/60000)
  if(mins<1)return 'just now';if(mins<60)return `${mins}m ago`
  const hours=Math.round(mins/60);if(hours<24)return `${hours}h ago`
  const days=Math.round(hours/24);if(days<30)return `${days}d ago`
  return new Date(iso).toLocaleDateString()}

/**
 * Reads and writes the shared activity journal for one record. `links` names every record the
 * entry should appear on: logging a call from a vacancy's pipeline can file it against the
 * candidate and the vacancy at once.
 */
export function ActivityFeed({links,title='Activity',subtitle='Calls, emails, and meetings, plus pipeline movement recorded automatically.'}:{links:ActivityLink[];title?:string;subtitle?:string}){
  const {organization}=useOrganization();const cache=useQueryClient()
  const primary=links[0]
  const [open,setOpen]=useState(false)
  const [type,setType]=useState<string>('call')
  const [direction,setDirection]=useState('outbound')
  const [subject,setSubject]=useState('')
  const [summary,setSummary]=useState('')
  const [occurredAt,setOccurredAt]=useState(localNow)

  const query=useQuery({queryKey:['activities',organization?.id,primary],enabled:Boolean(organization&&primary),queryFn:()=>listActivities(organization!.id,primary!)})
  const reset=()=>{setSubject('');setSummary('');setType('call');setDirection('outbound');setOccurredAt(localNow())}
  const log=useMutation({
    mutationFn:()=>createActivity(organization!.id,{activity_type:type,direction,subject:subject.trim()||undefined,summary:summary.trim(),occurred_at:new Date(occurredAt).toISOString()},links),
    onSuccess:async()=>{reset();setOpen(false)
      await cache.invalidateQueries({queryKey:['activities',organization?.id]})
      // The dashboard reads the same journal, so its feed would otherwise lag behind this one.
      await cache.invalidateQueries({queryKey:['dashboard',organization?.id]})},
  })
  const submit=(event:FormEvent)=>{event.preventDefault();if(summary.trim())log.mutate()}

  return <Panel title={title} subtitle={subtitle} elevation="raised"
    action={<Button variant={open?'quiet':'secondary'} onClick={()=>{setOpen(!open);log.reset()}} aria-expanded={open}>{open?'Cancel':'Log activity'}</Button>}>
    {open&&<form className="form-grid activity-form" onSubmit={submit}>
      <Field label="Type"><Select value={type} onChange={(event)=>setType(event.target.value)}>{manualTypes.map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
      <Field label="Direction"><Select value={direction} onChange={(event)=>setDirection(event.target.value)}><option value="outbound">Outbound</option><option value="inbound">Inbound</option><option value="internal">Internal</option></Select></Field>
      <Field label="When"><Input type="datetime-local" max={localNow()} value={occurredAt} onChange={(event)=>setOccurredAt(event.target.value)}/></Field>
      <Field label="Subject (optional)"><Input value={subject} maxLength={120} placeholder="Intro call" onChange={(event)=>setSubject(event.target.value)}/></Field>
      <div className="full"><Field label="What happened"><Textarea rows={3} value={summary} required placeholder="She is interested but needs three months' notice." onChange={(event)=>setSummary(event.target.value)}/></Field></div>
      {log.error&&<p className="form-error full" role="alert">{log.error.message}</p>}
      <div className="form-actions full"><Button type="submit" loading={log.isPending} disabled={!summary.trim()}>Save activity</Button></div>
    </form>}
    {query.isLoading?<LoadingState label="Loading activity…"/>
      :query.error?<ErrorState error={query.error} retry={()=>void query.refetch()}/>
      :query.data?.length===0?<EmptyState title="No activity yet" description="Log a call, email, or meeting. Pipeline moves and client feedback appear here on their own."/>
      :<ol className="activity-list">{query.data?.map((activity)=>{const Icon=icons[activity.activity_type]??CircleDot;return <li className="activity-item" key={activity.id}>
        <span className={`activity-icon activity-icon-${activity.activity_type}`} aria-hidden="true"><Icon size={13}/></span>
        <div className="activity-body">
          <div className="activity-heading"><strong>{activity.subject||manualTypes.find((item)=>item.value===activity.activity_type)?.label||'Update'}</strong>
            {activity.direction==='inbound'&&<ArrowDownLeft size={12} aria-label="Inbound"/>}
            {activity.direction==='outbound'&&<ArrowUpRight size={12} aria-label="Outbound"/>}</div>
          <p>{activity.summary}</p>
          <small>{activity.profiles?.full_name||'A teammate'} · <time dateTime={activity.occurred_at} title={new Date(activity.occurred_at).toLocaleString()}>{relative(activity.occurred_at)}</time></small>
        </div>
      </li>})}</ol>}
  </Panel>
}
