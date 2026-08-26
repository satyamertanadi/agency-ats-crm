type MilestoneRecord={job_candidate_id:string;status?:string|null}
type TaskRecord={status:string;due_at:string|null;deleted_at?:string|null}

export const metricDefinitions={
  submission:'A unique candidate-and-job record included in a client submission package during the selected period.',
  interview:'A submitted candidate-and-job record with at least one non-cancelled interview created during the selected period.',
  offer:'A submitted candidate-and-job record with at least one presented or decided offer created during the selected period.',
  placement:'A submitted candidate-and-job record with a non-cancelled placement created during the selected period.',
  completedPlacement:'A placement whose status is completed.',
  overdueTask:'An open or in-progress, non-deleted task whose due time is earlier than the report refresh time.',
  /* The two placement figures on the team scorecard are different numbers on purpose, and the page
   * showed both without ever saying so -- which reads as a bug in the report rather than as two
   * questions with two answers. `placement` above is cohort-constrained (of the candidates SUBMITTED
   * in this period, how many reached a placement); this one is not. A candidate submitted in December
   * and placed in January counts here and not there. */
  recordedPlacement:'Every non-cancelled placement created during the selected period, whatever period the candidate was submitted in. Larger than the funnel placement figure whenever a placement closed in this period for a candidate submitted before it.',
  /* The personal scorecard's tiles are built by buildConsultantRows, which -- unlike the team funnel
   * -- applies NO cohort constraint. A consultant's interview count includes interviews they ran this
   * month for someone submitted last month, because that is the work they did this month.
   *
   * The tiles previously carried `interview` and `offer` above, which are the cohort sentences. The
   * numbers were right and their stated definitions were not, which is the worst arrangement of the
   * two: a consultant reconciling their tile against the sentence under their cursor would find a
   * discrepancy that does not exist and conclude the report is broken. Naming the personal
   * definitions separately is what lets a drilldown open exactly the records the tile counted. */
  consultantInterview:'A candidate-and-job record you created a non-cancelled interview for during the selected period, whatever period the candidate was submitted in.',
  consultantOffer:'A candidate-and-job record you presented or decided an offer on during the selected period, whatever period the candidate was submitted in.',
} as const

/* Chart labels for a set of people, disambiguated only as far as they need to be.
 *
 * The consultant workload chart labelled its bars `name.split(' ')[0]`, so an agency with two people
 * called Satya got two bars labelled "Satya" -- and since a stacked bar chart has no other identifier,
 * the chart was unreadable exactly where reading it matters most, which is comparing colleagues.
 * Recharts also de-duplicates identical category keys, so the two could collapse into one bar.
 *
 * Escalates rather than defaulting to full names: first name where it is unique (short labels fit the
 * axis and are how people refer to each other), first name plus surname initial where it is not, and
 * the whole name where even that collides. A one-word name that collides falls back to the full name,
 * which at least differs by nothing rather than lying.
 */
export function shortNameLabels(names:string[]):string[]{
  const parts=names.map((name)=>name.trim().split(/\s+/).filter(Boolean))
  const first=parts.map((piece)=>piece[0]||'Unknown')
  const count=(values:string[])=>values.reduce<Record<string,number>>((totals,value)=>({...totals,[value]:(totals[value]||0)+1}),{})
  const firstCounts=count(first)
  const withInitial=parts.map((piece,index)=>{
    const surname=piece.length>1?piece[piece.length-1]:undefined
    return surname?`${first[index]} ${surname[0]}.`:first[index]!
  })
  const initialCounts=count(withInitial)
  return parts.map((piece,index)=>{
    if(firstCounts[first[index]!]===1)return first[index]!
    if(initialCounts[withInitial[index]!]===1)return withInitial[index]!
    return piece.join(' ')||first[index]!
  })
}

const uniqueIds=(rows:MilestoneRecord[],included:(row:MilestoneRecord)=>boolean=()=>true)=>new Set(rows.filter(included).map((row)=>row.job_candidate_id))

/** The funnel is a cohort, not a count of events. Every later milestone is constrained to the
 * candidate/job pairs submitted in the period, so reschedules and repeated offers cannot create
 * impossible conversions above 100%. */
export function buildRecruitmentFunnel(input:{submissions:MilestoneRecord[];interviews:MilestoneRecord[];offers:MilestoneRecord[];placements:MilestoneRecord[]}){
  const submitted=uniqueIds(input.submissions)
  const inCohort=(row:MilestoneRecord)=>submitted.has(row.job_candidate_id)
  const rows=[
    {name:'Submitted',value:submitted.size},
    {name:'Interview',value:uniqueIds(input.interviews,(row)=>inCohort(row)&&row.status!=='cancelled').size},
    {name:'Offer',value:uniqueIds(input.offers,(row)=>inCohort(row)&&row.status!=='draft').size},
    {name:'Placement',value:uniqueIds(input.placements,(row)=>inCohort(row)&&row.status!=='cancelled').size},
  ]
  return rows.map((row)=>({...row,conversion:submitted.size?Math.round(row.value/submitted.size*100):null}))
}

export function isOverdueTask(task:TaskRecord,now:Date){
  return task.deleted_at==null&&['open','in_progress'].includes(task.status)&&Boolean(task.due_at&&new Date(task.due_at)<now)
}

export const isRecordedPlacement=(placement:{status:string})=>placement.status!=='cancelled'
export const isCompletedPlacement=(placement:{status:string})=>placement.status==='completed'

const offsetAt=(instant:Date,timeZone:string)=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant)
  const part=(type:Intl.DateTimeFormatPartTypes)=>Number(parts.find((item)=>item.type===type)?.value)
  return Date.UTC(part('year'),part('month')-1,part('day'),part('hour'),part('minute'),part('second'))-instant.getTime()
}

const zonedMidnight=(date:string,timeZone:string)=>{
  const [year,month,day]=date.split('-').map(Number)
  const wall=Date.UTC(year!,month!-1,day!)
  let instant=new Date(wall-offsetAt(new Date(wall),timeZone))
  // A second pass handles the small set of zones whose offset changes near the first estimate.
  instant=new Date(wall-offsetAt(instant,timeZone))
  return instant
}

export function reportDateRange(from:string,to:string,timeZone:string){
  const start=zonedMidnight(from,timeZone)
  const [year,month,day]=to.split('-').map(Number)
  const nextDate=new Date(Date.UTC(year!,month!-1,day!+1)).toISOString().slice(0,10)
  const end=new Date(zonedMidnight(nextDate,timeZone).getTime()-1)
  return {fromIso:start.toISOString(),toIso:end.toISOString()}
}

/* Consultant attribution, shared by the team report and the personal scorecard.
 *
 * It lives here rather than inside ScorecardPage because the scorecard's whole promise is that a
 * consultant's own numbers reconcile with the ones their manager sees. Two implementations reading
 * the same records would drift the first time either was adjusted, and the plan's acceptance
 * criterion ("Personal totals reconcile with team reports") would then be false without anything
 * looking broken. One builder, two renderers. */
type AttributedMilestone={job_candidate_id:string;created_by:string;status?:string}
type PlacementRecord=AttributedMilestone&{status:string;currency:string;placement_fee:number|string}
type OwnedRecord={owner_member_id:string|null}

export interface ConsultantRow {id:string;name:string;jobs:number;submissions:number;interviews:number;offers:number;placements:number;fees:number;overdue:number}

export interface ConsultantInput {
  members:Array<{id:string;user_id:string;status:string;profiles?:{full_name?:string;email?:string}|null}>
  submissions:AttributedMilestone[];interviews:AttributedMilestone[];offers:AttributedMilestone[]
  placements:PlacementRecord[];activeJobs:Array<OwnedRecord>;overdueTasks:Array<OwnedRecord>
  baseCurrency?:string
}

const uniqueByCandidate=(rows:AttributedMilestone[],actor:string,include:(row:AttributedMilestone)=>boolean=()=>true)=>
  new Set(rows.filter((row)=>row.created_by===actor&&include(row)).map((row)=>row.job_candidate_id)).size

export function buildConsultantRows(input:ConsultantInput):ConsultantRow[]{
  const recordedPlacements=input.placements.filter(isRecordedPlacement)
  const actorIds=new Set([...input.submissions,...input.interviews,...input.offers,...input.placements].map((item)=>item.created_by))
  // A deactivated member who did the work still owns the work. Filtering to active members only is
  // how historical submissions used to fall off the report entirely.
  const members=input.members.filter((member)=>member.status==='active'||actorIds.has(member.user_id)||input.activeJobs.some((job)=>job.owner_member_id===member.id)||input.overdueTasks.some((task)=>task.owner_member_id===member.id))
  const metricsFor=(actor:string)=>{
    const placements=recordedPlacements.filter((item)=>item.created_by===actor)
    return {
      submissions:uniqueByCandidate(input.submissions,actor),
      interviews:uniqueByCandidate(input.interviews,actor,(item)=>item.status!=='cancelled'),
      offers:uniqueByCandidate(input.offers,actor,(item)=>item.status!=='draft'),
      placements:new Set(placements.map((item)=>item.job_candidate_id)).size,
      // Only fees already denominated in the base currency are summed; no exchange rate is invented.
      fees:placements.filter((item)=>item.currency===input.baseCurrency).reduce((sum,item)=>sum+Number(item.placement_fee),0),
    }
  }
  const rows=members.map((member)=>({
    id:member.id,name:member.profiles?.full_name||member.profiles?.email||'Unknown former user',
    jobs:input.activeJobs.filter((item)=>item.owner_member_id===member.id).length,
    ...metricsFor(member.user_id),
    overdue:input.overdueTasks.filter((item)=>item.owner_member_id===member.id).length,
  }))
  const knownActors=new Set(members.map((member)=>member.user_id))
  const unknownActors=[...actorIds].filter((id)=>!knownActors.has(id))
  if(unknownActors.length){
    const metrics=unknownActors.map(metricsFor)
    const total=(key:'submissions'|'interviews'|'offers'|'placements'|'fees')=>metrics.reduce((sum,item)=>sum+item[key],0)
    rows.push({id:'unknown-former-users',name:'Unknown former user',jobs:0,submissions:total('submissions'),interviews:total('interviews'),offers:total('offers'),placements:total('placements'),fees:total('fees'),overdue:0})
  }
  const unassignedOverdue=input.overdueTasks.filter((task)=>!task.owner_member_id).length
  if(unassignedOverdue)rows.push({id:'unassigned',name:'Unassigned',jobs:input.activeJobs.filter((job)=>!job.owner_member_id).length,submissions:0,interviews:0,offers:0,placements:0,fees:0,overdue:unassignedOverdue})
  return rows
}
