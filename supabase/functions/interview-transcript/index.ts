import {FunctionError,clients,requirePermission} from '../_shared/auth.ts'
import {decryptSecret} from '../_shared/crypto.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {MAX_TRANSCRIPT_ATTEMPTS,meetingCodeFromUrl,nextAttemptDelayMs,shapeTranscript,type MeetEntry,type MeetParticipant} from '../_shared/interview-transcript.ts'

declare const EdgeRuntime:{waitUntil(promise:Promise<unknown>):void}

/* Pulls the transcript Google Meet already produced for a scheduled interview.
 *
 * Nothing here records audio. Meet transcribes the call itself when the host starts transcription,
 * and this reads the result through the Meet REST API using the organizer's existing Google refresh
 * token -- the same token calendar-sync uses to create the event. That keeps the interview inside
 * the two processors this product already has, adds no per-minute vendor cost, and means the
 * candidate sees Meet's own in-call transcription notice rather than an unexplained bot joining.
 *
 * Requires the meetings.space.readonly scope, which existing connections were not granted -- see the
 * reauthorization path below, which every already-connected member hits exactly once.
 */

// No 'status' action: the client polls the interview_transcripts row directly through PostgREST,
// where the same RLS policy answers and a realtime change can invalidate the query for free.
type Action='fetch'|'sweep'
interface Input {action?:Action;organizationId?:string;interviewId?:string}
type Admin=ReturnType<typeof clients>['admin']

const MEET_API='https://meet.googleapis.com/v2'
const SWEEP_BATCH=20
// Past this, a transcript that has not appeared is not late -- transcription was never started.
const GIVE_UP_AFTER_MS=24*60*60*1000

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const requestID=requestId(request)
  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json() as Input
    if(input.action==='sweep')return await sweep(request,requestID)
    if(!input.organizationId||!input.interviewId)throw new FunctionError(400,'invalid_request','Organization and interview are required.')
    const scoped={organizationId:input.organizationId,interviewId:input.interviewId}
    if(input.action==='fetch'||!input.action)return await start(request,scoped,requestID)
    throw new FunctionError(400,'invalid_action','Unsupported transcript action.')
  }catch(error){
    const failure=error instanceof FunctionError?error:new FunctionError(500,'unexpected_error',error instanceof Error?error.message:'Unexpected error')
    log(failure.status===429?'warn':'error','interview_transcript_request_failed',{requestId:requestID,code:failure.code,status:failure.status})
    return json(request,{error:{code:failure.code,message:failure.message,requestId:requestID}},failure.status)
  }
})

async function start(request:Request,input:{organizationId:string;interviewId:string},requestID:string){
  const context=await requirePermission(request,input.organizationId,'placements.write')
  const interview=await loadInterview(context.admin,input.organizationId,input.interviewId)
  if(!meetingCodeFromUrl(interview.meeting_url))throw new FunctionError(400,'meeting_url_missing','This interview has no Google Meet link to transcribe.')

  const existing=await context.admin.from('interview_transcripts').select('*').eq('organization_id',input.organizationId).eq('interview_id',input.interviewId).maybeSingle()
  if(existing.error)throw new FunctionError(500,'transcript_lookup_failed','Could not read the interview transcript.')
  let row=existing.data
  if(!row){
    const created=await context.admin.from('interview_transcripts').insert({organization_id:input.organizationId,interview_id:input.interviewId,status:'pending',created_by:context.user.id}).select('*').single()
    // A concurrent request that won the unique(interview_id) race is a success for this one too.
    if(created.error&&created.error.code!=='23505')throw new FunctionError(500,'transcript_create_failed','Could not start transcript retrieval.')
    row=created.data||(await context.admin.from('interview_transcripts').select('*').eq('interview_id',input.interviewId).single()).data
  }
  if(!row)throw new FunctionError(500,'transcript_create_failed','Could not start transcript retrieval.')
  if(row.status==='ready')return json(request,{status:'ready',transcriptId:row.id,requestId:requestID})
  // An explicit request is a decision to try now, so it clears an exhausted backoff and a settled
  // 'unavailable' -- a host who started transcription late deserves a second look.
  await context.admin.from('interview_transcripts').update({status:'pending',attempts:0,next_attempt_at:new Date().toISOString(),failure_code:null,failure_message:null}).eq('id',row.id).neq('status','fetching')
  EdgeRuntime.waitUntil(runFetch(context.admin,row.id,requestID))
  log('info','interview_transcript_queued',{requestId:requestID,organizationId:input.organizationId,interviewId:input.interviewId,transcriptId:row.id})
  return json(request,{status:'pending',transcriptId:row.id,requestId:requestID},202)
}

async function sweep(request:Request,requestID:string){
  const secret=Deno.env.get('WORKER_SECRET')
  if(!secret||request.headers.get('x-worker-secret')!==secret)throw new FunctionError(401,'worker_authentication_required','Worker authentication required.')
  const {admin}=clients(request)
  const {data,error}=await admin.from('interview_transcripts').select('id')
    .in('status',['pending','failed']).lte('next_attempt_at',new Date().toISOString())
    .order('next_attempt_at',{ascending:true}).limit(SWEEP_BATCH)
  if(error)throw error
  let processed=0
  // Sequential on purpose: each row costs a Google token refresh plus several API calls, and a
  // burst of parallel refreshes against one OAuth client is the fastest way to get rate limited.
  for(const row of data||[]){if(await runFetch(admin,row.id,requestID))processed+=1}
  log('info','interview_transcript_sweep_completed',{requestId:requestID,claimed:data?.length||0,processed})
  return json(request,{claimed:data?.length||0,processed,requestId:requestID})
}

async function loadInterview(admin:Admin,organizationId:string,interviewId:string){
  const {data,error}=await admin.from('interviews')
    .select('id,organization_id,organizer_member_id,starts_at,ends_at,meeting_url,status,job_candidates(candidates(full_name))')
    .eq('organization_id',organizationId).eq('id',interviewId).maybeSingle()
  if(error||!data)throw new FunctionError(404,'interview_not_found','Interview not found.')
  return data
}

/* Runs one transcript retrieval to completion. Returns true when the transcript landed.
 *
 * Never throws: it is called from both a fire-and-forget waitUntil and a batch sweep, where an
 * exception would be either invisible or fatal to the rest of the batch. Every exit writes a status
 * to the row instead, which is what the UI polls.
 */
async function runFetch(admin:Admin,transcriptId:string,requestID:string):Promise<boolean>{
  // Conditional update as a claim token, the same shape parse-candidate-cv uses: two sweeps (or a
  // sweep and a user click) overlapping must not both call Google for the same interview.
  const claim=await admin.from('interview_transcripts').update({status:'fetching'}).eq('id',transcriptId).in('status',['pending','failed']).select('*').maybeSingle()
  if(claim.error||!claim.data)return false
  const row=claim.data
  const attempts=(row.attempts||0)+1

  try{
    const interview=await loadInterview(admin,row.organization_id,row.interview_id)
    const meetingCode=meetingCodeFromUrl(interview.meeting_url)
    if(!meetingCode)return await settle(admin,row.id,'failed','meeting_url_missing','This interview has no Google Meet link to transcribe.',attempts)
    if(!interview.organizer_member_id)return await settle(admin,row.id,'failed','organizer_required','Set an interview organizer before retrieving the transcript.',attempts)

    const token=await googleAccessToken(admin,row.organization_id,interview.organizer_member_id)
    if(!token.ok)return await settle(admin,row.id,'failed',token.code,token.message,attempts)

    const conference=await findConferenceRecord(token.accessToken,meetingCode,interview.starts_at)
    if(!conference)return await defer(admin,row,attempts,'conference_not_found','Google Meet has not published a record of this call yet.',interview.ends_at)

    const transcript=await findTranscript(token.accessToken,conference)
    if(!transcript)return await defer(admin,row,attempts,'transcript_not_available','No Meet transcript exists for this call yet. Transcription may not have been started.',interview.ends_at)

    const [entries,participants]=await Promise.all([
      listEntries(token.accessToken,transcript),
      listParticipants(token.accessToken,conference),
    ])
    if(!entries.length)return await defer(admin,row,attempts,'transcript_empty','The Meet transcript for this call is still empty.',interview.ends_at)

    const memberNames=await activeMemberNames(admin,row.organization_id)
    const candidateName=(interview.job_candidates as {candidates?:{full_name?:string}}|null)?.candidates?.full_name||null
    const organizerName=await memberFullName(admin,interview.organizer_member_id)
    const shaped=shapeTranscript({participants,entries,organizerName,memberNames,candidateName})

    const saved=await admin.from('interview_transcripts').update({
      status:'ready',google_conference_record:conference,google_transcript_name:transcript,
      language:shaped.language,entries:shaped.entries,plain_text:shaped.plainText,talk_time:shaped.talkTime,
      duration_seconds:shaped.durationSeconds,entry_count:shaped.entries.length,attempts,
      failure_code:null,failure_message:null,fetched_at:new Date().toISOString(),
    }).eq('id',row.id)
    if(saved.error)throw saved.error

    await admin.from('audit_logs').insert({organization_id:row.organization_id,actor_user_id:null,action:'interview.transcript_fetched',entity_type:'interview',entity_id:row.interview_id,metadata:{transcript_id:row.id,entry_count:shaped.entries.length}})
    log('info','interview_transcript_ready',{requestId:requestID,organizationId:row.organization_id,interviewId:row.interview_id,transcriptId:row.id,entryCount:shaped.entries.length,durationSeconds:shaped.durationSeconds,unattributedSpeakers:shaped.speakers.filter((speaker)=>speaker.role==='other').length})
    return true
  }catch(error){
    const message=error instanceof FunctionError?error.message:'The Meet transcript could not be retrieved.'
    log('error','interview_transcript_failed',{requestId:requestID,transcriptId:row.id,interviewId:row.interview_id,attempts})
    await settle(admin,row.id,'failed','transcript_fetch_failed',message,attempts)
    return false
  }
}

/* An absent transcript is the expected case, not an error: Meet publishes minutes after the call
 * ends. This backs off and tries again, and only calls it 'unavailable' once waiting longer has
 * stopped being plausible -- which is the state the UI explains as "transcription was never
 * started" rather than showing a failure the consultant cannot act on. */
async function defer(admin:Admin,row:{id:string;organization_id:string;interview_id:string},attempts:number,code:string,message:string,endsAt:string|null){
  const endedLongAgo=Boolean(endsAt)&&Date.now()-new Date(endsAt as string).getTime()>GIVE_UP_AFTER_MS
  if(attempts>=MAX_TRANSCRIPT_ATTEMPTS||endedLongAgo)return await settle(admin,row.id,'unavailable',code,message,attempts)
  await admin.from('interview_transcripts').update({
    status:'pending',attempts,failure_code:code,failure_message:message,
    next_attempt_at:new Date(Date.now()+nextAttemptDelayMs(attempts)).toISOString(),
  }).eq('id',row.id)
  return false
}

async function settle(admin:Admin,transcriptId:string,status:'failed'|'unavailable',code:string,message:string,attempts:number){
  await admin.from('interview_transcripts').update({
    status,attempts,failure_code:code,failure_message:message.slice(0,1000),
    // Nothing should retry a settled row on a schedule; only an explicit request reopens it.
    next_attempt_at:new Date(Date.now()+GIVE_UP_AFTER_MS).toISOString(),
  }).eq('id',transcriptId)
  return false
}

/* Same exchange calendar-sync performs, including marking the connection for reauthorization when
 * the refresh token no longer works -- which is exactly what happens the first time an account
 * connected before the meetings.space.readonly scope existed is used here. */
async function googleAccessToken(admin:Admin,organizationId:string,memberId:string):Promise<{ok:true;accessToken:string}|{ok:false;code:string;message:string}>{
  const {data:connection}=await admin.from('google_calendar_connections').select('id,token_secret_id,scopes').eq('organization_id',organizationId).eq('member_id',memberId).eq('status','connected').maybeSingle()
  if(!connection||!connection.token_secret_id)return {ok:false,code:'calendar_not_connected',message:'The interview organizer must connect Google Calendar.'}
  const scopes=(connection.scopes||[]) as string[]
  if(scopes.length&&!scopes.some((scope)=>scope.includes('meetings.space.readonly'))){
    await admin.from('google_calendar_connections').update({status:'reauthorization_required',last_error:'Reconnect Google to grant Meet transcript access.',last_error_at:new Date().toISOString()}).eq('id',connection.id)
    return {ok:false,code:'calendar_reauthorization_required',message:'Reconnect Google Calendar to grant Meet transcript access.'}
  }
  const {data:secret}=await admin.from('google_calendar_secrets').select('encrypted_refresh_token').eq('id',connection.token_secret_id).maybeSingle()
  if(!secret)return {ok:false,code:'calendar_reauthorization_required',message:'Reconnect Google Calendar.'}
  const clientId=Deno.env.get('GOOGLE_CLIENT_ID');const clientSecret=Deno.env.get('GOOGLE_CLIENT_SECRET')
  if(!clientId||!clientSecret)return {ok:false,code:'calendar_not_configured',message:'Google Calendar is not configured.'}
  const refreshToken=await decryptSecret(secret.encrypted_refresh_token)
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})})
  const token=await response.json().catch(()=>({})) as {access_token?:string;scope?:string}
  if(!response.ok||!token.access_token){
    await admin.from('google_calendar_connections').update({status:'reauthorization_required',last_error:'Google authorization expired.',last_error_at:new Date().toISOString()}).eq('id',connection.id)
    return {ok:false,code:'calendar_reauthorization_required',message:'Reconnect Google Calendar.'}
  }
  // The grant is authoritative about what the token can actually do; stored scopes can lag it.
  if(token.scope&&!token.scope.includes('meetings.space.readonly')){
    await admin.from('google_calendar_connections').update({status:'reauthorization_required',last_error:'Reconnect Google to grant Meet transcript access.',last_error_at:new Date().toISOString()}).eq('id',connection.id)
    return {ok:false,code:'calendar_reauthorization_required',message:'Reconnect Google Calendar to grant Meet transcript access.'}
  }
  return {ok:true,accessToken:token.access_token}
}

async function meet<T>(accessToken:string,path:string):Promise<T>{
  const response=await fetch(`${MEET_API}/${path}`,{headers:{Authorization:`Bearer ${accessToken}`}})
  const body=await response.json().catch(()=>null) as T&{error?:{message?:string;status?:string}}
  if(!response.ok){
    if(response.status===403)throw new FunctionError(403,'meet_permission_denied',body?.error?.message||'Google denied access to the Meet transcript. Confirm Workspace transcription is enabled.')
    if(response.status===429)throw new FunctionError(429,'meet_rate_limited','Google Meet rate limited the transcript request.')
    throw new FunctionError(502,'meet_request_failed',body?.error?.message||`Google Meet request failed (${response.status}).`)
  }
  return body as T
}

/* A recurring meeting code has one conference record per occurrence, so the right one is chosen by
 * proximity to the scheduled start rather than by taking the newest. */
async function findConferenceRecord(accessToken:string,meetingCode:string,startsAt:string){
  const filter=encodeURIComponent(`space.meeting_code="${meetingCode}"`)
  const body=await meet<{conferenceRecords?:{name:string;startTime?:string}[]}>(accessToken,`conferenceRecords?pageSize=20&filter=${filter}`)
  const records=body.conferenceRecords||[]
  if(!records.length)return null
  const target=new Date(startsAt).getTime()
  let best=records[0]as {name:string;startTime?:string}
  let bestDistance=Number.POSITIVE_INFINITY
  for(const record of records){
    const started=record.startTime?Date.parse(record.startTime):Number.NaN
    const distance=Number.isNaN(started)?Number.POSITIVE_INFINITY:Math.abs(started-target)
    if(distance<bestDistance){best=record;bestDistance=distance}
  }
  return best.name
}

/* Only an ENDED transcript is read. A STARTED one belongs to a call still in progress, and its
 * entries would be a partial interview presented as a whole one. */
async function findTranscript(accessToken:string,conferenceRecord:string){
  const body=await meet<{transcripts?:{name:string;state?:string;startTime?:string}[]}>(accessToken,`${conferenceRecord}/transcripts?pageSize=10`)
  const transcripts=(body.transcripts||[]).filter((item)=>item.state==='ENDED')
  if(!transcripts.length)return null
  return transcripts.sort((a,b)=>Date.parse(a.startTime||'')-Date.parse(b.startTime||''))[0]?.name||null
}

async function listEntries(accessToken:string,transcript:string){
  const entries:MeetEntry[]=[]
  let pageToken=''
  // Bounded so a pathological transcript cannot page forever inside a waitUntil.
  for(let page=0;page<40;page+=1){
    const body=await meet<{transcriptEntries?:MeetEntry[];nextPageToken?:string}>(accessToken,`${transcript}/entries?pageSize=100${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`)
    entries.push(...(body.transcriptEntries||[]))
    if(!body.nextPageToken)break
    pageToken=body.nextPageToken
  }
  return entries
}

async function listParticipants(accessToken:string,conferenceRecord:string){
  const participants:MeetParticipant[]=[]
  let pageToken=''
  for(let page=0;page<10;page+=1){
    const body=await meet<{participants?:{name:string;signedinUser?:{displayName?:string};anonymousUser?:{displayName?:string};phoneUser?:{displayName?:string}}[];nextPageToken?:string}>(accessToken,`${conferenceRecord}/participants?pageSize=50${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`)
    for(const item of body.participants||[]){
      participants.push({name:item.name,displayName:item.signedinUser?.displayName||item.anonymousUser?.displayName||item.phoneUser?.displayName||'Unknown speaker'})
    }
    if(!body.nextPageToken)break
    pageToken=body.nextPageToken
  }
  return participants
}

async function activeMemberNames(admin:Admin,organizationId:string){
  const {data}=await admin.from('organization_members').select('profiles(full_name)').eq('organization_id',organizationId).eq('status','active').limit(200)
  return (data||[]).map((row)=>(row.profiles as {full_name?:string}|null)?.full_name||'').filter(Boolean)
}

async function memberFullName(admin:Admin,memberId:string){
  const {data}=await admin.from('organization_members').select('profiles(full_name)').eq('id',memberId).maybeSingle()
  return (data?.profiles as {full_name?:string}|null)?.full_name||null
}
