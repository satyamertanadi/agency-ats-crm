import type {JobHealth} from '../../shared/types/domain'
import {recommendedRecruitmentAction} from '../workflow/workflow'

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

/* Job actions use the same resolver as candidate actions and Today. `list_job_health.next_action` is
 * retained for database compatibility, but it is no longer a competing source of workflow truth. */
export type NextActionSurface='edit'|'add'|'activity'|'board'
const actionSurfaces:Record<string,{suffix:string;surface:NextActionSurface}>={
  assign_owner:{suffix:'?open=edit',surface:'edit'},
  add_candidates:{suffix:'?open=add',surface:'add'},
}

export function nextActionHref(base:string,job:Pick<JobHealth,'status'|'owner_member_id'|'candidate_count'>){
  const action=recommendedRecruitmentAction({scope:'job',status:job.status,ownerMemberId:job.owner_member_id,candidateCount:job.candidate_count})
  return `${base}${(action&&actionSurfaces[action.key]?.suffix)||''}`
}

export function nextActionDetail(job:JobHealth){
  const action=recommendedRecruitmentAction({scope:'job',status:job.status,ownerMemberId:job.owner_member_id,candidateCount:job.candidate_count})
  const model=action?actionSurfaces[action.key]:undefined
  return action&&model?{label:action.label,surface:model.surface,explain:action.reason}:null
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
