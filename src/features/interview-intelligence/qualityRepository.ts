import {supabase} from '../../shared/lib/supabase'
import {AppError,humanizeRpcError} from '../../shared/lib/errors'

/* Reading the interview-quality Scorecard.
 *
 * Two bounded aggregates, deliberately not folded into getAgencyPerformance. That function ships whole
 * record sets to the browser so the Performance view can count them client-side; findings and
 * conversation metrics are transcript-scale, and putting them through the same pipe would make every
 * Scorecard visit pay for rows the Performance tiles never read.
 *
 * Nothing here writes. There is no client path that edits an assessment, and no aggregate is
 * recomputed locally -- the numbers a manager and a consultant discuss in the same meeting come from
 * one place.
 */

function fail(error:{message:string;code?:string}|null,fallback:string):never{
  const humanized=error?.message?humanizeRpcError(error.message):null
  if(humanized)throw new AppError(humanized.message,humanized.code,error)
  throw new AppError(fallback,error?.code||'scorecard_error',error)
}

export type QualityScope='mine'|'team'
export const CONSULTANT_DIMENSIONS=['essential_coverage','question_quality','listening_balance','role_presentation','next_step_clarity'] as const
export type ConsultantDimension=typeof CONSULTANT_DIMENSIONS[number]

export interface BandCount {
  band:string
  interviews:number
  interviewIds:string[]
}

export interface DimensionTrend {
  dimension:string
  interviews:number
  /* Null whenever the sample is below the floor the RPC enforces. It is not "0" and not "no data" --
   * it is "not enough interviews to average yet", and the component must say that rather than print a
   * figure the database deliberately withheld. */
  averageScore:number|null
  attentionFindings:number
  attentionInterviewIds:string[]
  previousInterviews:number
  previousAverageScore:number|null
}

export interface ConversationTrend {
  measuredInterviews:number
  /* Interviews whose timestamps were too sparse to measure. Reported rather than hidden: "we could
   * not measure six of your nine" is itself the finding. */
  unmeasuredInterviews:number
  averageConsultantSharePercent:number|null
}

export interface CoachingTotals {
  open:number
  acknowledged:number
  completed:number
  overdue:number
}

export interface QualityScorecard {
  scope:QualityScope
  analysedInterviews:number
  previousAnalysedInterviews:number
  minimumSample:number
  drilldownCap:number
  interviewIds:string[]
  bands:BandCount[]
  dimensions:DimensionTrend[]
  conversation:ConversationTrend
  coaching:CoachingTotals
}

export interface TeamPatterns {
  analysedInterviews:number
  minimumSample:number
  drilldownCap:number
  coverage:{result:string;interviews:number;interviewIds:string[]}[]
  themes:{dimension:string;findings:number;interviews:number;interviewIds:string[]}[]
  attentionFindings:number
  attentionInterviewIds:string[]
  /* Rates arrive as their two components and are divided in the view, never here. A rate with no
   * denominator beside it reads the same whether it came from thirty transcripts or from two. */
  transcripts:{total:number;complete:number}
  runs:{total:number;failed:number}
}

const num=(value:unknown):number=>typeof value==='number'?value:Number(value??0)
const nullableNum=(value:unknown):number|null=>value===null||value===undefined?null:Number(value)
const ids=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[]

export async function getQualityScorecard(organizationId:string,fromIso:string,toIso:string,scope:QualityScope):Promise<QualityScorecard>{
  const {data,error}=await supabase.rpc('get_interview_quality_scorecard',{
    p_organization_id:organizationId,p_from:fromIso,p_to:toIso,p_scope:scope,
  })
  if(error)fail(error,'Could not load the interview quality scorecard.')
  const row=(data??{}) as Record<string,unknown>
  const conversation=(row.conversation??{}) as Record<string,unknown>
  const coaching=(row.coaching??{}) as Record<string,unknown>

  return {
    scope:(row.scope as QualityScope)??scope,
    analysedInterviews:num(row.analysed_interviews),
    previousAnalysedInterviews:num(row.previous_analysed_interviews),
    minimumSample:num(row.minimum_sample),
    drilldownCap:num(row.drilldown_cap),
    interviewIds:ids(row.interview_ids),
    bands:(Array.isArray(row.bands)?row.bands:[]).map((item)=>{
      const band=item as Record<string,unknown>
      return {band:String(band.band),interviews:num(band.interviews),interviewIds:ids(band.interview_ids)}
    }),
    dimensions:(Array.isArray(row.dimensions)?row.dimensions:[]).map((item)=>{
      const dimension=item as Record<string,unknown>
      return {
        dimension:String(dimension.dimension),
        interviews:num(dimension.interviews),
        averageScore:nullableNum(dimension.average_score),
        attentionFindings:num(dimension.attention_findings),
        attentionInterviewIds:ids(dimension.attention_interview_ids),
        previousInterviews:num(dimension.previous_interviews),
        previousAverageScore:nullableNum(dimension.previous_average_score),
      }
    }),
    conversation:{
      measuredInterviews:num(conversation.measured_interviews),
      unmeasuredInterviews:num(conversation.unmeasured_interviews),
      averageConsultantSharePercent:nullableNum(conversation.average_consultant_share_percent),
    },
    coaching:{
      open:num(coaching.open),acknowledged:num(coaching.acknowledged),
      completed:num(coaching.completed),overdue:num(coaching.overdue),
    },
  }
}

export async function getTeamPatterns(organizationId:string,fromIso:string,toIso:string):Promise<TeamPatterns>{
  const {data,error}=await supabase.rpc('get_interview_quality_team_patterns',{
    p_organization_id:organizationId,p_from:fromIso,p_to:toIso,
  })
  if(error)fail(error,'Could not load the team interview patterns.')
  const row=(data??{}) as Record<string,unknown>
  const transcripts=(row.transcripts??{}) as Record<string,unknown>
  const runs=(row.runs??{}) as Record<string,unknown>

  return {
    analysedInterviews:num(row.analysed_interviews),
    minimumSample:num(row.minimum_sample),
    drilldownCap:num(row.drilldown_cap),
    coverage:(Array.isArray(row.coverage)?row.coverage:[]).map((item)=>{
      const entry=item as Record<string,unknown>
      return {result:String(entry.result),interviews:num(entry.interviews),interviewIds:ids(entry.interview_ids)}
    }),
    themes:(Array.isArray(row.themes)?row.themes:[]).map((item)=>{
      const entry=item as Record<string,unknown>
      return {dimension:String(entry.dimension),findings:num(entry.findings),interviews:num(entry.interviews),interviewIds:ids(entry.interview_ids)}
    }),
    attentionFindings:num(row.attention_findings),
    attentionInterviewIds:ids(row.attention_interview_ids),
    transcripts:{total:num(transcripts.total),complete:num(transcripts.complete)},
    runs:{total:num(runs.total),failed:num(runs.failed)},
  }
}

export interface InterviewSummary {
  id:string
  startsAt:string|null
  stageLabel:string|null
  jobTitle:string|null
  candidateName:string|null
}

/* The interviews behind one Scorecard figure.
 *
 * Resolved a page at a time from the exact ids the aggregate returned, so the drilldown contains
 * precisely what the tile counted. Rows the reader may not see come back unresolved rather than
 * missing -- the same rule the commercial drilldown follows, and for the same reason: a list that
 * silently shrinks for the people with the narrowest permissions contradicts the number above it for
 * them alone, which is the hardest kind of discrepancy to notice.
 */
export async function listInterviewSummaries(organizationId:string,interviewIds:string[]):Promise<InterviewSummary[]>{
  if(interviewIds.length===0)return []
  const {data,error}=await supabase.from('interviews')
    .select('id,starts_at,stage_label,job_candidates(jobs(title),candidates(full_name))')
    .eq('organization_id',organizationId)
    .in('id',interviewIds)
  if(error)fail(error,'Could not load the interviews behind this number.')

  return (data||[]).map((row)=>{
    const link=row.job_candidates as {jobs?:{title?:string}|null;candidates?:{full_name?:string}|null}|null
    return {
      id:row.id,
      startsAt:row.starts_at,
      stageLabel:row.stage_label,
      jobTitle:link?.jobs?.title??null,
      candidateName:link?.candidates?.full_name??null,
    }
  })
}
