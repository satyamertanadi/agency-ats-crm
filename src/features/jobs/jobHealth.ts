import type {JobHealth} from '../../shared/types/domain'

export type JobHealthFilter='all'|'unowned'|'empty'|'stale'|'interview'|'offer'|'high_value'|'urgent'

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
