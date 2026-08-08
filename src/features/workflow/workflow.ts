import type {Interview,Job,JobCandidate,Offer,PipelinePhaseKey,PipelineStage,Task,TodayWorkKind} from '../../shared/types/domain'
// Wording stays in the status maps rather than being re-phrased here; "Wants to interview" has to read
// the same in a Today row as it does on the badge the consultant sees when they arrive.
import {feedbackDecision,lookup} from '../../shared/lib/status'

export type {PipelinePhaseKey,TodayWorkKind} from '../../shared/types/domain'
export type NextActionKey='add_candidates'|'submit'|'check_feedback'|'schedule_interview'|'record_outcome'|'record_offer'|'create_placement'|'resolve_delivery'|'complete_job'

export interface NextAction {key:NextActionKey;label:string;reason:string}
export interface TodayWorkItemGroup {label:string;href:string;cta:string;taskId?:string}
// `groupNoun` names what the disclosure is hiding ("6 jobs", "8 candidates"). The Today list used to
// hardcode "jobs" in that toggle because unowned jobs were the only thing that grouped; now that
// repeated tasks group too, the noun has to travel with the item.
export interface TodayWorkItem {id:string;kind:TodayWorkKind;title:string;reason:string;href:string;cta:string;dueAt?:string|null;taskId?:string;group?:TodayWorkItemGroup[];groupNoun?:string}

/* Flattened at the call site rather than taking the nested Supabase row shape. This module is pure and
 * tested, and threading `candidate_submissions.job_candidates.jobs.owner_member_id` through it would
 * make every test fixture a four-level object to express one string. */
export interface TodayFeedback {id:string;decision:string;createdAt:string;jobCandidateId:string;jobId:string|null;jobTitle:string|null;jobOwnerMemberId:string|null;candidateName:string|null}
export interface TodayConsent {candidateId:string;fullName:string;expiresAt:string;status:string;ownerMemberId:string|null}

export const pipelinePhases:Array<{key:PipelinePhaseKey;label:string}>=[
  {key:'sourcing',label:'Sourcing'},
  {key:'screening',label:'Screening'},
  {key:'shortlist',label:'Shortlist'},
  {key:'client_review',label:'Client review'},
  {key:'interview',label:'Interview'},
  {key:'offer',label:'Offer'},
  {key:'placed',label:'Placed'},
]

const keyPhase:Record<string,PipelinePhaseKey>={
  sourced:'sourcing',contacted:'sourcing',interested:'screening',screening:'screening',
  longlisted:'shortlist',shortlisted:'shortlist',assessment:'shortlist',reference_check:'shortlist',
  submitted_to_client:'client_review',client_reviewing:'client_review',
  interview_scheduled:'interview',interview_completed:'interview',offer:'offer',placed:'placed',
}

export function phaseForStage(stage:Pick<PipelineStage,'stage_key'|'stage_type'|'phase_key'>):PipelinePhaseKey{
  if(stage.phase_key)return stage.phase_key
  if(stage.stage_type==='placed')return 'placed'
  return keyPhase[stage.stage_key]??'other'
}

export function groupPipelineStages(stages:PipelineStage[]){
  return pipelinePhases.map((phase)=>({
    ...phase,
    stages:stages.filter((stage)=>phaseForStage(stage)===phase.key),
  })).filter((phase)=>phase.stages.length>0)
}

/* Stage types that are an outcome rather than a step: they end the candidate's run and so get a
 * counter, not a board column. */
export const outcomeStageTypes=['rejected','withdrawn','on_hold']
export const isOutcomeStage=(stage:Pick<PipelineStage,'stage_type'>)=>outcomeStageTypes.includes(stage.stage_type)

/* The board's column model. It lives here rather than in the page because the board had a bug that
 * only a shared model can prevent: the column a card was rendered in and the value its stage
 * dropdown displayed were derived separately, so they could disagree -- a candidate at
 * `interview_completed` rendered under Interview while the dropdown read "Sourcing". A <select> whose
 * value matches no <option> falls back to showing the first one, and in phase mode the options only
 * ever held each phase's FIRST stage id, so every candidate in a non-first stage rendered a lie.
 *
 * The fix is structural: a column is keyed by its own identity (phase key, or stage id when
 * detailed), never by a stage id standing in for a phase, and the card is handed the key of the
 * column it is rendered inside. Card and column cannot disagree because they are the same value. */
export interface PipelineColumn {key:string;label:string;stages:PipelineStage[]}

export function buildPipelineColumns(stages:PipelineStage[],detailed:boolean):PipelineColumn[]{
  const active=stages.filter((stage)=>!isOutcomeStage(stage))
  return detailed
    ?active.map((stage)=>({key:stage.id,label:stage.name,stages:[stage]}))
    :groupPipelineStages(active).map((phase)=>({key:phase.key,label:phase.label,stages:phase.stages}))
}

export const columnKeyForStage=(columns:PipelineColumn[],stageId:string):string|undefined=>
  columns.find((column)=>column.stages.some((stage)=>stage.id===stageId))?.key

/* Illustrative per-phase SLA targets (days) -- placeholder pending the actual numbers the team signs
 * off on (see "Open questions" in the pipeline-board redesign handoff). Centralised here so the board,
 * the candidate detail page, and Today's job-health chip share one source instead of drifting. */
export const slaTargetDays:Record<PipelinePhaseKey,number>={
  sourcing:7,screening:5,shortlist:5,client_review:7,interview:5,offer:3,placed:0,other:7,
}

/* The stage-ramp hue used for column bars, card left-borders, and Today's mini stage-distribution
 * bar -- one CSS custom property per phase so every place that draws "which phase is this" agrees. */
export const phaseRampColor:Record<PipelinePhaseKey,string>={
  sourcing:'var(--color-faint)',screening:'var(--color-info)',shortlist:'var(--color-accent)',
  client_review:'var(--color-violet)',interview:'var(--color-warning)',offer:'var(--color-danger)',
  placed:'var(--tone-good-fg)',other:'var(--color-faint)',
}

export type StageUrgency='neutral'|'warn'|'bad'

/* Same threshold rule everywhere a days-in-stage badge or a "stalled" count is derived, so the board,
 * the candidate panel, and Today's job-health chip can't disagree about what "stalled" means. */
export function stageUrgency(days:number,targetDays:number):StageUrgency{
  if(days<=targetDays)return 'neutral'
  if(days<=targetDays*1.5)return 'warn'
  return 'bad'
}

/* Same calculation CandidateDetailPage already uses for its "days in stage" column (the most recent
 * stage_history row, falling back to updated_at for candidates added before history existed) --
 * reused rather than duplicated so the two screens can't disagree about a candidate's own number. */
export function daysInStage(item:{updated_at:string;stage_history?:Array<{occurred_at:string}>},now:Date):number{
  const entered=item.stage_history?.[0]?.occurred_at||item.updated_at
  return Math.max(0,Math.floor((now.getTime()-new Date(entered).getTime())/86_400_000))
}

export interface ColumnStageStats{avgDays:number;overTarget:number;targetDays:number;onTarget:boolean}

/* Powers the column subheading ("avg 6d · 1 over target"). Detailed-mode columns are single-stage so
 * `column.stages[0]` IS the phase; grouped columns are built from stages that all share one phase
 * (groupPipelineStages), so the first stage's phase speaks for the whole column either way. */
export function columnStageStats(column:PipelineColumn,items:Array<{current_stage_id:string;updated_at:string;stage_history?:Array<{occurred_at:string}>}>,now:Date):ColumnStageStats|null{
  const firstStage=column.stages[0]
  if(!firstStage)return null
  const stageIds=new Set(column.stages.map((stage)=>stage.id))
  const inColumn=items.filter((item)=>stageIds.has(item.current_stage_id))
  if(inColumn.length===0)return null
  const targetDays=slaTargetDays[phaseForStage(firstStage)]??7
  const days=inColumn.map((item)=>daysInStage(item,now))
  const avgDays=Math.round(days.reduce((sum,value)=>sum+value,0)/days.length)
  const overTarget=days.filter((value)=>value>targetDays).length
  return {avgDays,overTarget,targetDays,onTarget:overTarget===0}
}

/* Resolves a drop/select onto a column into the stage to actually move to, or null for "no move".
 *
 * Returning null when the candidate already sits somewhere in the target column is what stops the
 * second half of the bug: moving to a phase used to send the candidate to that phase's first stage
 * unconditionally, so choosing "Interview" for someone at Interview Completed silently demoted them
 * back to Interview Scheduled. Entering a phase starts at its first stage; staying put is a no-op. */
export function resolveStageForColumn(columns:PipelineColumn[],columnKey:string,currentStageId:string):string|null{
  const column=columns.find((item)=>item.key===columnKey)
  if(!column)return null
  if(column.stages.some((stage)=>stage.id===currentStageId))return null
  return column.stages[0]?.id??null
}

export function recommendedCandidateAction(input:{stage:PipelineStage;hasSubmission:boolean;interviews:Interview[];offers:Offer[];hasPlacement:boolean}):NextAction{
  const {stage,hasSubmission,interviews,offers,hasPlacement}=input
  const phase=phaseForStage(stage)
  const activeInterview=interviews.find((item)=>item.status==='scheduled')
  const completedInterview=interviews.find((item)=>item.status==='completed')
  const offer=offers.find((item)=>!['declined','withdrawn'].includes(item.status))
  const closedOffer=offers.find((item)=>['declined','withdrawn'].includes(item.status))
  if(phase==='shortlist'&&!hasSubmission)return {key:'submit',label:'Submit to client',reason:'This candidate is shortlisted and ready for client review.'}
  if(phase==='client_review'&&!activeInterview)return {key:'check_feedback',label:'Check client feedback',reason:'The candidate is with the client and needs a follow-up.'}
  if(phase==='interview'&&!activeInterview&&!completedInterview)return {key:'schedule_interview',label:'Schedule interview',reason:'No interview has been scheduled for this candidate.'}
  if(phase==='offer'&&closedOffer&&!offer)return {key:'record_offer',label:'Record a new offer',reason:`The previous offer was ${closedOffer.status}. Record a new offer only when the candidate and client are ready.`}
  if(completedInterview&&!offer)return {key:'record_outcome',label:'Record outcome',reason:'The latest interview is complete and has no recorded outcome.'}
  if((phase==='offer'||completedInterview)&&!offer)return {key:'record_offer',label:'Record offer',reason:'The candidate has reached the offer milestone.'}
  if(offer?.status==='accepted'&&!hasPlacement)return {key:'create_placement',label:'Create placement',reason:'The offer is accepted and the placement is not yet recorded.'}
  return {key:'complete_job',label:'Review candidate',reason:`Currently in ${stage.name}.`}
}

const dayKey=(value:Date)=>`${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`

export function buildTodayWorkItems(input:{
  base:string;now:Date;currentMemberId?:string;tasks:Task[];interviews:Interview[];offers:Offer[];jobs:Job[]
  placements?:Array<{job_candidate_id:string;status?:string}>
  deliveryIssues?:Array<{id:string;status:string;email_type:string;related_entity_id:string|null;error_message:string|null;updated_at:string}>
  submissions?:Array<{id:string;job_id:string;title:string;public_submission_links:Array<{id:string;expires_at:string;revoked_at:string|null}>}>
  feedback?:TodayFeedback[]
  consentExpiring?:TodayConsent[]
}):TodayWorkItem[]{
  const {base,now,currentMemberId}=input
  const items:TodayWorkItem[]=[]
  const taskEntries:Array<{task:Task;kind:TodayWorkKind;href:string;who?:string;item:TodayWorkItem}>=[]
  for(const task of input.tasks){
    if(task.status==='completed'||task.status==='cancelled')continue
    if(currentMemberId&&task.owner_member_id&&task.owner_member_id!==currentMemberId)continue
    const link=task.task_links?.[0]
    const href=link?.job_id?`${base}/jobs/${link.job_id}`:link?.candidate_id?`${base}/candidates/${link.candidate_id}`:link?.company_id?`${base}/clients/${link.company_id}`:`${base}/today`
    const due=task.due_at?new Date(task.due_at):null
    const kind:TodayWorkKind=!due?'recommended':due<now?'overdue':dayKey(due)===dayKey(now)?'today':'upcoming'
    // The bold title must be whatever tells two rows apart at a glance, not whatever's the same
    // across all of them. A batch of follow-up tasks shares one task title ("Follow up on candidate
    // availability") but each is tied to a different candidate/job/company -- that name is the
    // differentiator, so it leads; the task's own title becomes the supporting line. Untethered
    // tasks have no name to lead with, so they fall back to the task's own title as before.
    const who=link?.jobs?.title||link?.candidates?.full_name||link?.companies?.name
    taskEntries.push({task,kind,href,who,item:{id:`task-${task.id}`,kind,title:who||task.title,reason:who?task.title:(task.description||'Owned follow-up'),href,cta:'Open',dueAt:task.due_at,taskId:task.id}})
  }
  /* Repeated tasks collapse the same way repeated unowned jobs already did. A batch of eight
   * "Follow up on candidate availability" tasks is one decision applied eight times, and rendering
   * it as eight full rows buries the two genuinely different actions underneath it -- which is the
   * failure mode the whole queue exists to prevent.
   *
   * Grouped by task title AND urgency: an overdue follow-up and an upcoming one are not the same
   * pile of work, and merging them would hide the overdue one behind a disclosure triangle. Only
   * linked tasks group, because the group list needs a record name to distinguish its rows -- eight
   * untethered tasks sharing a title have nothing to tell them apart once collapsed.
   *
   * A bucket of one renders exactly as before: no disclosure UI for a group of one. */
  const taskBuckets=new Map<string,typeof taskEntries>()
  for(const entry of taskEntries){
    const key=entry.who?`${entry.kind}::${entry.task.title}`:`solo-${entry.task.id}`
    const bucket=taskBuckets.get(key);if(bucket)bucket.push(entry);else taskBuckets.set(key,[entry])
  }
  for(const bucket of taskBuckets.values()){
    if(bucket.length===1){items.push(bucket[0]!.item);continue}
    const first=bucket[0]!
    // The group inherits the earliest due date in it so the collapsed row keeps the sort position of
    // its most urgent member rather than drifting down the queue.
    const dueAt=bucket.map((entry)=>entry.task.due_at).filter(Boolean).sort()[0]||null
    items.push({
      id:`task-group-${first.kind}-${first.task.id}`,kind:first.kind,
      title:`${first.task.title} · ${bucket.length} records`,
      reason:first.task.description||'The same follow-up is waiting on several records.',
      href:first.href,cta:'Open',dueAt,groupNoun:'records',
      group:bucket.map((entry)=>({label:entry.who||entry.task.title,href:entry.href,cta:'Open',taskId:entry.task.id})),
    })
  }
  for(const interview of input.interviews){
    const job=interview.job_candidates?.jobs
    if(interview.status==='cancelled')continue
    if(currentMemberId&&interview.organizer_member_id&&interview.organizer_member_id!==currentMemberId&&job?.owner_member_id!==currentMemberId)continue
    const failed=interview.calendar_sync_status==='failed'
    const starts=new Date(interview.starts_at)
    if(!failed&&starts<now)continue
    items.push({
      id:`interview-${interview.id}`,
      kind:failed?'blocked':dayKey(starts)===dayKey(now)?'today':'upcoming',
      title:failed?'Resolve Calendar sync':`Interview · ${interview.job_candidates?.candidates?.full_name||'Candidate'}`,
      reason:failed?interview.calendar_last_error||'Calendar synchronization failed.':`${job?.title||'Job'} · ${starts.toLocaleString()}`,
      href:job?.id?`${base}/jobs/${job.id}?candidate=${interview.job_candidate_id}&action=interview`:`${base}/today`,
      cta:failed?'Resolve':'Open',dueAt:interview.starts_at,
    })
  }
  const placedCandidates=new Set((input.placements||[]).filter((placement)=>placement.status!=='cancelled').map((placement)=>placement.job_candidate_id))
  const seenOfferCandidates=new Set<string>()
  for(const offer of input.offers){
    if(!['presented','accepted'].includes(offer.status))continue
    if(seenOfferCandidates.has(offer.job_candidate_id))continue
    seenOfferCandidates.add(offer.job_candidate_id)
    if(offer.status==='accepted'&&placedCandidates.has(offer.job_candidate_id))continue
    const job=offer.job_candidates?.jobs
    if(currentMemberId&&job?.owner_member_id&&job.owner_member_id!==currentMemberId)continue
    items.push({
      id:`offer-${offer.id}`,kind:'recommended',
      // Same fix as the task loop above: two accepted offers used to both read "Create placement" in
      // bold with the candidate buried underneath. The candidate+job pairing is what tells them apart.
      title:`${offer.job_candidates?.candidates?.full_name||'Candidate'} · ${job?.title||'Job'}`,
      reason:offer.status==='accepted'?'Offer accepted — ready to record the placement.':'Offer presented, awaiting the candidate’s decision.',
      href:job?.id?`${base}/jobs/${job.id}?candidate=${offer.job_candidate_id}&action=${offer.status==='accepted'?'placement':'offer'}`:`${base}/today`,
      cta:offer.status==='accepted'?'Create placement':'Open offer',
    })
  }
  // Unowned jobs used to push one item each, but the reason string is always the same literal
  // sentence -- six unowned jobs meant six back-to-back rows saying identically "This open job has
  // no accountable consultant." Collapse 2+ into one row with a job per entry in `group`; a single
  // unowned job still renders exactly as before (no disclosure UI for a group of one).
  // (The old scope check `currentMemberId&&job.owner_member_id&&...` was already always false here
  // -- job.owner_member_id is falsy for every job in this list -- so it's dropped, not weakened.)
  const unownedJobs=input.jobs.filter((job)=>job.status==='open'&&!job.owner_member_id)
  if(unownedJobs.length===1){
    const job=unownedJobs[0]!
    items.push({id:`job-owner-${job.id}`,kind:'blocked',title:`Assign an owner · ${job.title}`,reason:'This open job has no accountable consultant.',href:`${base}/jobs/${job.id}?view=details`,cta:'Complete setup'})
  }else if(unownedJobs.length>1){
    // href/cta here are never rendered (TodayPage shows the group list instead) -- set only because
    // TodayWorkItem requires them. Each grouped job's own href/cta is what's actually clickable.
    items.push({
      id:'job-owner-group',kind:'blocked',
      title:`Assign an owner · ${unownedJobs.length} jobs`,
      reason:'These open jobs have no accountable consultant.',
      href:`${base}/jobs/${unownedJobs[0]!.id}?view=details`,cta:'Complete setup',groupNoun:'jobs',
      group:unownedJobs.map((job)=>({label:job.title,href:`${base}/jobs/${job.id}?view=details`,cta:'Assign owner'})),
    })
  }
  const deliveryPackages=new Set<string>()
  for(const delivery of input.deliveryIssues||[]){
    const pack=input.submissions?.find((entry)=>entry.id===delivery.related_entity_id);if(pack)deliveryPackages.add(pack.id)
    items.push({id:`delivery-${delivery.id}`,kind:'blocked',title:`Resolve ${delivery.status} delivery`,reason:delivery.error_message||`A ${delivery.email_type.replaceAll('_',' ')} email could not be delivered.`,href:pack?`${base}/jobs/${pack.job_id}`:`${base}/today`,cta:'Resolve',dueAt:delivery.updated_at})
  }
  for(const pack of input.submissions||[]){
    if(deliveryPackages.has(pack.id))continue
    const expired=pack.public_submission_links?.find((link)=>!link.revoked_at&&new Date(link.expires_at)<now)
    // Same fix again: every expired link used to say "Renew expired submission link" in bold with
    // which package it was buried in the muted line -- swap so the package name leads.
    if(expired)items.push({id:`submission-expired-${expired.id}`,kind:'blocked',title:pack.title,reason:'The client review link for this submission has expired.',href:`${base}/jobs/${pack.job_id}`,cta:'Resolve',dueAt:expired.expires_at})
  }
  /* The one moment in the whole workflow where the client is waiting on the consultant, and the one
   * moment nothing told them: feedback was written to submission_feedback, rendered on that
   * candidate's panel, and announced nowhere else. A client approval could sit unread until someone
   * happened to open the right candidate.
   *
   * Filed under 'today' rather than 'recommended' because a client who has just answered is expecting
   * a reply now -- but never 'blocked', because nothing is stuck; the next move is simply the
   * consultant's. */
  for(const entry of input.feedback||[]){
    if(currentMemberId&&entry.jobOwnerMemberId&&entry.jobOwnerMemberId!==currentMemberId)continue
    items.push({
      id:`feedback-${entry.id}`,kind:'today',
      title:`${entry.candidateName||'Candidate'} · ${entry.jobTitle||'Job'}`,
      reason:`Client responded: ${lookup(feedbackDecision,entry.decision).label.toLowerCase()}.`,
      href:entry.jobId?`${base}/jobs/${entry.jobId}?candidate=${entry.jobCandidateId}`:`${base}/today`,
      cta:'Open feedback',dueAt:entry.createdAt,
    })
  }
  /* Consent expiry is a commercial deadline wearing an administrative costume: the day it lapses the
   * candidate cannot be submitted, so a shortlist assembled the evening before becomes unsendable.
   * Already-expired is 'blocked' because a submission genuinely is; approaching is a heads-up that
   * sorts by the date it actually falls due. */
  for(const entry of input.consentExpiring||[]){
    if(entry.status==='archived'||entry.status==='do_not_contact')continue
    if(currentMemberId&&entry.ownerMemberId&&entry.ownerMemberId!==currentMemberId)continue
    const days=Math.ceil((new Date(entry.expiresAt).getTime()-now.getTime())/86_400_000)
    items.push({
      id:`consent-${entry.candidateId}`,
      kind:days<=0?'blocked':days<=3?'today':'upcoming',
      title:entry.fullName,
      reason:days<=0?'Consent has expired — this candidate cannot be sent to a client until it is renewed.':`Consent expires in ${days} day${days===1?'':'s'}.`,
      href:`${base}/candidates/${entry.candidateId}`,cta:'Renew consent',dueAt:entry.expiresAt,
    })
  }
  const order:Record<TodayWorkKind,number>={blocked:0,overdue:1,today:2,upcoming:3,recommended:4}
  return items.sort((a,b)=>order[a.kind]-order[b.kind]||(a.dueAt||'9999').localeCompare(b.dueAt||'9999'))
}

export function jobNeedsCandidateAction(items:JobCandidate[]):NextAction|null{
  return items.length?null:{key:'add_candidates',label:'Add candidates',reason:'This job has no candidates yet.'}
}
