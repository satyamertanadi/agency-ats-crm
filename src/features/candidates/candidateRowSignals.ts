import {candidateAvailability} from '../../shared/lib/optionSets'
import type {CandidateSearchRow,CandidateStatus} from '../../shared/types/domain'

/* Turning the workflow columns into the words a row actually shows.
 *
 * Pure, and separate from CandidatesPage, for the reason candidateFilterChips is: the page has no
 * unit test of its own, so anything with a rule in it earns a module where the rule can be pinned
 * without rendering a table. Every branch below is a judgement about what a consultant should read,
 * not a formatting detail.
 *
 * The nulls these functions accept are not only "no data". search_candidates_page is security
 * invoker, so a member without jobs.read / tasks.read / activities.read gets nulls in the
 * corresponding columns. That is why nothing here ever says "none" or "never" -- it says "not
 * recorded" or shows an action, which is true whether the fact is absent or merely invisible. */

const DAY=86_400_000

/* Same arithmetic as workflow.ts daysInStage, which works off the board's job-candidate shape. Not
 * shared, because sharing it would mean faking that shape from a list row; the day the two disagree
 * it will be because someone changed one formula, so this comment is the link between them. */
const wholeDaysBetween=(fromIso:string,now:Date)=>Math.floor((now.getTime()-new Date(fromIso).getTime())/DAY)

/* Whole CALENDAR days between two instants, in the viewer's timezone.
 *
 * Due dates are counted this way rather than by elapsed milliseconds, because elapsed time makes the
 * label tick over at an arbitrary hour: a task due Monday 09:00 would read "1 day late" at 08:00 on
 * Tuesday and "2 days late" two hours later. Counting midnights means it changes when the date
 * changes, which is what "days late" means to the person reading it.
 *
 * This is a deliberate difference from latenessLabel in TodayPage, which ceils elapsed milliseconds
 * and so both drifts through the day and rounds 2.25 days up to "3 days late". The same task can
 * appear on both screens, so the two should be reconciled -- flagged rather than changed here,
 * because the dashboard is not this change's subject. */
const startOfLocalDay=(date:Date)=>new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime()
const calendarDaysBetween=(from:Date,to:Date)=>Math.round((startOfLocalDay(to)-startOfLocalDay(from))/DAY)

/** "today" / "yesterday" / "6d ago". Compact because it sits on a sub-line, in a dense table. */
export function shortAgo(iso:string,now:Date):string{
  const days=wholeDaysBetween(iso,now)
  if(days<=0)return 'today'
  if(days===1)return 'yesterday'
  return `${days}d ago`
}

export type DueState='overdue'|'today'|'future'|'none'

export interface FollowUpSignal{
  state:DueState
  taskTitle:string|null
  /** "2 days late", "Today", "in 5d" -- or null when nothing is scheduled. */
  dueLabel:string|null
  /** Always a sentence: the row must never render an empty cell here. */
  activityLabel:string
}

/* What is owed, and when we last touched them.
 *
 * The due state drives badge WEIGHT in the table, following the rule TodayPage established: solid
 * for overdue carrying its real lateness, an outline for today, and nothing at all for a future
 * date. A row with a follow-up booked for next Tuesday is not a problem and must not look like one. */
export function followUpSignal(row:Pick<CandidateSearchRow,'next_task_at'|'next_task_title'|'last_activity_at'>,now:Date):FollowUpSignal{
  const activityLabel=row.last_activity_at?`Last activity ${shortAgo(row.last_activity_at,now)}`:'No activity logged'
  if(!row.next_task_at)return {state:'none',taskTitle:null,dueLabel:null,activityLabel}

  const due=new Date(row.next_task_at)
  const taskTitle=row.next_task_title?.trim()||'Follow up'
  // Positive when the due date is in the past, in whole calendar days.
  // Local midnight, where the needs_follow_up queue uses the server's. They can disagree by hours for
  // a task due near midnight in a distant timezone; the server predicate is the authority for WHICH
  // rows appear, this only decides how the one in front of you is worded.
  const days=calendarDaysBetween(due,now)

  if(days>0)return {state:'overdue',taskTitle,dueLabel:`${days} day${days===1?'':'s'} late`,activityLabel}
  if(days===0)return {state:'today',taskTitle,dueLabel:'Today',activityLabel}
  return {state:'future',taskTitle,dueLabel:`in ${-days}d`,activityLabel}
}

export interface PipelineSignal{
  inPipeline:boolean
  jobTitle:string|null
  /** "+2 more" when they sit in several open jobs; the row shows one and counts the rest. */
  moreLabel:string|null
  /** "Interview · 12d". Null when the stage is unknown, which RLS can cause. */
  stageLabel:string|null
}

/* Candidate -> Job -> Stage, in one cell.
 *
 * open_job_count is the whole count and primary_* is the most recently updated open one, so "+N
 * more" is derived rather than guessed. inPipeline is keyed off the COUNT, not off the title: a
 * member without jobs.read gets count 0 and a null title, and both mean "nothing to show here". */
export function pipelineSignal(row:Pick<CandidateSearchRow,'open_job_count'|'primary_job_title'|'primary_stage_name'|'primary_stage_entered_at'>,now:Date):PipelineSignal{
  if(!row.open_job_count)return {inPipeline:false,jobTitle:null,moreLabel:null,stageLabel:null}
  const stage=row.primary_stage_name?.trim()
  const days=row.primary_stage_entered_at?Math.max(0,wholeDaysBetween(row.primary_stage_entered_at,now)):null
  return {
    inPipeline:true,
    jobTitle:row.primary_job_title?.trim()||'Untitled job',
    moreLabel:row.open_job_count>1?`+${row.open_job_count-1} more`:null,
    stageLabel:stage?(days===null?stage:`${stage} · ${days}d`):null,
  }
}

/* The three concepts candidates.status has always conflated, split by where they render rather than
 * by changing the column -- which would mean migrating the search filter, the add-to-job guard, the
 * badge maps, CSV export and every saved view together.
 *
 *   lifecycle  -- placed / do not contact / archived. A real outcome, and the two that gate actions.
 *                 Only these get a badge.
 *   posture    -- active / passive. Whether they are looking, not what has happened to them. Shown
 *                 quietly: badging it made every row a green "Active" chip that carried no signal.
 *   availability -- the notice period, from the column that has existed all along and was displayed
 *                 nowhere. This is the fact a consultant actually needs before promising a start date.
 */
const LIFECYCLE:ReadonlySet<CandidateStatus>=new Set<CandidateStatus>(['placed','do_not_contact','archived'])

export interface StatusFacets{
  lifecycle:CandidateStatus|null
  posture:'Active'|'Passive'|null
  availabilityLabel:string|null
}

export function statusFacets(row:Pick<CandidateSearchRow,'status'|'availability'>):StatusFacets{
  const lifecycle=LIFECYCLE.has(row.status)?row.status:null
  const posture=lifecycle?null:row.status==='active'?'Active':row.status==='passive'?'Passive':null
  const availabilityLabel=candidateAvailability.label(row.availability)||null
  return {lifecycle,posture,availabilityLabel}
}

/* The data-quality flags, as things to act on rather than blanks to scan past. Deliberately does NOT
 * include "no owner": that is its own column and its own queue, and repeating it here would make one
 * gap look like two. */
export function enrichmentGaps(row:Pick<CandidateSearchRow,'has_cv'|'skill_names'|'current_position'>):string[]{
  const gaps:string[]=[]
  if(!row.current_position?.trim())gaps.push('role')
  if(!row.skill_names.length)gaps.push('skills')
  if(!row.has_cv)gaps.push('CV')
  return gaps
}
