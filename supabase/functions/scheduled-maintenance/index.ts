import {clients,FunctionError} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'

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
  try{
    authorize(request)
    const result=await runMaintenance(request,requestID)
    return json(request,{...result,requestId:requestID})
  }catch(error){
    const failure=error instanceof FunctionError?error:new FunctionError(500,'unexpected_error',error instanceof Error?error.message:'Unexpected error')
    // A failed run must leave a trace the client can see. Authentication failures are excluded:
    // an unauthenticated caller must not be able to write to the heartbeat at all, let alone mark
    // a healthy job failed.
    // A heartbeat write that itself fails must not replace the original error in the response --
    // the caller needs to see why the run failed, not why the bookkeeping did.
    if(failure.status!==401)await recordFailure(request,failure).catch((heartbeatError)=>log('error','scheduled_maintenance_heartbeat_failed',{requestId:requestID,detail:heartbeatError instanceof Error?heartbeatError.message:String(heartbeatError)}))
    log('error','scheduled_maintenance_failed',{requestId:requestID,code:failure.code,status:failure.status})
    return json(request,{error:{code:failure.code,message:failure.message,requestId:requestID}},failure.status)
  }
})

// Unchanged from the original cleanup(): either the dedicated worker secret or the service role key
// authorizes a run. This deletes candidate PII, so a misconfiguration must fail loudly rather than
// let an unauthenticated caller trigger it.
function authorize(request:Request){
  const secret=Deno.env.get('WORKER_SECRET')
  const serviceRole=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const bearer=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||null
  const workerAuthorized=Boolean(secret&&request.headers.get('x-worker-secret')===secret)
  const serviceAuthorized=Boolean(serviceRole&&bearer===serviceRole)
  if(!workerAuthorized&&!serviceAuthorized)throw new FunctionError(401,'worker_authentication_required','Worker authentication required.')
}

async function runMaintenance(request:Request,requestID:string){
  const {admin}=clients(request)
  const startedAt=new Date().toISOString()

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
  for(const candidate of due.data||[]){
    const storagePaths=Array.isArray(candidate.storage_paths)?candidate.storage_paths.filter((path:unknown):path is string=>typeof path==='string'&&path.length>0):[]
    if(storagePaths.length){
      const removed=await admin.storage.from(bucket).remove(storagePaths)
      if(removed.error){
        retentionFailures+=1
        log('error','candidate_retention_storage_failed',{requestId:requestID,candidateId:candidate.candidate_id,code:removed.error.name})
        continue
      }
    }
    const retained=await admin.rpc('anonymize_candidate_for_retention',{p_candidate_id:candidate.candidate_id,p_removed_storage_paths:storagePaths})
    if(retained.error){
      retentionFailures+=1
      log('error','candidate_retention_finalize_failed',{requestId:requestID,candidateId:candidate.candidate_id,code:retained.error.code})
      continue
    }
    candidatesRetained+=1
  }

  const payloads=await admin.from('email_delivery_payloads').delete({count:'exact'}).lt('expires_at',new Date().toISOString())
  if(payloads.error)throw payloads.error

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
  }

  // A run that could not anonymize every candidate it picked up is not a clean run. Recording it as
  // succeeded would let a persistent storage failure sit behind a green heartbeat indefinitely.
  const status=retentionFailures>0?'failed':'succeeded'
  const heartbeat={
    last_run_at:startedAt,
    last_status:status,
    last_detail:summary,
    last_error:retentionFailures>0?`${retentionFailures} candidate(s) could not be anonymized.`:null,
    ...(status==='succeeded'?{last_successful_run_at:startedAt}:{}),
  }
  const recorded=await admin.from('maintenance_heartbeats').update(heartbeat).eq('job_key',jobKey)
  if(recorded.error)log('error','scheduled_maintenance_heartbeat_failed',{requestId:requestID,code:recorded.error.code})

  log(retentionFailures>0?'warn':'info','scheduled_maintenance_completed',{requestId:requestID,...summary})
  return summary
}

async function recordFailure(request:Request,failure:FunctionError){
  const {admin}=clients(request)
  await admin.from('maintenance_heartbeats').update({
    last_run_at:new Date().toISOString(),
    last_status:'failed',
    last_error:`${failure.code}: ${failure.message}`.slice(0,500),
  }).eq('job_key',jobKey)
}
