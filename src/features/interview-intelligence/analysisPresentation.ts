import type {Tone} from '../../shared/lib/status'
import type {AnalysisFinding,MetricSummary,SpeakerMetric} from './analysisRepository'

/* How an analysis is said out loud.
 *
 * Two rules run through all of it. There are no percentages of fit and no scores presented to a user
 * -- the 0-4 dimension scale is internal, and a "83% match" would imply a precision the evidence
 * cannot support. And a missing speaking share is reported as Unavailable, never as 0%: a transcript
 * without timestamps has no ratio, and inventing one would be the most quietly convincing lie the
 * product could tell.
 */

const CANDIDATE_BANDS:Record<string,{label:string;tone:Tone}>={
  strong_evidence_of_fit:{label:'Strong evidence of fit',tone:'good'},
  promising_but_incomplete:{label:'Promising, but incomplete',tone:'info'},
  material_concerns:{label:'Material concerns',tone:'warn'},
  clear_mismatch:{label:'Clear mismatch',tone:'bad'},
  insufficient_evidence:{label:'Insufficient evidence',tone:'neutral'},
}

const CONSULTANT_BANDS:Record<string,{label:string;tone:Tone}>={
  strong:{label:'Strong',tone:'good'},
  effective:{label:'Effective',tone:'good'},
  needs_development:{label:'Needs development',tone:'warn'},
  needs_attention:{label:'Needs attention',tone:'bad'},
  insufficient_evidence:{label:'Insufficient evidence',tone:'neutral'},
}

const RESULTS:Record<string,{label:string;tone:Tone}>={
  met:{label:'Met',tone:'good'},
  partially_met:{label:'Partially met',tone:'info'},
  /* Deliberately worded as a statement about the INTERVIEW, not the candidate. "Not evidenced" alone
   * reads to a hurried consultant as a mark against the person; the whole invariant is that nobody
   * asked. */
  not_evidenced:{label:'Not asked about',tone:'neutral'},
  contradicted:{label:'Contradicted',tone:'bad'},
  not_applicable:{label:'Not applicable',tone:'neutral'},
  observation:{label:'Observation',tone:'neutral'},
  strong:{label:'Strong',tone:'good'},
  effective:{label:'Effective',tone:'good'},
  needs_development:{label:'Needs development',tone:'warn'},
  needs_attention:{label:'Needs attention',tone:'bad'},
  insufficient_evidence:{label:'Insufficient evidence',tone:'neutral'},
}

const DIMENSIONS:Record<string,string>={
  essential_coverage:'Essential coverage',
  question_quality:'Question quality',
  listening_balance:'Listening balance',
  role_presentation:'Role presentation',
  next_step_clarity:'Next-step clarity',
}

export function candidateBand(value:string){return CANDIDATE_BANDS[value]??{label:value,tone:'neutral' as Tone}}
export function consultantBand(value:string){return CONSULTANT_BANDS[value]??{label:value,tone:'neutral' as Tone}}
export function resultLabel(value:string){return RESULTS[value]??{label:value,tone:'neutral' as Tone}}
export function dimensionLabel(value:string){return DIMENSIONS[value]??value}

export function confidenceLabel(value:string){
  return value==='high'?'High confidence':value==='medium'?'Medium confidence':'Low confidence'
}

/* Speaking share, as a percentage or as nothing at all.
 *
 * This is the only place a share is computed for display -- the worker stores durations and never a
 * percentage, precisely so two surfaces cannot disagree about the denominator. Returns null when
 * there is no measured speech, which the interface must render as "Unavailable".
 *
 * The denominator is summed participant speech, including unknown speakers: their time stays visible
 * as its own share rather than being redistributed across the people who were identified.
 */
export function speakingShares(speakers:SpeakerMetric[]):Map<string,number|null>{
  const total=speakers.reduce((sum,speaker)=>sum+speaker.speechMs,0)
  const shares=new Map<string,number|null>()
  for(const speaker of speakers)shares.set(speaker.speakerId,total>0?speaker.speechMs/total:null)
  return shares
}

export function formatShare(share:number|null):string{
  return share===null?'Unavailable':`${Math.round(share*100)}%`
}

export function formatDuration(ms:number|null):string{
  if(ms===null||!Number.isFinite(ms))return '—'
  const total=Math.round(ms/1000)
  if(total<60)return `${total}s`
  return `${Math.floor(total/60)}m ${String(total%60).padStart(2,'0')}s`
}

/* Whether the talk/listen figures should be shown at all.
 *
 * Partial timestamp coverage produces numbers that look exact and are not. Below the threshold the
 * interface says why they are missing rather than showing a ratio nobody should act on. */
export function metricsAreUsable(summary:MetricSummary|null):boolean{
  return Boolean(summary&&summary.timestampCoverage>0&&summary.metricConfidence!=='low')
}

export function metricsUnavailableReason(summary:MetricSummary|null):string{
  if(!summary||summary.timestampCoverage===0){
    return 'This transcript has no timestamps, so speaking share cannot be calculated.'
  }
  if(summary.metricConfidence==='low'){
    return 'Too little of this transcript is timed, or too much speech is unattributed, for a reliable speaking share.'
  }
  return ''
}

/* Groups the candidate findings the way the drawer reads them. The requirement rows are the table;
 * the rest are the short lists beside it. */
export function groupCandidateFindings(findings:AnalysisFinding[]){
  return {
    requirements:findings.filter((finding)=>finding.category==='requirement'),
    strongestEvidence:findings.filter((finding)=>finding.category==='strongest_evidence'),
    missingInformation:findings.filter((finding)=>finding.category==='missing_information'),
    contradictions:findings.filter((finding)=>finding.category==='contradiction'),
    verification:findings.filter((finding)=>finding.category==='recommended_verification'),
  }
}

/* A run's headline state, in the words the consultant needs. */
export function analysisStatusLine(input:{status:string|null;isStale:boolean;errorCode:string|null}):{label:string;tone:Tone;detail:string}{
  if(input.status==='queued')return {label:'Queued',tone:'neutral',detail:'The analysis is waiting to start.'}
  if(input.status==='processing')return {label:'Analysing',tone:'info',detail:'This usually takes under a minute.'}
  if(input.status==='failed'){
    return {label:'Analysis failed',tone:'bad',
      detail:input.errorCode==='prohibited_inference'
        ? 'The result was rejected because it referenced something this system must not assess. Nothing was stored.'
        : 'Nothing was stored. You can try again.'}
  }
  if(input.status==='completed'&&input.isStale){
    return {label:'May be outdated',tone:'warn',
      // Says explicitly that the shown analysis is the old one. Nothing re-runs on its own.
      detail:'The interview or the job has changed since this ran. This is still the previous result — request a new analysis to update it.'}
  }
  if(input.status==='completed')return {label:'Complete',tone:'good',detail:''}
  return {label:'Not analysed',tone:'neutral',detail:'Request an analysis once the transcript and speakers are ready.'}
}
