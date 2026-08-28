import type {Tone} from '../../shared/lib/status'
import type {ConsentStatus,TranscriptOverviewRow} from './transcriptRepository'

/* The one-line state a completed interview shows, and the action that follows from it.
 *
 * There is a real ordering here and it is not arbitrary: consent comes before everything because it
 * gates storage, not merely analysis. Showing "Add transcript" to somebody who has not recorded
 * consent invites them to paste a recording of a named person that the database will then refuse --
 * which teaches them the feature is broken rather than that they skipped a step.
 */

export type TranscriptLifecycleState=
  |'unavailable'
  |'consent_required'
  |'consent_declined'
  |'consent_withdrawn'
  |'transcript_required'
  |'mapping_required'
  |'ready'
  |'purged'

export interface TranscriptLifecycle {
  state:TranscriptLifecycleState
  label:string
  detail:string
  tone:Tone
  /* The single next action, or null when there is nothing the viewer can do. One action, because a
   * row offering three is a row nobody reads. */
  action:'record_consent'|'add_transcript'|'map_speakers'|'view'|null
}

export function transcriptLifecycle(input:{
  featureAvailable:boolean
  consent:ConsentStatus|null
  transcripts:TranscriptOverviewRow[]
}):TranscriptLifecycle{
  if(!input.featureAvailable){
    return {state:'unavailable',label:'',detail:'',tone:'neutral',action:null}
  }

  // Current bundle only: a superseded artifact is history, not a thing to act on.
  const current=input.transcripts.filter((row)=>!row.supersededBy&&row.status!=='purged')

  if(input.consent==='declined'){
    return {state:'consent_declined',label:'Consent declined',
      detail:'This interview cannot be transcribed or analysed.',tone:'neutral',action:null}
  }
  if(input.consent==='withdrawn'){
    return {state:'consent_withdrawn',label:'Consent withdrawn',
      detail:'Transcripts and anything derived from them are removed.',tone:'warn',action:null}
  }
  if(input.consent!=='granted'){
    return {state:'consent_required',label:'Consent required',
      detail:'Record the candidate’s consent before adding a transcript.',tone:'warn',action:'record_consent'}
  }

  if(current.length===0){
    return {state:'transcript_required',label:'Transcript needed',
      detail:'Paste or upload the interview transcript.',tone:'neutral',action:'add_transcript'}
  }

  const unmapped=current.reduce((total,row)=>total+row.unmappedSpeakerCount,0)
  if(unmapped>0){
    return {state:'mapping_required',label:'Speakers need mapping',
      detail:`${unmapped} ${unmapped===1?'speaker is':'speakers are'} still unidentified.`,tone:'warn',action:'map_speakers'}
  }

  const entries=current.reduce((total,row)=>total+row.entryCount,0)
  const timed=current.every((row)=>row.hasTimestamps)
  return {
    state:'ready',
    label:'Ready to analyse',
    /* Says plainly when the speaking share will be unavailable, at the point somebody could still do
     * something about it -- rather than in the analysis, where it reads as a defect. */
    detail:timed
      ?`${entries} lines across ${current.length} ${current.length===1?'transcript':'transcripts'}.`
      :`${entries} lines. No timestamps, so speaking share will be unavailable.`,
    tone:'good',
    action:'view',
  }
}

export function speakerRoleLabel(role:string){
  const labels:Record<string,string>={consultant:'Consultant',candidate:'Candidate',client:'Client',other:'Other',unknown:'Unknown'}
  return labels[role]??role
}

/* mm:ss, or a dash when the entry carried no timestamp. Never 00:00 for a missing one -- that is a
 * real position in the recording and would read as the interview's opening line. */
export function formatOffset(ms:number|null):string{
  if(ms===null||!Number.isFinite(ms))return '—'
  const total=Math.max(0,Math.round(ms/1000))
  return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`
}
