import type {JobHealth} from '../../shared/types/domain'

export type JobHealthFilter='all'|'unowned'|'empty'|'stale'|'interview'|'offer'|'high_value'|'urgent'

/* The list used to hard-filter to open/draft/on_hold with no way to see anything else, so a job the
 * consultant filled last week -- the one they need to invoice against, or to copy the brief from --
 * was reachable only by URL. Statuses are grouped rather than listed one per chip because "closed"
 * and "cancelled" are the same question being asked ("what did we stop working on"), and six chips
 * for six enum values would be a database schema rendered as a toolbar. */
export type JobStatusFilter='active'|'filled'|'closed'|'all'
const statusGroups:Record<Exclude<JobStatusFilter,'all'>,string[]>={active:['open','draft','on_hold'],filled:['filled'],closed:['closed','cancelled']}

export function filterJobStatus(jobs:JobHealth[],filter:JobStatusFilter){
  if(filter==='all')return jobs
  const allowed=statusGroups[filter]
  return jobs.filter((job)=>allowed.includes(job.status))
}

/* next_action is computed by list_job_health, so it is a fixed vocabulary rather than free text -- and
 * one model of it serves both readers. The jobs list turns it into a link; the workspace's details tab
 * turns it into a button. Mapping the same four phrases twice is how the list would come to promise an
 * action the workspace does not offer.
 *
 * Naming an action without carrying it is the friction this closes: a CTA reading "Assign an owner"
 * that lands on a board with no owner field anywhere on it is a label, not an action. */
export type NextActionSurface='edit'|'add'|'activity'|'board'
const nextActions:Record<string,{suffix:string;surface:NextActionSurface;explain:(job:JobHealth)=>string}>={
  'Assign an owner':{suffix:'?open=edit',surface:'edit',explain:()=>'Nobody is accountable for this job yet.'},
  'Add candidates':{suffix:'?open=add',surface:'add',explain:()=>'This pipeline is empty.'},
  // Both of these already land where the work is, so they add no suffix.
  'Review waiting candidates':{suffix:'',surface:'board',explain:(job)=>`${job.waiting_count} ${job.waiting_count===1?'candidate has':'candidates have'} sat in the same stage for over a week.`},
  'Log first activity':{suffix:'?view=activity',surface:'activity',explain:()=>'No call, note or client update has been recorded against this job.'},
}

export function nextActionHref(base:string,job:Pick<JobHealth,'next_action'>){
  return `${base}${(job.next_action&&nextActions[job.next_action]?.suffix)||''}`
}

export function nextActionDetail(job:JobHealth){
  const model=job.next_action?nextActions[job.next_action]:undefined
  return model?{label:job.next_action!,surface:model.surface,explain:model.explain(job)}:null
}

export function filterJobHealth(jobs:JobHealth[],filter:JobHealthFilter,now=Date.now()){
  return jobs.filter((job)=>{
    if(filter==='unowned')return !job.owner_member_id
    if(filter==='empty')return job.candidate_count===0
    if(filter==='stale')return !job.last_activity_at||now-new Date(job.last_activity_at).getTime()>7*86_400_000
    if(filter==='interview')return Number(job.phase_counts.interview||0)>0
    if(filter==='offer')return Number(job.phase_counts.offer||0)>0
    if(filter==='high_value')return Number(job.expected_fee||0)>=10_000
    if(filter==='urgent')return job.priority==='urgent'||job.priority==='high'
    return true
  })
}

export function phaseSegments(job:JobHealth){
  const keys=['sourcing','screening','shortlist','client_review','interview','offer','placed']
  return keys.map((key)=>({key,count:Number(job.phase_counts[key]||0)})).filter((item)=>item.count>0)
}
