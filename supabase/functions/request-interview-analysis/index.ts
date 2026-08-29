import {FunctionError,requireUser} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {INTERVIEW_ANALYSIS_PROMPT_VERSION} from '../_shared/interview-analysis-schema.ts'

/* Queues an analysis. Deliberately thin.
 *
 * Every precondition, the input fingerprinting and the idempotency check live in
 * request_interview_analysis, under one transaction, because the two ways to pay twice for the same
 * answer are a double-click and a page refresh -- and a check performed here would race against
 * itself. This function's only judgement is which provider and model the run is for.
 *
 * The worker is nudged afterwards on a best-effort basis so a consultant sees progress in seconds
 * rather than waiting for the next scheduled drain. If that nudge fails, nothing is lost: the job is
 * durable and the scheduled drain picks it up.
 *
 * Access is verified with the CALLER's client and the run is created with the SERVICE client. Those
 * are two different questions -- may this person analyse this interview, and what configuration is
 * this deployment allowed to bill for -- and answering the second with the caller's client is what
 * made request_interview_analysis take a model name as an argument. A signed-in user could call it
 * directly through PostgREST with any model string and no ceiling at all.
 */

interface Input {organizationId?:string;interviewId?:string}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const requestID=requestId(request)
  let organizationId:string|undefined

  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json().catch(()=>null) as Input|null
    if(!input?.organizationId||!input?.interviewId)throw new FunctionError(400,'invalid_request','Organization and interview identifiers are required.')
    organizationId=input.organizationId

    const context=await requireUser(request)

    /* Both checks run as the CALLER, so RLS and the permission functions see the real user. The
     * feature permission is workspace-wide; access to this interview is not, and analysing a
     * colleague's interview needs the second one too. */
    const [permitted,accessible]=await Promise.all([
      context.caller.rpc('can_use_interview_intelligence',{p_organization_id:input.organizationId}),
      context.caller.rpc('can_access_interview_transcript',{p_interview_id:input.interviewId}),
    ])
    if(permitted.error||!permitted.data||accessible.error||!accessible.data){
      throw new FunctionError(403,'permission_denied','You do not have permission to analyse this interview.')
    }

    /* A friendly early refusal. The same ceiling is enforced again inside the request function,
     * where every path that can create a paid run passes -- this one exists so the page can say
     * which limit was hit rather than surfacing a raw identifier. */
    await enforceAnalysisLimits(context,input.organizationId)

    const provider=Deno.env.get('AI_PROVIDER')?.trim()||'anthropic'
    const model=Deno.env.get('AI_MODEL')?.trim()||''
    if(provider!=='anthropic'||!model||!Deno.env.get('ANTHROPIC_API_KEY')){
      throw new FunctionError(503,'analysis_not_configured','Interview analysis is not configured.')
    }

    /* Service client, trusted configuration, and the caller's identity passed explicitly rather than
     * inferred. The run is attributed to the person who asked for it, so cost and rate limits land
     * on them. */
    const result=await context.admin.rpc('internal_request_interview_analysis',{
      p_organization_id:input.organizationId,
      p_interview_id:input.interviewId,
      p_requested_by:context.user.id,
      p_provider:provider,
      p_model:model,
      p_prompt_version:INTERVIEW_ANALYSIS_PROMPT_VERSION,
    })
    if(result.error)throw requestFailure(result.error.message)

    const payload=result.data as {run_id:string;status:string;reused:boolean}

    // Best effort, never awaited: the response must not wait on a model call, and a failed nudge is
    // not a failed request.
    if(!payload.reused)nudgeWorker(requestID)

    log('info','interview_analysis_requested',{
      requestId:requestID,organizationId:input.organizationId,interviewId:input.interviewId,
      runId:payload.run_id,status:payload.status,reused:payload.reused,model,
    })
    return json(request,{runId:payload.run_id,status:payload.status,reused:payload.reused,requestId:requestID})
  }catch(error){
    const failure=error instanceof FunctionError?error:new FunctionError(500,'unexpected_error','The analysis could not be requested.')
    log('error','interview_analysis_request_failed',{requestId:requestID,organizationId,code:failure.code,status:failure.status})
    return json(request,{error:{code:failure.code,message:failure.message,requestId:requestID}},failure.status)
  }
})

/* The brakes on the most expensive call in the product. A dedup already stops an identical request
 * from spending twice, but it does nothing about a loop that varies its input -- reimporting a
 * transcript, retrying a failure -- so the counters are over runs created, not analyses completed: a
 * failed run still paid for a provider call.
 *
 * Deliberately generous starting points rather than tuned limits. Watch analysis_rate_limited and
 * analysis_monthly_ceiling_reached in the logs and tighten once real usage is visible. */
const HOURLY_USER_LIMIT=12
const HOURLY_ORG_LIMIT=40
const MONTHLY_ORG_TOKEN_CEILING=Number(Deno.env.get('AI_ANALYSIS_MONTHLY_TOKEN_CEILING'))||40_000_000

async function enforceAnalysisLimits(context:Awaited<ReturnType<typeof requireUser>>,organizationId:string){
  const [perUser,perOrg,monthlyTokens]=await Promise.all([
    context.admin.rpc('interview_analysis_recent_run_count',{p_organization_id:organizationId,p_requested_by:context.user.id,p_since:'1 hour'}),
    context.admin.rpc('interview_analysis_recent_run_count',{p_organization_id:organizationId,p_requested_by:null,p_since:'1 hour'}),
    context.admin.rpc('interview_analysis_token_spend_this_month',{p_organization_id:organizationId}),
  ])
  if(Number(perUser.data??0)>=HOURLY_USER_LIMIT)throw new FunctionError(429,'rate_limited','You have requested too many analyses in the last hour.')
  if(Number(perOrg.data??0)>=HOURLY_ORG_LIMIT)throw new FunctionError(429,'rate_limited','This workspace has requested too many analyses in the last hour.')
  if(Number(monthlyTokens.data??0)>=MONTHLY_ORG_TOKEN_CEILING)throw new FunctionError(429,'monthly_ceiling_reached','This workspace has reached its monthly AI limit for interview analysis.')
}

/* Each of these is a step somebody can go and complete, so each keeps its own identifier rather than
 * collapsing into "invalid request". */
function requestFailure(message:string):FunctionError{
  const map:Record<string,[number,string]>={
    transcript_consent_required:[409,'Record the candidate consent before analysing this interview.'],
    transcript_required:[409,'Add the interview transcript before requesting an analysis.'],
    speaker_mapping_required:[409,'Map every speaker before requesting an analysis.'],
    core_rubric_required:[409,'Activate an agency core interview rubric first.'],
    job_rubric_required:[409,'Activate an interview blueprint for this job first.'],
    interview_not_found:[404,'That interview could not be found in this workspace.'],
    permission_denied:[403,'You do not have permission to analyse this interview.'],
    /* Raised by the shared ceiling inside the request function. Reaching these means the request got
     * past the Edge Function's own check -- a race, or a path that does not call it -- so they still
     * need sentences. */
    rate_limited_user:[429,'You have requested too many analyses in the last hour.'],
    rate_limited_organization:[429,'This workspace has requested too many analyses in the last hour.'],
    monthly_ceiling_reached:[429,'This workspace has reached its monthly AI limit for interview analysis.'],
  }
  for(const [code,[status,text]] of Object.entries(map)){
    if(message.includes(code))return new FunctionError(status,code,text)
  }
  return new FunctionError(500,'analysis_request_failed','The analysis could not be requested.')
}

function nudgeWorker(requestID:string){
  const url=Deno.env.get('SUPABASE_URL')
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!url||!key)return
  fetch(`${url}/functions/v1/process-interview-analysis`,{
    method:'POST',
    headers:{'content-type':'application/json','authorization':`Bearer ${key}`,'x-worker-secret':Deno.env.get('WORKER_SECRET')||key},
    body:JSON.stringify({trigger:'request'}),
  }).catch((error)=>log('warn','interview_analysis_nudge_failed',{requestId:requestID,detail:error instanceof Error?error.message:String(error)}))
}
