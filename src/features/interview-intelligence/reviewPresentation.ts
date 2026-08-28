import type {Tone} from '../../shared/lib/status'
import type {CoachingStatus,FeedbackType,TodayInterviewItem} from './reviewRepository'

/* Wording for the review layer.
 *
 * The one that matters is `disagreed`. It reads as "Disagreed" rather than anything suggesting the
 * finding was corrected or withdrawn, because it was not: both the finding and the disagreement are
 * kept, and a label like "Overruled" would claim an outcome the data does not have.
 */

const FEEDBACK_LABELS:Record<FeedbackType,string>={
  reviewed:'Reviewed',
  agreed:'Agreed',
  disagreed:'Disagreed',
  discussed:'Discussed',
  consultant_context:'Consultant context',
}

const COACHING_LABELS:Record<CoachingStatus,string>={
  open:'To acknowledge',
  acknowledged:'In progress',
  completed:'Complete',
  cancelled:'Cancelled',
}

export function feedbackLabel(value:FeedbackType){return FEEDBACK_LABELS[value]??value}
export function coachingStatusLabel(value:CoachingStatus){return COACHING_LABELS[value]??value}

/* Today rows. Each headline says the next action rather than the state, because Today is a worklist:
 * "Map the speakers" is actionable where "Transcript needs mapping" is a status somebody has to
 * translate. */
export function todayItemTone(kind:TodayInterviewItem['kind']):Tone{
  if(kind==='analysis_failed')return 'bad'
  if(kind==='attention_finding')return 'warn'
  if(kind==='consent_missing')return 'warn'
  return 'info'
}

export function todayItemLabel(kind:TodayInterviewItem['kind']):string{
  const labels:Record<TodayInterviewItem['kind'],string>={
    consent_missing:'Consent',
    mapping_required:'Speakers',
    analysis_failed:'Analysis',
    coaching_open:'Coaching',
    attention_finding:'Needs review',
  }
  return labels[kind]??kind
}

/* Splits one bounded result into the two lists the interface shows separately.
 *
 * The audience is decided by the database from the caller's permissions, so this only groups what
 * came back -- it never decides who may see what, and must not start to. */
export function splitTodayItems(items:TodayInterviewItem[]){
  return {
    mine:items.filter((item)=>item.audience==='consultant'),
    toReview:items.filter((item)=>item.audience==='reviewer'),
  }
}
