import {clients,FunctionError} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {isAuthorized,readMode,type MaintenanceMode} from './authorization.ts'

// Every recurring data-hygiene job the product owes the client runs here: expired CV drafts and the
// files behind them, GDPR retention/anonymization, expired email payloads, expired import payloads,
// and reaping the public rate-limiter event tables.
//
// This used to be a `{"action":"cleanup"}` branch inside parse-candidate-cv -- a door named after
// something else -- driven by an hourly GitHub Actions cron. It is now its own function, scheduled
// by pg_cron inside the client's own Supabase project (see schedule_maintenance_cron in
// 20260810000000_scheduled_maintenance.sql), and it records a heartbeat so a schedule that stops
// becomes visible in Admin instead of failing silently.

const bucket='candidate-documents'
const jobKey='scheduled-maintenance'

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const requestID=requestId(request)
  /* Declared out here so the catch below can tell a preflight from a real run. A preflight must not
   * write the heartbeat even when it fails -- see recordFailure's guard. */
  let mode:MaintenanceMode='run'
  try{
    authorize(request)
    mode=await readMode(request)
    if(mode==='preflight')return json(request,{...await preflight(request),requestId:requestID})
    const result=await runMaintenance(request,requestID)
    return json(request,{...result,requestId:requestID})
  }catch(error){
    const failure=error instanceof FunctionError?error:new FunctionError(500,'unexpected_error',error instanceof Error?error.message:'Unexpected error')
    // A failed run must leave a trace the client can see. Authentication failures are excluded:
    // an unauthenticated caller must not be able to write to the heartbeat at all, let alone mark
    // a healthy job failed.
    // A heartbeat write that itself fails must not replace the original error in the response --
    // the caller needs to see why the run failed, not why the bookkeeping did.
    /* A preflight is excluded for the same reason a 401 is: it did no work, so marking the job
     * failed would put a red state on the Admin diagnostics for a run that never happened -- and a
     * deploy-time check that can dirty production bookkeeping is worse than no check. */
    if(failure.status!==401&&mode!=='preflight')await recordFailure(request,failure).catch((heartbeatError)=>log('error','scheduled_maintenance_heartbeat_failed',{requestId:requestID,detail:heartbeatError instanceof Error?heartbeatError.message:String(heartbeatError)}))
    log('error','scheduled_maintenance_failed',{requestId:requestID,mode,code:failure.code,status:failure.status})
    return json(request,{error:{code:failure.code,message:failure.message,requestId:requestID}},failure.status)
  }
})

/* Either the dedicated worker secret or the service role key authorizes a run, unchanged. The rule
 * itself now lives in authorization.ts so it can be unit-tested against the whole credential matrix
 * instead of only being exercised by a real scheduled invocation -- which is how a mismatch survived
 * in production for as long as it did. This deletes candidate PII, so a misconfiguration must fail
 * loudly rather than let an unauthenticated caller trigger it. */
function authorize(request:Request){
  const authorized=isAuthorized(request.headers,{
    workerSecret:Deno.env.get('WORKER_SECRET')??null,
    serviceRoleKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??null,
  })
  if(!authorized)throw new FunctionError(401,'worker_authentication_required','Worker authentication required.')
}

/* Proves the scheduled credential is accepted, without doing any of the work.
 *
 * This exists because the only previous evidence that maintenance could authenticate was a real
 * run at :17 past the hour -- and when that started returning 401 nothing failed, because pg_cron
 * only reports whether the REQUEST was made. deploy.yml calls this with exactly the headers
 * schedule_maintenance_cron registers, so a credential mismatch fails the deployment instead of
 * silently stopping retention.
 *
 * Strictly read-only. It does not claim the heartbeat, delete a CV, anonymize a candidate, or write
 * anything at all. It does READ the heartbeat row, because a missing row is the other way a real run
 * dies ('heartbeat_unavailable'), and finding that at deploy time is the entire point.
 *
 * The response deliberately carries no secret and no candidate data -- only the job's own public
 * status, which Admin already displays. */
async function preflight(request:Request){
  const {admin}=clients(request)
  const heartbeat=await admin.from('maintenance_heartbeats')
    .select('job_key,last_status,last_successful_run_at').eq('job_key',jobKey).maybeSingle()
  if(heartbeat.error)throw new FunctionError(500,'heartbeat_unavailable',`Could not read the maintenance heartbeat: ${heartbeat.error.message}`)
  if(!heartbeat.data)throw new FunctionError(500,'heartbeat_unavailable',`No maintenance heartbeat row exists for ${jobKey}.`)
  log('info','scheduled_maintenance_preflight_ok',{jobKey})
  return {
    mode:'preflight' as const,
    ok:true,
    jobKey,
    lastStatus:heartbeat.data.last_status??null,
    lastSuccessfulRunAt:heartbeat.data.last_successful_run_at??null,
  }
}

async function runMaintenance(request:Request,requestID:string){
  const {admin}=clients(request)
  const startedAt=new Date().toISOString()

  // Claim the run BEFORE doing any work. Previously the only heartbeat write was at the very end,
  // so a run that was severed partway -- which is what a 5s pg_net timeout against a real backlog
  // does every single hour -- left the row exactly as it found it: never_run, no error. The job then
  // looked like it had never started rather than like it kept dying, and the distinction is the
  // whole diagnosis. 'running' with a start time is a state the previous schema could not express.
  const claimed=await admin.from('maintenance_heartbeats').update({
    last_run_at:startedAt,
    last_started_at:startedAt,
    last_status:'running',
    last_error:null,
  }).eq('job_key',jobKey)
  // A heartbeat that cannot be claimed means the bookkeeping itself is broken (missing row, revoked
  // grant). That is worth failing the run over: continuing would do real deletion work whose outcome
  // could never be reported, which is the failure mode this whole change exists to end.
  if(claimed.error)throw new FunctionError(500,'heartbeat_unavailable',`Could not claim the maintenance heartbeat: ${claimed.error.message}`)

  const {data,error}=await admin.from('candidate_cv_parses').select('id,organization_id,storage_path').lt('expires_at',new Date().toISOString()).not('status','in','(accepted,cancelled,expired)').limit(100)
  if(error)throw error
  const paths=(data||[]).map((row)=>row.storage_path)
  if(paths.length){
    const removed=await admin.storage.from(bucket).remove(paths)
    if(removed.error)throw removed.error
  }
  if(data?.length){
    const expired=await Promise.all(data.map((row)=>admin.from('candidate_cv_parses').update({status:'expired',original_filename:`expired-${row.id}`,storage_path:`expired/${row.organization_id}/${row.id}`,extracted_data:null,field_evidence:{},uncertainties:[],error_code:null,error_message:null}).eq('id',row.id)))
    const failure=expired.find((result)=>result.error)?.error
    if(failure)throw failure
  }

  // submission_link_events backs the public rate limiter in resolve_submission_link and
  // submit_submission_feedback, which only ever looks back one hour -- nothing reads a row past
  // that horizon, and there is no other reaper for the table. The audit trail that actually matters
  // (last_accessed_at on public_submission_links) is preserved separately, so this is pure
  // rate-limit bookkeeping, not history. Seven days is generous headroom for investigating a recent
  // abuse spike without letting the table grow without bound.
  const eventCutoff=new Date(Date.now()-7*24*60*60*1000).toISOString()
  const submissionEvents=await admin.from('submission_link_events').delete({count:'exact'}).lt('occurred_at',eventCutoff)
  if(submissionEvents.error)throw submissionEvents.error

  // Retention is deliberately two phase: remove every storage object first, then
  // ask the database to re-check inactivity/legal hold and anonymize. The RPC
  // rejects the finalization if a new document appeared between those steps.
  const due=await admin.rpc('list_candidates_due_for_retention',{p_limit:100})
  if(due.error)throw due.error
  let candidatesRetained=0
  let retentionFailures=0
  // Bounded concurrency, not a sequential loop. Each candidate costs two round trips (storage
  // delete, then the finalizing RPC) and the batch is up to 100, so the previous `for await` shape
  // serialised as many as 200 network calls into one request -- tens of seconds on a good day, and
  // the direct cause of every run being cut off by pg_net's 5s default timeout before it could
  // record anything. Six at a time keeps wall time proportionate without opening enough parallel
  // storage deletes to get rate-limited.
  //
  // Kept as a chunked loop rather than one big Promise.all so the two-phase contract per candidate
  // is unchanged: remove that candidate's objects, THEN ask the database to re-check inactivity and
  // legal hold and anonymize. The RPC still rejects finalization if a document appeared in between.
  /* Named explicitly rather than left implicit. The previous `for (const candidate of due.data||[])`
   * got away with an untyped RPC result because iteration does not trip noImplicitAny; a .map()
   * callback parameter does. Writing the shape down is the better answer than widening to any: these
   * two fields are the entire contract this loop depends on from
   * list_candidates_due_for_retention, and the Edge Function client carries no generated types. */
  interface DueCandidate{candidate_id:string;storage_paths:unknown}
  const dueCandidates=(due.data||[]) as DueCandidate[]
  for(let index=0;index<dueCandidates.length;index+=6){
    const results=await Promise.all(dueCandidates.slice(index,index+6).map(async(candidate:DueCandidate)=>{
      const storagePaths=Array.isArray(candidate.storage_paths)?candidate.storage_paths.filter((path:unknown):path is string=>typeof path==='string'&&path.length>0):[]
      if(storagePaths.length){
        const removed=await admin.storage.from(bucket).remove(storagePaths)
        if(removed.error){
          log('error','candidate_retention_storage_failed',{requestId:requestID,candidateId:candidate.candidate_id,code:removed.error.name})
          return false
        }
      }
      const retained=await admin.rpc('anonymize_candidate_for_retention',{p_candidate_id:candidate.candidate_id,p_removed_storage_paths:storagePaths})
      if(retained.error){
        log('error','candidate_retention_finalize_failed',{requestId:requestID,candidateId:candidate.candidate_id,code:retained.error.code})
        return false
      }
      return true
    }))
    for(const ok of results){if(ok)candidatesRetained+=1;else retentionFailures+=1}
  }

  const payloads=await admin.from('email_delivery_payloads').delete({count:'exact'}).lt('expires_at',new Date().toISOString())
  if(payloads.error)throw payloads.error

/* Interview transcripts whose retention window expired, and every transcript belonging to an
   * interview whose consent was withdrawn. The RPC is bounded and re-checks legal hold per
   * transcript, so a preservation obligation is honoured even though this sweep found the row.
   *
   * Deliberately part of the SAME hourly job as candidate retention rather than a schedule of its
   * own: a second cron is a second thing that can be silently disabled, and the client's deletion
   * guarantee should not depend on two of them. */
  const transcripts=await admin.rpc('purge_due_interview_transcripts',{p_limit:50})
  if(transcripts.error)throw transcripts.error
  const transcriptPurge=(transcripts.data||{purged:0,skipped:0}) as {purged?:number;skipped?:number}

/* Discovers Meet transcripts worth fetching and drains that queue.
   *
   * Discovery is a database query -- it decides WHICH interviews are eligible, including the
   * settling margin and the attempt ceiling -- and the fetching is a separate worker. Keeping the
   * eligibility rule in SQL means it is the same rule whether the sweep runs hourly or somebody
   * triggers it by hand, and the worker never has to re-derive it.
   *
   * Same reasoning as the analysis drain: it shares this schedule rather than taking its own, and a
   * failure is recorded without failing retention. */
  let meetQueued=0
  let meetProcessed=0
  let meetError:string|null=null
  try{
    const discovered=await admin.rpc('discover_meet_transcript_fetches',{p_limit:25})
    if(discovered.error)throw new Error(discovered.error.message)
    meetQueued=Number((discovered.data as {queued?:number}|null)?.queued||0)

    for(let pass=0;pass<5;pass+=1){
      const drained=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/fetch-meet-transcript`,{
        method:'POST',
        headers:{
          'content-type':'application/json',
          'authorization':`Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'x-worker-secret':Deno.env.get('WORKER_SECRET')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',
        },
        body:JSON.stringify({trigger:'scheduled'}),
      })
      if(!drained.ok){meetError=`HTTP ${drained.status}`;break}
      const body=await drained.json().catch(()=>null) as {processed?:number}|null
      const count=Number(body?.processed||0)
      meetProcessed+=count
      if(count===0)break
    }
  }catch(error){
    meetError=error instanceof Error?error.message:String(error)
  }
  if(meetError)log('warn','meet_transcript_sweep_failed',{requestId:requestID,detail:meetError})

  /* Drains the interview analysis queue.
   *
   * This is the SAFETY NET, not the primary path: request-interview-analysis nudges the worker
   * directly so a consultant sees progress in seconds. What this catches is the job whose nudge
   * failed -- a cold start, a transient 5xx -- which would otherwise sit queued until somebody
   * noticed. Reusing this hourly job rather than registering a second cron is deliberate: a second
   * schedule is a second thing that can be silently disabled.
   *
   * A drain failure does NOT fail the maintenance run. Retention and anonymization are the client's
   * data-deletion guarantee and matter more than a queued analysis; the error is recorded in the
   * heartbeat detail so a broken worker is visible in Admin rather than silent. */
  let analysesProcessed=0
  let analysisDrainError:string|null=null
  try{
    // Bounded: the worker takes a small batch per call, so a few passes clear a backlog without
    // letting one maintenance request run unboundedly against a paid provider.
    for(let pass=0;pass<5;pass+=1){
      const drained=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-interview-analysis`,{
        method:'POST',
        headers:{
          'content-type':'application/json',
          'authorization':`Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'x-worker-secret':Deno.env.get('WORKER_SECRET')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',
        },
        body:JSON.stringify({trigger:'scheduled'}),
      })
      if(!drained.ok){analysisDrainError=`HTTP ${drained.status}`;break}
      const body=await drained.json().catch(()=>null) as {processed?:number}|null
      const processed=Number(body?.processed||0)
      analysesProcessed+=processed
      if(processed===0)break
    }
  }catch(error){
    analysisDrainError=error instanceof Error?error.message:String(error)
  }
  if(analysisDrainError)log('warn','interview_analysis_drain_failed',{requestId:requestID,detail:analysisDrainError})

  const imports=await admin.rpc('redact_expired_import_payloads')
  if(imports.error)throw imports.error
  const importRowsRedacted=Number(imports.data||0)

  const summary={
    expired:data?.length||0,
    submissionEventsDeleted:submissionEvents.count||0,
    candidatesRetained,
    retentionFailures,
    emailPayloadsDeleted:payloads.count||0,
    importRowsRedacted,
    transcriptsPurged:transcriptPurge.purged||0,
    transcriptsSkipped:transcriptPurge.skipped||0,
    analysesProcessed,
    analysisDrainError,
    meetFetchesQueued:meetQueued,
    meetTranscriptsProcessed:meetProcessed,
    meetSweepError:meetError,
  }

  // A run that could not anonymize every candidate it picked up is not a clean run. Recording it as
  // succeeded would let a persistent storage failure sit behind a green heartbeat indefinitely.
  const status=retentionFailures>0?'failed':'succeeded'
  const finishedAt=new Date().toISOString()
  const heartbeat={
    last_run_at:startedAt,
    last_finished_at:finishedAt,
    last_status:status,
    last_detail:summary,
    last_error:retentionFailures>0?`${retentionFailures} candidate(s) could not be anonymized.`:null,
    consecutive_failures:retentionFailures>0?undefined:0,
    // Completion time, not start time. The previous code stamped last_successful_run_at with
    // startedAt, which reads as a successful run finishing before it did -- harmless while the
    // staleness window is measured in hours, wrong the moment anyone reasons about duration.
    ...(status==='succeeded'?{last_successful_run_at:finishedAt}:{}),
  }
  if(heartbeat.consecutive_failures===undefined)delete heartbeat.consecutive_failures
  const recorded=await admin.from('maintenance_heartbeats').update(heartbeat).eq('job_key',jobKey)
  if(recorded.error)log('error','scheduled_maintenance_heartbeat_failed',{requestId:requestID,code:recorded.error.code})

  log(retentionFailures>0?'warn':'info','scheduled_maintenance_completed',{requestId:requestID,...summary})
  return summary
}

/* Still never called for a 401 -- an unauthenticated caller must not be able to write here at all,
 * let alone mark a healthy job failed. That exclusion used to make an auth mismatch the one failure
 * with no trace anywhere; it no longer does, because run_scheduled_maintenance stamps
 * last_attempt_at from inside the database before the request is even sent. A recent attempt with no
 * corresponding start is now a reportable state ('delivery' in get_maintenance_health), reached
 * without granting the rejected caller any write at all. */
async function recordFailure(request:Request,failure:FunctionError){
  const {admin}=clients(request)
  const now=new Date().toISOString()
  await admin.from('maintenance_heartbeats').update({
    last_run_at:now,
    last_finished_at:now,
    last_status:'failed',
    last_error:`${failure.code}: ${failure.message}`.slice(0,500),
  }).eq('job_key',jobKey)
}
