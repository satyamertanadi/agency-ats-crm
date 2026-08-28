import {FunctionError,requireUser} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {
  parseTranscript,
  sanitizeTranscriptFileName,
  TranscriptParseError,
  transcriptChecksum,
  normalizeTranscriptText,
} from '../_shared/interview-transcript-parsing.ts'

/* Manual transcript import.
 *
 * The whole endpoint is a funnel with one job: get untrusted text from a recruiter's clipboard into
 * the transcript tables without ever treating it as anything but text, and without storing a word of
 * it until consent is on record.
 *
 * It deliberately does NOT start an analysis. Import and analysis are separate acts because a
 * transcript arrives before its speakers are mapped, and analysing an unmapped transcript would
 * attribute everything anyone said to nobody in particular.
 *
 * Nothing here logs transcript content, speaker labels, or the filename's original form.
 */

interface Input {
  organizationId?:string
  interviewId?:string
  text?:string
  fileName?:string|null
  supersedesTranscriptId?:string|null
}

/* 5 MB, matching the plan. Measured on the decoded string rather than on the request body, because
 * the limit exists to bound what gets parsed and stored, not what crossed the wire. */
const MAX_TRANSCRIPT_BYTES=5*1024*1024

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const requestID=requestId(request)
  let organizationId:string|undefined

  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json().catch(()=>null) as Input|null
    if(!input?.organizationId||!input?.interviewId||typeof input.text!=='string'){
      throw new FunctionError(400,'invalid_request','Organization, interview and transcript text are required.')
    }
    organizationId=input.organizationId

    const context=await requireUser(request)
    const retentionDays=await requireImportAccess(context,input.organizationId)

    if(new TextEncoder().encode(input.text).length>MAX_TRANSCRIPT_BYTES){
      throw new FunctionError(413,'transcript_too_large','A transcript may be at most 5 MB.')
    }

    // Normalise once, then checksum the normalised text, so the same transcript pasted twice -- or
    // uploaded once and pasted once with different line endings -- collides on the duplicate check.
    const normalized=normalizeTranscriptText(input.text)
    const checksum=await transcriptChecksum(normalized)
    const fileName=sanitizeTranscriptFileName(input.fileName)
    const parsed=parseTranscript(input.text,fileName)

    const result=await context.admin.rpc('ingest_interview_transcript',{
      p_organization_id:input.organizationId,
      p_interview_id:input.interviewId,
      p_created_by:context.user.id,
      p_source:input.fileName?'manual_file':'manual_text',
      p_checksum:checksum,
      p_language_codes:parsed.languageCodes,
      p_has_timestamps:parsed.hasTimestamps,
      p_completeness:parsed.completeness,
      p_started_at:null,
      p_ended_at:null,
      p_duration_seconds:null,
      p_retention_days:retentionDays,
      p_supersedes_transcript_id:input.supersedesTranscriptId??null,
      p_speakers:parsed.speakers,
      p_entries:parsed.entries,
    })
    if(result.error)throw rpcFailure(result.error.message)

    const payload=result.data as {transcript_id:string;duplicate:boolean;status:string;entry_count?:number;speaker_count?:number}

    // Counts and identifiers only. No transcript text, no speaker labels, no filename.
    log('info','interview_transcript_ingested',{
      requestId:requestID,organizationId:input.organizationId,interviewId:input.interviewId,
      transcriptId:payload.transcript_id,duplicate:payload.duplicate,format:parsed.format,
      entryCount:payload.entry_count??parsed.entries.length,speakerCount:payload.speaker_count??parsed.speakers.length,
      hasTimestamps:parsed.hasTimestamps,completeness:parsed.completeness,
    })

    return json(request,{
      transcriptId:payload.transcript_id,
      duplicate:payload.duplicate,
      status:payload.status,
      format:parsed.format,
      entryCount:payload.entry_count??parsed.entries.length,
      speakers:parsed.speakers.map((speaker)=>({sourceSpeakerId:speaker.sourceSpeakerId,displayName:speaker.displayName})),
      hasTimestamps:parsed.hasTimestamps,
      completeness:parsed.completeness,
      requestId:requestID,
    })
  }catch(error){
    const failure=error instanceof FunctionError?error
      :error instanceof TranscriptParseError?new FunctionError(422,error.code,error.message)
      :new FunctionError(500,'unexpected_error','The transcript could not be imported.')
    log('error','interview_transcript_ingest_failed',{requestId:requestID,organizationId,code:failure.code,status:failure.status})
    return json(request,{error:{code:failure.code,message:failure.message,requestId:requestID}},failure.status)
  }
})

/* Both halves of the gate, plus the retention window the transcript will be stored under -- read here
 * so the caller cannot choose its own. */
async function requireImportAccess(context:Awaited<ReturnType<typeof requireUser>>,organizationId:string):Promise<number>{
  const [permitted,settings]=await Promise.all([
    context.caller.rpc('has_permission',{p_organization_id:organizationId,p_permission:'interview_intelligence.use'}),
    context.caller.from('organization_settings').select('interview_intelligence_enabled,transcript_retention_days').eq('organization_id',organizationId).maybeSingle(),
  ])
  if(permitted.error||!permitted.data)throw new FunctionError(403,'permission_denied','You do not have permission to import interview transcripts.')
  if(!settings.data?.interview_intelligence_enabled)throw new FunctionError(403,'feature_disabled','Interview Intelligence is not enabled for this workspace.')
  return Number(settings.data.transcript_retention_days)||90
}

/* The RPC raises product identifiers. Consent is the one worth its own status code -- it is a
 * precondition the caller can fix, not a malformed request. */
function rpcFailure(message:string):FunctionError{
  if(message.includes('transcript_consent_required'))return new FunctionError(409,'transcript_consent_required','Record the candidate consent before importing this transcript.')
  if(message.includes('interview_not_found'))return new FunctionError(404,'interview_not_found','That interview could not be found in this workspace.')
  if(message.includes('transcript_not_found'))return new FunctionError(404,'transcript_not_found','That transcript could not be found in this workspace.')
  if(message.includes('transcript_empty'))return new FunctionError(422,'transcript_empty','No transcript lines could be read from that file.')
  if(message.includes('transcript_speaker_mismatch'))return new FunctionError(422,'transcript_speaker_mismatch','That transcript could not be read cleanly.')
  return new FunctionError(500,'transcript_persistence_failed','The transcript could not be saved.')
}
