import {supabase} from '../../shared/lib/supabase'
import {AppError,humanizeRpcError} from '../../shared/lib/errors'
import type {Json} from '../../generated/database.types'

/* Data access for consent, transcript import and speaker mapping.
 *
 * Consent is written straight to the table: the RLS policy already requires the feature, the `use`
 * permission and recorded_by=auth.uid(), and the history is append-only because no UPDATE or DELETE
 * policy exists. Import goes through the Edge Function because it parses untrusted text and must not
 * do that in the browser. Mapping goes through an audited RPC.
 */

function fail(error:{message:string;code?:string}|null,fallback:string):never{
  const humanized=error?.message?humanizeRpcError(error.message):null
  if(humanized)throw new AppError(humanized.message,humanized.code,error)
  throw new AppError(fallback,error?.code||'transcript_error',error)
}

export type ConsentStatus='granted'|'declined'|'withdrawn'
export type ConsentMethod='spoken'|'written'|'other'
export type NoticeMethod='spoken'|'written'|'platform_notice'|'other'
export type SpeakerRole='consultant'|'candidate'|'client'|'other'|'unknown'

export interface TranscriptOverviewRow {
  transcriptId:string
  source:string
  status:string
  entryCount:number
  hasTimestamps:boolean
  completeness:string
  createdAt:string
  purgeDueAt:string
  supersededBy:string|null
  unmappedSpeakerCount:number
  speakerCount:number
}

export interface TranscriptSpeaker {
  id:string
  sourceSpeakerId:string
  displayName:string|null
  speakerRole:SpeakerRole
  memberId:string|null
  candidateId:string|null
  contactId:string|null
  confirmedAt:string|null
}

export async function getConsentStatus(interviewId:string):Promise<ConsentStatus|null>{
  const {data,error}=await supabase.rpc('interview_consent_status',{p_interview_id:interviewId})
  if(error)fail(error,'Could not check the transcription consent.')
  return (data as ConsentStatus|null)??null
}

/* Append-only by construction. Withdrawing is a new event rather than an edit, which is what lets an
 * audit answer "what was true when this was analysed" instead of only "what is true now".
 *
 * Through an RPC rather than a table insert, and deliberately WITHOUT a candidate id. The candidate
 * is a fact about the interview, not the caller's to assert -- supplying it made it possible to file
 * consent for one candidate against another candidate's interview. The RPC derives it, and checks
 * access to this specific interview rather than to the feature somewhere in the workspace.
 */
export async function recordConsent(input:{
  organizationId:string
  interviewId:string
  status:ConsentStatus
  consentMethod:ConsentMethod
  noticeMethod:NoticeMethod|null
  noticeVersion:string|null
  evidence:string|null
}){
  const {error}=await supabase.rpc('record_interview_consent',{
    p_organization_id:input.organizationId,
    p_interview_id:input.interviewId,
    p_status:input.status,
    p_consent_method:input.consentMethod,
    p_notice_method:input.noticeMethod??undefined,
    p_notice_version:input.noticeVersion??undefined,
    p_evidence:input.evidence??undefined,
  })
  if(error)fail(error,'Could not record the consent.')
}

export type WithdrawalOutcome='purged'|'legal_hold'|'already_purged'|'nothing_to_purge'

export interface WithdrawalResult {
  outcome:WithdrawalOutcome
  transcriptsPurged:number
  transcriptsOnLegalHold:number
  analysisRunsCancelled:number
}

/* Withdrawal is an operation, not a status change.
 *
 * One call appends the event, cancels queued analysis before it can reach a provider, and purges
 * every stored transcript with everything derived from it. The outcome is returned rather than
 * assumed, because a legal hold can legitimately prevent deletion and telling somebody their
 * recording is gone when it is not would be the worse failure.
 */
export async function withdrawConsent(organizationId:string,interviewId:string,evidence:string|null):Promise<WithdrawalResult>{
  const {data,error}=await supabase.rpc('withdraw_interview_consent',{
    p_organization_id:organizationId,
    p_interview_id:interviewId,
    p_evidence:evidence??undefined,
  })
  if(error)fail(error,'The consent could not be withdrawn.')
  const row=(data??{}) as Record<string,unknown>
  return {
    outcome:(row.outcome as WithdrawalOutcome)??'nothing_to_purge',
    transcriptsPurged:Number(row.transcripts_purged??0),
    transcriptsOnLegalHold:Number(row.transcripts_on_legal_hold??0),
    analysisRunsCancelled:Number(row.analysis_runs_cancelled??0),
  }
}

export async function listTranscripts(organizationId:string,interviewId:string):Promise<TranscriptOverviewRow[]>{
  const {data,error}=await supabase.rpc('get_interview_transcript_overview',{p_organization_id:organizationId,p_interview_id:interviewId})
  if(error)fail(error,'Could not load the interview transcripts.')
  return (data||[]).map((row)=>({
    transcriptId:row.transcript_id,
    source:row.source,
    status:row.status,
    entryCount:row.entry_count??0,
    hasTimestamps:Boolean(row.has_timestamps),
    completeness:row.completeness,
    createdAt:row.created_at,
    purgeDueAt:row.purge_due_at,
    supersededBy:row.superseded_by_transcript_id,
    unmappedSpeakerCount:row.unmapped_speaker_count??0,
    speakerCount:row.speaker_count??0,
  }))
}

export async function listTranscriptSpeakers(transcriptId:string):Promise<TranscriptSpeaker[]>{
  const {data,error}=await supabase.from('interview_transcript_speakers')
    .select('id,source_speaker_id,display_name,speaker_role,member_id,candidate_id,contact_id,confirmed_at')
    .eq('transcript_id',transcriptId).order('source_speaker_id')
  if(error)fail(error,'Could not load the transcript speakers.')
  return (data||[]).map((row)=>({
    id:row.id,
    sourceSpeakerId:row.source_speaker_id,
    displayName:row.display_name,
    speakerRole:row.speaker_role as SpeakerRole,
    memberId:row.member_id,
    candidateId:row.candidate_id,
    contactId:row.contact_id,
    confirmedAt:row.confirmed_at,
  }))
}

/* Parsing happens server-side. The browser never inspects the transcript beyond handing it over --
 * untrusted text is the Edge Function's problem, and doing it here would put a parser for four
 * formats into the client bundle for no benefit. */
export async function importTranscript(input:{organizationId:string;interviewId:string;text:string;fileName:string|null;supersedesTranscriptId:string|null}){
  const {data,error}=await supabase.functions.invoke('ingest-interview-transcript',{body:{
    organizationId:input.organizationId,
    interviewId:input.interviewId,
    text:input.text,
    fileName:input.fileName,
    supersedesTranscriptId:input.supersedesTranscriptId,
  }})
  if(error)throw new AppError(error.message,'function_error',error)
  const failure=(data as {error?:{message?:string;code?:string}})?.error
  if(failure)throw new AppError(failure.message||'Could not import the transcript.',failure.code||'function_error',data)
  return data as {transcriptId:string;duplicate:boolean;status:string;entryCount:number;format:string;hasTimestamps:boolean;completeness:string}
}

export interface SpeakerMapping {speaker_id:string;speaker_role:SpeakerRole;member_id?:string;candidate_id?:string;contact_id?:string}

export async function confirmSpeakers(organizationId:string,transcriptId:string,mappings:SpeakerMapping[]):Promise<number>{
  const {data,error}=await supabase.rpc('bulk_confirm_interview_transcript_speakers',{
    p_organization_id:organizationId,p_transcript_id:transcriptId,p_mappings:mappings as unknown as Json,
  })
  if(error)fail(error,'Could not save the speaker mapping.')
  return Number(data??0)
}

export interface TranscriptPageEntry {entryId:string;sequenceNumber:number;speakerLabel:string;speakerRole:string;startMs:number|null;endMs:number|null;content:string}

/* Bounded at 100 by the RPC itself, whatever is asked for here. */
export async function getTranscriptPage(organizationId:string,transcriptId:string,afterSequence:number|null,limit=50):Promise<TranscriptPageEntry[]>{
  const {data,error}=await supabase.rpc('get_interview_transcript_page',{
    p_organization_id:organizationId,p_transcript_id:transcriptId,p_after_sequence:afterSequence??undefined,p_limit:limit,
  })
  if(error)fail(error,'Could not load the transcript.')
  return (data||[]).map((row)=>({
    entryId:row.entry_id,
    sequenceNumber:row.sequence_number,
    speakerLabel:row.speaker_label,
    speakerRole:row.speaker_role,
    startMs:row.start_ms,
    endMs:row.end_ms,
    content:row.content,
  }))
}
