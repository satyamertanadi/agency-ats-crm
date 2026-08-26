import {isRecordedPlacement,metricDefinitions} from './reportMetrics'

/* Which KPI values can be opened, and exactly which records each one contains.
 *
 * The rule this module exists to enforce is narrower than "make the tiles clickable":
 *
 *   A NUMBER IS CLICKABLE ONLY IF ITS DRILLDOWN SHOWS EXACTLY THE RECORDS IT COUNTED.
 *
 * A tile reading 14 that opens a list of 12, or of 14 slightly different things, is worse than a tile
 * that does nothing -- it turns a number a consultant was willing to trust into one they now have to
 * check, and it does so on the screen whose whole purpose is being trusted. The usual way to get this
 * wrong is to point a KPI at an existing list page filtered by something similar: "jobs you own" at
 * the jobs list, "overdue tasks" at Today. Similar is not the same.
 *
 * So the id sets below are derived from the SAME loaded records and the SAME predicates that produced
 * the tile, in this file, next to each other -- not re-queried from the server with a filter that
 * approximates them.
 *
 * THE TWO SCOPES USE DIFFERENT DEFINITIONS, AND THAT IS NOT A BUG HERE.
 *
 * buildRecruitmentFunnel (team) constrains every later milestone to the cohort SUBMITTED in the
 * period, which is what stops a conversion rate exceeding 100%. buildConsultantRows (personal) does
 * not: a consultant's interview count includes interviews they ran this month for someone submitted
 * last month, because that is the work they did this month. Both are defensible and they are
 * genuinely different numbers, so each scope's selector mirrors the builder that produced its tile.
 * A single shared selector would silently be wrong for one of the two.
 */

type Milestone={job_candidate_id:string;created_by:string;status?:string|null}
type Placement=Milestone&{status:string}

export interface DrilldownInput {
  submissions:Milestone[]
  interviews:Milestone[]
  offers:Milestone[]
  placements:Placement[]
}

/** 'mine' restricts every set by `created_by`, which is how buildConsultantRows attributes the very
 *  numbers these open. Scoping by anything else -- job ownership, say -- would make the drilldown
 *  disagree with the tile it was opened from, on the same screen. */
export interface DrilldownContext {scope:'mine'|'team';userId?:string}

export interface DrilldownDefinition {
  /** The `?metric=` value. */
  id:string
  /** The drawer's title. */
  label:string
  /** The metric contract sentence for this scope, so the definition travels with the records. */
  definition:(context:DrilldownContext)=>string
  /** The exact job_candidate ids this number counted, from the records already on the page. */
  select:(input:DrilldownInput,context:DrilldownContext)=>string[]
}

const attributed=<Row extends Milestone>(rows:Row[],context:DrilldownContext)=>
  context.scope==='team'?rows:rows.filter((row)=>row.created_by===context.userId)

/* Unique by candidate-and-job, matching uniqueIds and uniqueByCandidate in reportMetrics. The same
 * candidate submitted to the same job twice in a period is one submission on the tile, so it has to
 * be one row here. */
const unique=(rows:Milestone[])=>[...new Set(rows.map((row)=>row.job_candidate_id))]

/* The team funnel's cohort. Applied in team scope only -- see the header. */
const cohortFilter=(input:DrilldownInput,context:DrilldownContext)=>{
  if(context.scope!=='team')return ()=>true
  const submitted=new Set(unique(input.submissions))
  return (row:Milestone)=>submitted.has(row.job_candidate_id)
}

export const drilldowns:readonly DrilldownDefinition[]=[
  {
    id:'submissions',label:'Candidates submitted',
    // The one metric both builders define identically, cohort or not: the cohort IS the submissions.
    definition:()=>metricDefinitions.submission,
    select:(input,context)=>unique(attributed(input.submissions,context)),
  },
  {
    id:'interviews',label:'Candidates interviewed',
    definition:(context)=>context.scope==='team'?metricDefinitions.interview:metricDefinitions.consultantInterview,
    select:(input,context)=>{
      const inCohort=cohortFilter(input,context)
      return unique(attributed(input.interviews,context).filter((row)=>inCohort(row)&&row.status!=='cancelled'))
    },
  },
  {
    id:'offers',label:'Candidates offered',
    definition:(context)=>context.scope==='team'?metricDefinitions.offer:metricDefinitions.consultantOffer,
    select:(input,context)=>{
      const inCohort=cohortFilter(input,context)
      return unique(attributed(input.offers,context).filter((row)=>inCohort(row)&&row.status!=='draft'))
    },
  },
  /* Recorded, never cohort-constrained, in BOTH scopes -- because that is what both tiles show. The
   * team tile says so in its caption; the personal tile said the opposite in its tooltip until this
   * change, which is the discrepancy that would have made its drilldown wrong. The cohort placement
   * figure still exists and still differs; it lives in the funnel, where it is labelled as such and
   * has no tile of its own to disagree with. */
  {
    id:'recordedPlacements',label:'Placements recorded in this period',
    definition:()=>metricDefinitions.recordedPlacement,
    select:(input,context)=>unique(attributed(input.placements,context).filter(isRecordedPlacement)),
  },
]

const byId=new Map(drilldowns.map((entry)=>[entry.id,entry]))

/** Narrows a raw `?metric=` to one we serve, so a hand-edited value opens nothing rather than an
 *  empty drawer claiming to be a metric. Same fail-closed shape as parseQueue and parseIssue. */
export const parseMetric=(raw:string|null|undefined):DrilldownDefinition|null=>byId.get((raw||'').trim())??null
