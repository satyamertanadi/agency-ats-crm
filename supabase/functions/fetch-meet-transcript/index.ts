import {FunctionError,serviceClient} from '../_shared/auth.ts'
import {decryptSecret} from '../_shared/crypto.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {isAuthorized} from '../scheduled-maintenance/authorization.ts'
import {transcriptChecksum} from '../_shared/interview-transcript-parsing.ts'
import {meetingCodeFrom,rebaseSession} from '../_shared/meet-transcript.ts'

/* Fetches a Google Meet transcript and feeds it into the Release A0 pipeline.
 *
 * The important structural decision: this function does NOT have its own storage path. It builds the
 * same speakers-and-entries payload a pasted transcript produces and hands it to
 * ingest_interview_transcript, which re-checks consent before writing a single row. Two ingestion
 * paths would be two places for that check to drift, and the one that drifts is the one that stores a
 * recording nobody agreed to.
 *
 * The retrieval identity is the interview's ORGANISER, always. Trying another attendee's Google token
 * because theirs happens to work is precisely the broadening the plan forbids.
 */

const MEET_API='https://meet.googleapis.com/v2'
const MEET_SCOPE='https://www.googleapis.com/auth/meetings.space.readonly'
const PAGE_SIZE=100
const MAX_ENTRIES=6000
const MAX_JOBS_PER_INVOCATION=3

type Admin=ReturnType<typeof serviceClient>

interface MeetEntry {
  participant?:string
  text?:string
  languageCode?:string
  startTime?:string
  endTime?:string
}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const requestID=requestId(request)
  try{
    authorize(request)
    const admin=serviceClient()
    let processed=0

    for(let index=0;index<MAX_JOBS_PER_INVOCATION;index+=1){
      const claim=await admin.rpc('claim_background_job',{p_job_type:'meet_transcript_fetch',p_locked_by:`meet:${requestID}`})
      if(claim.error)throw new FunctionError(500,'claim_failed',claim.error.message)
      const job=(claim.data as {id:string;payload:{interview_id?:string}}[]|null)?.[0]
      if(!job)break

      const interviewId=job.payload?.interview_id
      if(!interviewId){
        await admin.rpc('release_background_job',{p_job_id:job.id,p_outcome:'failed',p_error:'missing interview_id'})
        continue
      }

      try{
        const outcome=await fetchOne(admin,interviewId,requestID)
        /* A transcript that does not exist yet is not a failure. The job completes, the attempt
         * counter advances, and discovery re-queues it later -- retrying a "not ready" as an error
         * would burn the retry budget on the normal case. */
        await admin.rpc('release_background_job',{p_job_id:job.id,p_outcome:'completed',p_error:null})
        log('info','meet_transcript_fetch',{requestId:requestID,interviewId,outcome:outcome.outcome,entryCount:outcome.entryCount??0})
        processed+=1
      }catch(error){
        const failure=describe(error)
        await admin.rpc('record_meet_fetch_attempt',{p_interview_id:interviewId,p_conference_record:null,p_error:failure.code})
        const released=await admin.rpc('release_background_job',{p_job_id:job.id,p_outcome:'failed',p_error:failure.code})
        log('error','meet_transcript_fetch_failed',{requestId:requestID,interviewId,code:failure.code,jobOutcome:released.data})
      }
    }

    return json(request,{processed,requestId:requestID})
  }catch(error){
    const failure=error instanceof FunctionError?error:new FunctionError(500,'unexpected_error','The Meet transcript worker failed.')
    log('error','meet_transcript_worker_failed',{requestId:requestID,code:failure.code,status:failure.status})
    return json(request,{error:{code:failure.code,message:failure.message,requestId:requestID}},failure.status)
  }
})

function authorize(request:Request){
  const ok=isAuthorized(request.headers,{
    workerSecret:Deno.env.get('WORKER_SECRET')??null,
    serviceRoleKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??null,
  })
  if(!ok)throw new FunctionError(401,'worker_authentication_required','Worker authentication required.')
}

async function fetchOne(admin:Admin,interviewId:string,requestID:string){
  const interview=await admin.from('interviews')
    .select('id,organization_id,organizer_member_id,meeting_url,status,ends_at,google_meet_conference_record_name')
    .eq('id',interviewId).maybeSingle()
  if(interview.error||!interview.data)throw new FunctionError(404,'interview_not_found','That interview no longer exists.')
  const row=interview.data as Record<string,string|null>

  // A rescheduled or cancelled interview stops being a fetch target the moment its status changes.
  if(row.status!=='completed')return {outcome:'not_completed' as const}

  const meetingCode=meetingCodeFrom(row.meeting_url)
  if(!meetingCode)throw new FunctionError(422,'meet_link_unreadable','This interview has no readable Meet link.')

  const token=await organiserToken(admin,String(row.organization_id),row.organizer_member_id)

  const conferenceRecord=row.google_meet_conference_record_name
    ?? await resolveConferenceRecord(token,meetingCode)
  if(!conferenceRecord){
    // Ended meetings get a record; if there is none yet, Google has not finished settling it.
    await admin.rpc('record_meet_fetch_attempt',{p_interview_id:interviewId,p_conference_record:null,p_error:'conference_record_pending'})
    return {outcome:'conference_record_pending' as const}
  }

  const transcripts=await listTranscripts(token,conferenceRecord)
  if(transcripts.length===0){
    /* Recording a transcript is a per-meeting choice. Nobody turning it on is the single most common
     * outcome here, and it must read as "none" rather than as a fault. */
    await admin.rpc('record_meet_fetch_attempt',{p_interview_id:interviewId,p_conference_record:conferenceRecord,p_error:'no_transcript'})
    return {outcome:'no_transcript' as const}
  }

  /* Several transcripts genuinely happen: a call that drops and resumes produces one per session.
   * They are concatenated into a single artifact in start order rather than imported as rivals,
   * because they are one conversation and the analysis reads a bundle. */
  const collected:{sourceSpeakerId:string;displayName:string|null;startMs:number|null;endMs:number|null;text:string}[]=[]
  /* Google returns absolute RFC3339 timestamps; the pipeline stores offsets from the start of the
   * artifact. Each session is rebased on its own first entry, then pushed past the previous session
   * so a call that dropped and resumed reads as one timeline rather than two overlapping ones. */
  let sessionOffset=0
  for(const transcript of transcripts){
    const entries=await listEntries(token,transcript.name)
    const {rebased,nextOffset}=rebaseSession(entries,sessionOffset)
    entries.forEach((entry,index)=>{
      collected.push({
        // The participant resource name is a stable per-conference identifier, which is exactly what
        // the mapping step needs: a label a human can attach a person to.
        sourceSpeakerId:entry.participant??'unknown',
        displayName:null,
        startMs:rebased[index].startMs,
        endMs:rebased[index].endMs,
        text:(entry.text??'').trim(),
      })
    })
    sessionOffset=nextOffset
    if(collected.length>=MAX_ENTRIES)break
  }

  const usable=collected.filter((entry)=>entry.text.length>0)
  if(usable.length===0){
    await admin.rpc('record_meet_fetch_attempt',{p_interview_id:interviewId,p_conference_record:conferenceRecord,p_error:'transcript_empty'})
    return {outcome:'transcript_empty' as const}
  }

  const speakers=[...new Set(usable.map((entry)=>entry.sourceSpeakerId))]
    .map((sourceSpeakerId)=>({sourceSpeakerId,displayName:null}))

  // Content-addressed over what was actually retrieved, so a re-fetch of the same conference
  // deduplicates against the import that already happened.
  const checksum=await transcriptChecksum(usable.map((entry)=>`${entry.sourceSpeakerId}:${entry.text}`).join('\n'))

  const retention=await admin.from('organization_settings')
    .select('transcript_retention_days').eq('organization_id',row.organization_id).maybeSingle()

  const ingested=await admin.rpc('ingest_interview_transcript',{
    p_organization_id:row.organization_id,
    p_interview_id:interviewId,
    p_created_by:null,
    p_source:'google_meet',
    p_checksum:checksum,
    p_language_codes:[],
    p_has_timestamps:usable.some((entry)=>entry.startMs!==null),
    p_completeness:'complete',
    p_started_at:null,
    p_ended_at:null,
    p_duration_seconds:null,
    p_retention_days:Number(retention.data?.transcript_retention_days)||90,
    p_supersedes_transcript_id:null,
    p_speakers:speakers,
    p_entries:usable,
  })
  if(ingested.error){
    /* Consent is the expected refusal here, not an exception. Google produced a transcript; nobody
     * recorded the candidate agreeing to it being analysed, so it is not stored. */
    if(ingested.error.message.includes('transcript_consent_required')){
      await admin.rpc('record_meet_fetch_attempt',{p_interview_id:interviewId,p_conference_record:conferenceRecord,p_error:'consent_required'})
      return {outcome:'consent_required' as const}
    }
    throw new FunctionError(500,'transcript_persistence_failed',ingested.error.message)
  }

  await admin.rpc('record_meet_fetch_attempt',{p_interview_id:interviewId,p_conference_record:conferenceRecord,p_error:null})

  // Arrives needing mapping, so this normally declines. It is called anyway so a workspace that has
  // pre-mapped nothing still gets the analysis the moment mapping completes elsewhere.
  const queued=await admin.rpc('maybe_queue_automatic_analysis',{p_interview_id:interviewId})
  log('info','meet_transcript_imported',{
    requestId:requestID,interviewId,entryCount:usable.length,speakerCount:speakers.length,
    sessions:transcripts.length,autoAnalysis:(queued.data as {reason?:string}|null)?.reason??'queued',
  })

  return {outcome:'imported' as const,entryCount:usable.length}
}

/* The organiser's connection, and only theirs. */
async function organiserToken(admin:Admin,organizationId:string,memberId:string|null){
  if(!memberId)throw new FunctionError(409,'organiser_not_connected','This interview has no organiser with Google connected.')

  const connection=await admin.from('google_calendar_connections')
    .select('id,token_secret_id,status,scopes')
    .eq('organization_id',organizationId).eq('member_id',memberId).maybeSingle()
  if(connection.error||!connection.data)throw new FunctionError(409,'organiser_not_connected','The interview organiser has not connected Google.')

  const scopes=(connection.data.scopes as string[]|null)??[]
  if(!scopes.includes(MEET_SCOPE))throw new FunctionError(409,'meet_scope_required','The organiser has not granted Meet transcript access.')

  const secret=await admin.from('google_calendar_secrets')
    .select('encrypted_refresh_token').eq('id',connection.data.token_secret_id).maybeSingle()
  if(secret.error||!secret.data)throw new FunctionError(500,'google_secret_unavailable','The stored Google credential could not be read.')

  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:Deno.env.get('GOOGLE_CLIENT_ID')||'',
      client_secret:Deno.env.get('GOOGLE_CLIENT_SECRET')||'',
      refresh_token:await decryptSecret(String(secret.data.encrypted_refresh_token)),
      grant_type:'refresh_token',
    }),
  })
  const token=await response.json().catch(()=>null) as {access_token?:string}|null
  if(!response.ok||!token?.access_token){
    // Surfaced on the connection so the organiser sees "reconnect" in Admin rather than a silent stall.
    await admin.from('google_calendar_connections').update({
      status:'reauthorization_required',
      last_error:'Google authorization expired.',
      last_error_at:new Date().toISOString(),
    }).eq('id',connection.data.id)
    throw new FunctionError(409,'google_reauthorization_required','Reconnect Google to keep importing transcripts.')
  }
  return token.access_token
}

async function resolveConferenceRecord(token:string,meetingCode:string):Promise<string|null>{
  const filter=encodeURIComponent(`space.meeting_code="${meetingCode}"`)
  const body=await meetGet<{conferenceRecords?:{name?:string;endTime?:string}[]}>(token,`${MEET_API}/conferenceRecords?filter=${filter}&pageSize=10`)
  const ended=(body.conferenceRecords??[]).filter((record)=>record.endTime)
  // Newest ended conference for that code: a recurring interview slot reuses the meeting code.
  return ended.length?String(ended[ended.length-1].name):null
}

async function listTranscripts(token:string,conferenceRecord:string){
  const body=await meetGet<{transcripts?:{name?:string;startTime?:string}[]}>(token,`${MEET_API}/${conferenceRecord}/transcripts?pageSize=10`)
  return (body.transcripts??[])
    .filter((transcript)=>transcript.name)
    .sort((left,right)=>String(left.startTime??'').localeCompare(String(right.startTime??'')))
    .map((transcript)=>({name:String(transcript.name)}))
}

async function listEntries(token:string,transcriptName:string){
  const entries:MeetEntry[]=[]
  let pageToken=''
  for(;;){
    const url=`${MEET_API}/${transcriptName}/entries?pageSize=${PAGE_SIZE}${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`
    const body=await meetGet<{transcriptEntries?:MeetEntry[];nextPageToken?:string}>(token,url)
    entries.push(...(body.transcriptEntries??[]))
    pageToken=body.nextPageToken??''
    if(!pageToken||entries.length>=MAX_ENTRIES)break
  }
  return entries
}

/* One place that talks to Google, so the error matrix is written once.
 *
 * 404 is not an error worth retrying: the artifact is gone or was never created, and Google's own
 * retention is outside our control. 429 and 5xx are, and they surface as codes the queue's backoff
 * understands. */
async function meetGet<T>(token:string,url:string):Promise<T>{
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}})
  if(response.status===404)throw new FunctionError(404,'meet_artifact_missing','Google has no such Meet artifact.')
  if(response.status===403)throw new FunctionError(403,'meet_access_denied','Google refused access to this Meet artifact.')
  if(response.status===429)throw new FunctionError(429,'meet_rate_limited','Google rate-limited the transcript request.')
  if(response.status>=500)throw new FunctionError(502,'meet_unavailable','Google Meet is temporarily unavailable.')
  if(!response.ok)throw new FunctionError(502,'meet_request_failed',`Meet API returned ${response.status}.`)
  return await response.json() as T
}



function describe(error:unknown):{code:string}{
  if(error instanceof FunctionError)return {code:error.code}
  return {code:'unexpected_error'}
}
