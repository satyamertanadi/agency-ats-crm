import type {DimensionTrend,QualityScorecard,TeamPatterns} from './qualityRepository'

/* Wording and the sample-size rules for the interview-quality Scorecard.
 *
 * The rules the plan sets are all of one kind: say what the number rests on, or do not say the
 * number. They live here rather than inline in the view so they can be tested without a browser, and
 * so a second surface reading the same aggregate cannot quietly apply a different floor.
 */

const DIMENSION_LABELS:Record<string,string>={
  essential_coverage:'Essential coverage',
  question_quality:'Question quality',
  listening_balance:'Listening balance',
  role_presentation:'Role presentation',
  next_step_clarity:'Next-step clarity',
}

/* Consultant bands. Note what is absent: no numeric grade, and no ordering claim in the wording
 * beyond what the band itself says. "Insufficient evidence" is not a low score -- it means the
 * interview did not produce enough to judge, which is a statement about the recording rather than
 * about the consultant. */
const BAND_LABELS:Record<string,string>={
  strong:'Strong',
  effective:'Effective',
  needs_development:'Needs development',
  needs_attention:'Needs attention',
  insufficient_evidence:'Insufficient evidence',
}

const COVERAGE_LABELS:Record<string,string>={
  strong:'Covered well',
  effective:'Covered',
  needs_development:'Partially covered',
  needs_attention:'Gaps',
  insufficient_evidence:'Could not tell',
  observation:'Observation',
}

export function dimensionLabel(value:string){return DIMENSION_LABELS[value]??value}
export function bandLabel(value:string){return BAND_LABELS[value]??value}
export function coverageLabel(value:string){return COVERAGE_LABELS[value]??value}

/* Why a figure is missing, in the words the reader needs.
 *
 * The database returns null for an average below the floor, and null is also what an empty period
 * returns. Those are different situations to the person reading: one is "keep going", the other is
 * "nothing here yet". Collapsing them into a dash makes the Scorecard look broken during exactly the
 * period when a new workspace is using it for the first time. */
export function sampleNote(interviews:number,minimumSample:number):string|null{
  if(interviews===0)return 'No analysed interviews yet in this period.'
  if(interviews<minimumSample)return `${interviews} of ${minimumSample} interviews needed before an average is shown.`
  return null
}

export type TrendDirection='improved'|'declined'|'steady'|'not_comparable'

export interface DimensionComparison {
  direction:TrendDirection
  /* The change, in score points, or null when the comparison cannot honestly be made. Never a
   * percentage: these are 0-4 rubric scores, and "up 12%" of a four-point scale is a number with no
   * meaning that reads as though it had one. */
  delta:number|null
  note:string
}

/* Comparison against the consultant's OWN previous period, which is the only comparison the plan
 * permits. Both sides must clear the floor independently -- a solid current period compared against a
 * single interview last month is not a trend, and showing it as one would be the most persuasive
 * wrong number on the page. */
export function compareDimension(trend:DimensionTrend,minimumSample:number):DimensionComparison{
  if(trend.averageScore===null||trend.previousAverageScore===null
    ||trend.interviews<minimumSample||trend.previousInterviews<minimumSample){
    return {
      direction:'not_comparable',
      delta:null,
      note:trend.previousInterviews===0
        ?'No interviews in the previous period to compare against.'
        :`Needs ${minimumSample} analysed interviews in both periods to compare.`,
    }
  }
  const delta=Number((trend.averageScore-trend.previousAverageScore).toFixed(2))
  /* A tenth of a point on a four-point scale, across a handful of interviews, is noise. Calling it
   * "improved" invites a consultant to change what they are doing in response to nothing. */
  if(Math.abs(delta)<0.25){
    return {direction:'steady',delta,note:`Steady against your previous ${trend.previousInterviews} interviews.`}
  }
  return {
    direction:delta>0?'improved':'declined',
    delta,
    note:`${delta>0?'Up':'Down'} ${Math.abs(delta).toFixed(2)} against your previous ${trend.previousInterviews} interviews.`,
  }
}

/* Speaking share, described without an ideal.
 *
 * There is no correct talk/listen ratio -- it depends on the role, the stage and the candidate -- so
 * this returns the consultant's own figure and the size of the sample behind it, and says nothing
 * about whether it is good. A target here would be invented precision presented as a standard.
 */
export function speakingShareNote(scorecard:QualityScorecard):string{
  const {measuredInterviews,unmeasuredInterviews,averageConsultantSharePercent}=scorecard.conversation
  if(averageConsultantSharePercent===null){
    const note=sampleNote(measuredInterviews,scorecard.minimumSample)
    return note??'Not enough measurable interviews to show a share yet.'
  }
  const base=`You spoke for ${averageConsultantSharePercent}% of measured speaking time across ${measuredInterviews} interviews.`
  return unmeasuredInterviews>0
    ? `${base} ${unmeasuredInterviews} more could not be measured reliably.`
    : base
}

/* A rate, divided only where both halves are in view, and refused entirely at zero.
 *
 * "0%" and "no transcripts at all" render identically once the division has happened, and the second
 * is a pipeline problem rather than a quality one. */
export function ratePercent(part:number,total:number):number|null{
  if(!total)return null
  return Math.round(part/total*100)
}

export function processingNotes(patterns:TeamPatterns):{label:string;value:string;caption:string}[]{
  const completion=ratePercent(patterns.transcripts.complete,patterns.transcripts.total)
  const failure=ratePercent(patterns.runs.failed,patterns.runs.total)
  return [
    {
      label:'Complete transcripts',
      value:completion===null?'—':`${completion}%`,
      caption:patterns.transcripts.total
        ?`${patterns.transcripts.complete} of ${patterns.transcripts.total} transcripts`
        :'No transcripts in this period',
    },
    {
      label:'Failed analyses',
      value:failure===null?'—':`${failure}%`,
      caption:patterns.runs.total
        ?`${patterns.runs.failed} of ${patterns.runs.total} runs`
        :'No analysis runs in this period',
    },
  ]
}

/* Team themes, ordered by how many interviews they appear in.
 *
 * Ordering themes is safe in a way that ordering people is not: a theme is a training topic, and the
 * aggregate carries no member identifier at all, so there is nothing here that could be re-sorted
 * into a ranking of consultants even by a future caller that wanted to.
 */
export function orderedThemes(patterns:TeamPatterns){
  return patterns.themes.slice().sort((left,right)=>
    right.interviews-left.interviews||right.findings-left.findings||left.dimension.localeCompare(right.dimension))
}

/* Whether the drilldown behind a tile is showing everything it counted. The cap is generous, but a
 * list that silently stops short of the number printed above it is the one thing a drilldown must
 * never do. */
export function drilldownTruncated(count:number,shown:number,cap:number):boolean{
  return count>shown&&shown>=cap
}
