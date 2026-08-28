import {FunctionError,requireUser} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {providerBillingExhausted} from '../_shared/provider-outage.ts'
import {
  buildRubricUserMessage,
  INTERVIEW_RUBRIC_PROMPT_VERSION,
  INTERVIEW_RUBRIC_SYSTEM_PROMPT,
  interviewRubricJsonSchema,
  RubricValidationError,
  validateRubricDraft,
  type RubricSourcePayload,
} from '../_shared/interview-rubric-schema.ts'

/* Generates a DRAFT interview blueprint for one job.
 *
 * Three things this endpoint deliberately does not do: it never activates what it generates, it never
 * writes back into the job's own fields, and it never loads a candidate. The last one is not an
 * oversight -- a blueprint is about the role, and letting candidate data into the prompt is how a
 * blueprint quietly becomes tailored to whoever happened to be in the pipeline when it was made.
 *
 * Cost controls mirror generate-candidate-profile: per-user and per-organization hourly counts, a
 * monthly token ceiling, and a bounded input. All of it is recorded on ai_evaluations so the spend
 * lands in the same place as every other call on the shared ANTHROPIC_API_KEY.
 */

interface Input {organizationId?:string;jobId?:string;documentId?:string|null}
type Context=Awaited<ReturnType<typeof requireUser>>

const bucket='candidate-documents'
const HOURLY_USER_LIMIT=10
const HOURLY_ORG_LIMIT=40
const MONTHLY_ORG_TOKEN_CEILING=Number(Deno.env.get('AI_RUBRIC_MONTHLY_TOKEN_CEILING'))||10_000_000
/* A job description is prose, not a corpus. Anything past this is a pasted handbook, and sending it
 * would spend real money on tokens that make the blueprint worse, not better. */
const MAX_BRIEF_CHARACTERS=40_000

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const requestID=requestId(request)
  let evaluationId:string|undefined
  let organizationId:string|undefined
  const started=Date.now()

  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json().catch(()=>null) as Input|null
    if(!input?.organizationId||!input?.jobId)throw new FunctionError(400,'invalid_request','Organization and job identifiers are required.')
    organizationId=input.organizationId

    const context=await requireUser(request)
    await requireBlueprintAccess(context,input.organizationId)
    await enforceRubricRateLimits(context,input.organizationId)

    const {job,document}=await loadBrief(context,input.organizationId,input.jobId,input.documentId??null)

    const briefHash=await context.caller.rpc('interview_job_brief_hash',{p_job_id:input.jobId,p_document_id:document?.id??null})
    if(briefHash.error||!briefHash.data)throw new FunctionError(500,'job_brief_hash_failed','Could not fingerprint this job brief.')

    const provider=Deno.env.get('AI_PROVIDER')?.trim()||'anthropic'
    const model=Deno.env.get('AI_MODEL')?.trim()||''

    const evaluation=await context.admin.from('ai_evaluations').insert({
      organization_id:input.organizationId,candidate_id:null,job_id:input.jobId,
      evaluation_type:'interview_rubric',provider,model:model||'unconfigured',
      prompt_version:INTERVIEW_RUBRIC_PROMPT_VERSION,status:'processing',
      input_hash:briefHash.data as string,
      input_versions:{job_brief_hash:briefHash.data,prompt_version:INTERVIEW_RUBRIC_PROMPT_VERSION,document_id:document?.id??null},
      requested_by:context.user.id,
    }).select('id').single()
    if(evaluation.error||!evaluation.data)throw new FunctionError(500,'evaluation_persistence_failed','Could not start a tracked blueprint generation.')
    evaluationId=evaluation.data.id

    if(provider!=='anthropic'||!model||!Deno.env.get('ANTHROPIC_API_KEY')){
      throw new FunctionError(503,'rubric_generator_not_configured','Blueprint generation is not configured.')
    }

    const generated=await callProvider(context,job,document,model)
    const draft=validateRubricDraft(generated.value)

    const created=await context.admin.rpc('create_interview_rubric_draft',{
      p_organization_id:input.organizationId,
      p_job_id:input.jobId,
      p_created_by:context.user.id,
      p_name:draft.name,
      p_source_document_id:document?.id??null,
      p_job_brief_hash:briefHash.data as string,
      p_ai_evaluation_id:evaluationId,
      p_items:draft.items,
    })
    if(created.error)throw new FunctionError(500,'rubric_persistence_failed','Could not save the blueprint draft.')

    await context.admin.from('ai_evaluations').update({
      status:'completed',input_tokens:generated.inputTokens,output_tokens:generated.outputTokens,
      duration_ms:Date.now()-started,completed_at:new Date().toISOString(),
    }).eq('id',evaluationId)

    // Identifiers and counts only. The job brief and the blueprint text never reach the logs.
    log('info','interview_rubric_generated',{
      requestId:requestID,organizationId:input.organizationId,jobId:input.jobId,
      rubricId:created.data,itemCount:draft.items.length,model,durationMs:Date.now()-started,
    })

    return json(request,{rubricId:created.data,itemCount:draft.items.length,status:'draft',requestId:requestID})
  }catch(error){
    const failure=error instanceof FunctionError?error
      :error instanceof RubricValidationError?new FunctionError(422,error.code,'The generated blueprint did not meet the required contract.')
      :providerBillingExhausted(error instanceof Error?error.message:'')?new FunctionError(503,'provider_billing_exhausted','The AI provider balance is exhausted.')
      :new FunctionError(500,'unexpected_error','Blueprint generation failed.')

    if(evaluationId){
      await recordFailure(request,evaluationId,failure,Date.now()-started).catch((bookkeeping)=>
        log('error','interview_rubric_bookkeeping_failed',{requestId:requestID,detail:bookkeeping instanceof Error?bookkeeping.message:String(bookkeeping)}))
    }
    log('error','interview_rubric_failed',{requestId:requestID,organizationId,code:failure.code,status:failure.status})
    return json(request,{error:{code:failure.code,message:failure.message,requestId:requestID}},failure.status)
  }
})

/* Both halves of the gate: the workspace switch and the permission. Checked against the CALLER's
 * client so RLS and the permission function see the real user, not the service role. */
async function requireBlueprintAccess(context:Context,organizationId:string){
  const [permitted,settings]=await Promise.all([
    context.caller.rpc('has_permission',{p_organization_id:organizationId,p_permission:'interview_intelligence.configure'}),
    context.caller.from('organization_settings').select('interview_intelligence_enabled,interview_rubric_generation_enabled').eq('organization_id',organizationId).maybeSingle(),
  ])
  if(permitted.error||!permitted.data)throw new FunctionError(403,'permission_denied','You do not have permission to configure interview blueprints.')
  if(!settings.data?.interview_intelligence_enabled)throw new FunctionError(403,'feature_disabled','Interview Intelligence is not enabled for this workspace.')
  // A separate switch from the feature itself: a workspace can keep blueprints and write them by hand
  // without ever calling a model.
  if(!settings.data?.interview_rubric_generation_enabled)throw new FunctionError(403,'rubric_generation_disabled','Blueprint generation is switched off for this workspace.')
}

async function enforceRubricRateLimits(context:Context,organizationId:string){
  const hourAgo=new Date(Date.now()-60*60*1000).toISOString()
  const [perUser,perOrg,monthlyTokens]=await Promise.all([
    context.admin.from('ai_evaluations').select('id',{count:'exact',head:true}).eq('requested_by',context.user.id).eq('evaluation_type','interview_rubric').gte('created_at',hourAgo),
    context.admin.from('ai_evaluations').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).eq('evaluation_type','interview_rubric').gte('created_at',hourAgo),
    context.admin.rpc('interview_rubric_token_spend_this_month',{p_organization_id:organizationId}),
  ])
  if((perUser.count??0)>=HOURLY_USER_LIMIT)throw new FunctionError(429,'rate_limited','You have generated too many blueprints in the last hour.')
  if((perOrg.count??0)>=HOURLY_ORG_LIMIT)throw new FunctionError(429,'rate_limited','This workspace has generated too many blueprints in the last hour.')
  if(Number(monthlyTokens.data??0)>=MONTHLY_ORG_TOKEN_CEILING)throw new FunctionError(429,'monthly_ceiling_reached','This workspace has reached its monthly AI limit for blueprints.')
}

/* Loads the job and, if one was chosen, the attached JD. Candidate data is never read here, and the
 * document must be linked to this job -- selecting an arbitrary organization document would let a JD
 * from an unrelated client shape this blueprint. */
async function loadBrief(context:Context,organizationId:string,jobId:string,documentId:string|null){
  const job=await context.caller.from('jobs')
    .select('id,title,description,requirements,location,employment_type,salary_min,salary_max,currency')
    .eq('id',jobId).eq('organization_id',organizationId).is('deleted_at',null).maybeSingle()
  if(job.error||!job.data)throw new FunctionError(404,'job_not_found','That job could not be found in this workspace.')

  const brief=`${job.data.description??''}${job.data.requirements??''}`
  if(brief.length>MAX_BRIEF_CHARACTERS)throw new FunctionError(413,'job_brief_too_long','This job description is too long to generate a blueprint from.')

  if(!documentId)return {job:job.data,document:null}

  const document=await context.caller.from('documents')
    .select('id,file_name,storage_path,mime_type,document_links!inner(job_id)')
    .eq('id',documentId).eq('organization_id',organizationId).is('deleted_at',null)
    .eq('document_links.job_id',jobId).maybeSingle()
  if(document.error||!document.data)throw new FunctionError(404,'job_document_not_found','That job description document could not be found on this job.')
  /* PDF only for now. parse-candidate-cv reaches DOCX through mammoth plus an image pass, and pulling
   * that path in here for a format nobody has asked for yet would be a lot of surface for no proven
   * need. A DOCX JD is rejected by name rather than silently ignored. */
  if(document.data.mime_type!=='application/pdf')throw new FunctionError(415,'unsupported_job_document','Attach the job description as a PDF, or generate from the job fields alone.')

  return {job:job.data,document:document.data}
}

async function callProvider(context:Context,job:Record<string,unknown>,document:{storage_path:string;file_name:string}|null,model:string){
  const payload:RubricSourcePayload={
    job:{
      title:String(job.title??''),
      description:(job.description as string|null)??null,
      requirements:(job.requirements as string|null)??null,
      location:(job.location as string|null)??null,
      employment_type:(job.employment_type as string|null)??null,
      salary_min:(job.salary_min as number|null)??null,
      salary_max:(job.salary_max as number|null)??null,
      currency:(job.currency as string|null)??null,
    },
    attached_document:document?{file_name:document.file_name}:null,
  }

  const content:Record<string,unknown>[]=[]
  if(document){
    const signed=await context.admin.storage.from(bucket).createSignedUrl(document.storage_path,300)
    if(signed.error||!signed.data)throw new FunctionError(500,'job_document_unreadable','The attached job description could not be read.')
    content.push({type:'document',source:{type:'url',url:signed.data.signedUrl}})
  }
  content.push({type:'text',text:buildRubricUserMessage(payload)})

  const response=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'x-api-key':Deno.env.get('ANTHROPIC_API_KEY')||'','anthropic-version':'2023-06-01','content-type':'application/json'},
    body:JSON.stringify({
      model,max_tokens:8000,thinking:{type:'disabled'},
      system:INTERVIEW_RUBRIC_SYSTEM_PROMPT,
      messages:[{role:'user',content}],
      output_config:{format:{type:'json_schema',schema:interviewRubricJsonSchema}},
    }),
  })

  const body=await response.json().catch(()=>null) as {content?:{type:string;text?:string}[];usage?:{input_tokens?:number;output_tokens?:number};error?:{message?:string}}|null
  if(!response.ok){
    const message=body?.error?.message||`Blueprint provider returned ${response.status}.`
    if(providerBillingExhausted(message))throw new FunctionError(503,'provider_billing_exhausted','The AI provider balance is exhausted.')
    throw new FunctionError(502,'provider_rejected',message)
  }
  const text=body?.content?.find((item)=>item.type==='text')?.text
  if(!text)throw new FunctionError(502,'empty_result','The blueprint generator returned no result.')

  let parsed:unknown
  try{parsed=JSON.parse(text)}
  catch{throw new FunctionError(502,'malformed_output','The blueprint generator returned unreadable output.')}

  return {value:parsed,inputTokens:body?.usage?.input_tokens??null,outputTokens:body?.usage?.output_tokens??null}
}

async function recordFailure(request:Request,evaluationId:string,failure:FunctionError,durationMs:number){
  const context=await requireUser(request)
  await context.admin.from('ai_evaluations').update({
    status:'failed',failure_code:failure.code,
    // The message is ours, never the provider's raw body or any brief content.
    failure_message:failure.message.slice(0,500),
    duration_ms:durationMs,completed_at:new Date().toISOString(),
  }).eq('id',evaluationId)
}
