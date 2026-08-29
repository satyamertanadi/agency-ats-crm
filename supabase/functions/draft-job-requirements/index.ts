import {FunctionError,requireUser} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {providerBillingExhausted} from '../_shared/provider-outage.ts'
import {
  buildJobRequirementsUserMessage,
  JOB_REQUIREMENTS_PROMPT_VERSION,
  JOB_REQUIREMENTS_SYSTEM_PROMPT,
  jobRequirementsJsonSchema,
  JobRequirementsValidationError,
  validateJobRequirementsDraft,
  type JobRequirementsSourcePayload,
} from '../_shared/job-requirements-schema.ts'

/* Proposes a requirement set for one job from its brief and any attached JD.
 *
 * Three things this endpoint deliberately does not do. It never writes job_requirements -- the
 * recruiter edits the proposal and saves it through replace_job_requirements, so nothing a model
 * produced is ever scored against a candidate without a human having looked at it. It never writes
 * back into the job's own fields. And it never loads a candidate: requirements describe the role, and
 * letting candidate data into this prompt is how a requirement set quietly becomes a description of
 * whoever happened to be in the pipeline when it was drafted.
 *
 * Structurally this is generate-interview-rubric with a different contract; the cost controls, the
 * untrusted-source handling and the ai_evaluations bookkeeping are deliberately the same shape.
 */

interface Input {organizationId?:string;jobId?:string;documentId?:string|null}
type Context=Awaited<ReturnType<typeof requireUser>>

const bucket='candidate-documents'
const HOURLY_USER_LIMIT=15
const HOURLY_ORG_LIMIT=60
/* A job description is prose, not a corpus. Anything past this is a pasted handbook, and sending it
 * would spend real money on tokens that make the requirement set worse, not better. */
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
    await requireDraftingAccess(context,input.organizationId)
    await enforceDraftingRateLimits(context,input.organizationId)

    const {job,document}=await loadBrief(context,input.organizationId,input.jobId,input.documentId??null)

    /* Reuses the interview brief fingerprint rather than adding a second one. It already hashes
     * exactly this input -- title, description, requirements, location, employment type, salary band
     * and the attached document -- and two hash functions over the same fields is how they drift. It
     * is recorded for auditing only; unlike profile generation, drafting never serves from cache,
     * because the recruiter clicking the button is asking for a fresh proposal. */
    const briefHash=await context.caller.rpc('interview_job_brief_hash',{p_job_id:input.jobId,p_document_id:document?.id??null})

    const provider=Deno.env.get('AI_PROVIDER')?.trim()||'anthropic'
    /* Extraction, not judgment -- the same class of work as CV parsing, so it runs on the cheap parse
     * model rather than the evaluation model that generate-candidate-profile needs. */
    const model=Deno.env.get('AI_MODEL_PARSE')?.trim()||Deno.env.get('AI_MODEL')?.trim()||''

    const evaluation=await context.admin.from('ai_evaluations').insert({
      organization_id:input.organizationId,candidate_id:null,job_id:input.jobId,
      evaluation_type:'job_requirements_draft',provider,model:model||'unconfigured',
      prompt_version:JOB_REQUIREMENTS_PROMPT_VERSION,status:'processing',
      input_hash:(briefHash.data as string|null)??null,
      input_versions:{job_brief_hash:briefHash.data??null,prompt_version:JOB_REQUIREMENTS_PROMPT_VERSION,document_id:document?.id??null},
      requested_by:context.user.id,
    }).select('id').single()
    if(evaluation.error||!evaluation.data)throw new FunctionError(500,'evaluation_persistence_failed','Could not start a tracked requirement draft.')
    evaluationId=evaluation.data.id

    if(provider!=='anthropic'||!model||!Deno.env.get('ANTHROPIC_API_KEY')){
      throw new FunctionError(503,'requirements_drafter_not_configured','Requirement drafting is not configured.')
    }

    const generated=await callProvider(context,job,document,model)
    const draft=validateJobRequirementsDraft(generated.value)

    await context.admin.from('ai_evaluations').update({
      status:'completed',input_tokens:generated.inputTokens??0,output_tokens:generated.outputTokens??0,
      duration_ms:Date.now()-started,completed_at:new Date().toISOString(),
    }).eq('id',evaluationId)

    // Identifiers and counts only. The job brief and the drafted requirement text never reach the logs.
    log('info','job_requirements_drafted',{
      requestId:requestID,organizationId:input.organizationId,jobId:input.jobId,
      requirementCount:draft.requirements.length,documentAttached:Boolean(document),
      model,durationMs:Date.now()-started,
    })

    // Proposals only. Nothing here is persisted until the recruiter saves.
    return json(request,{requirements:draft.requirements,evaluationId,requestId:requestID})
  }catch(error){
    const failure=error instanceof FunctionError?error
      :error instanceof JobRequirementsValidationError?new FunctionError(422,error.code,drafterMessage(error))
      :providerBillingExhausted(error instanceof Error?error.message:'')?new FunctionError(503,'provider_billing_exhausted','The AI provider balance is exhausted.')
      :new FunctionError(500,'unexpected_error','Requirement drafting failed.')

    if(evaluationId){
      await recordFailure(request,evaluationId,failure,Date.now()-started).catch((bookkeeping)=>
        log('error','job_requirements_bookkeeping_failed',{requestId:requestID,detail:bookkeeping instanceof Error?bookkeeping.message:String(bookkeeping)}))
    }
    log('error','job_requirements_draft_failed',{requestId:requestID,organizationId,code:failure.code,status:failure.status})
    return json(request,{error:{code:failure.code,message:failure.message,requestId:requestID}},failure.status)
  }
})

/* The prohibited-category rejection is the one validation failure a recruiter can act on, so it says
 * what happened. Everything else is a contract failure they cannot fix from the job page. */
function drafterMessage(error:JobRequirementsValidationError){
  return error.code==='prohibited_inference'
    ? 'This job description states criteria that cannot be used to assess candidates, such as age or gender. Remove them from the description and try again, or add the requirements by hand.'
    : 'The drafted requirements did not meet the required contract.'
}

/* jobs.write rather than jobs.read: this produces rows the recruiter is about to save onto the job,
 * and it spends money on the shared provider key. A read-only member has no use for a proposal they
 * cannot store. ai.use is the workspace-wide switch every model call in this codebase checks. */
async function requireDraftingAccess(context:Context,organizationId:string){
  for(const permission of ['jobs.write','ai.use']){
    const {data,error}=await context.caller.rpc('has_permission',{p_organization_id:organizationId,p_permission:permission})
    if(error||!data)throw new FunctionError(403,'permission_denied','You do not have permission to draft job requirements.')
  }
}

/* Hourly counters only, no monthly token ceiling. Drafting runs on the cheap parse model over a
 * bounded brief and produces at most 40 short rows, so its per-call cost is closer to a CV parse than
 * to a profile generation -- and every call still lands in ai_evaluations, so if that assumption turns
 * out to be wrong the spend is visible in the same place as everything else. Watch rate_limited in the
 * logs and add a ceiling if real usage argues for one. */
async function enforceDraftingRateLimits(context:Context,organizationId:string){
  const hourAgo=new Date(Date.now()-60*60*1000).toISOString()
  const [perUser,perOrg]=await Promise.all([
    context.admin.from('ai_evaluations').select('id',{count:'exact',head:true}).eq('requested_by',context.user.id).eq('evaluation_type','job_requirements_draft').gte('created_at',hourAgo),
    context.admin.from('ai_evaluations').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).eq('evaluation_type','job_requirements_draft').gte('created_at',hourAgo),
  ])
  if((perUser.count??0)>=HOURLY_USER_LIMIT)throw new FunctionError(429,'rate_limited','You have drafted requirements too many times in the last hour.')
  if((perOrg.count??0)>=HOURLY_ORG_LIMIT)throw new FunctionError(429,'rate_limited','This workspace has drafted requirements too many times in the last hour.')
}

/* Loads the job and, if one was chosen, the attached JD. Candidate data is never read here, and the
 * document must be linked to this job -- selecting an arbitrary organization document would let a JD
 * from an unrelated client shape this vacancy's requirements. */
async function loadBrief(context:Context,organizationId:string,jobId:string,documentId:string|null){
  const job=await context.caller.from('jobs')
    .select('id,title,description,requirements,location,employment_type,salary_min,salary_max,currency')
    .eq('id',jobId).eq('organization_id',organizationId).is('deleted_at',null).maybeSingle()
  if(job.error||!job.data)throw new FunctionError(404,'job_not_found','That job could not be found in this workspace.')

  const brief=`${job.data.description??''}${job.data.requirements??''}`
  if(brief.length>MAX_BRIEF_CHARACTERS)throw new FunctionError(413,'job_brief_too_long','This job description is too long to draft requirements from.')
  // Without a description and without an attached JD there is nothing to extract from, and the model
  // would answer by inventing a plausible requirement set for the job title. That is exactly the
  // failure this whole feature exists to remove, so it is refused rather than served.
  if(!brief.trim()&&!documentId)throw new FunctionError(400,'job_brief_empty','Add a job description, or attach a JD, before drafting requirements.')

  if(!documentId)return {job:job.data,document:null}

  const document=await context.caller.from('documents')
    .select('id,file_name,storage_path,mime_type,document_links!inner(job_id)')
    .eq('id',documentId).eq('organization_id',organizationId).is('deleted_at',null)
    .eq('document_links.job_id',jobId).maybeSingle()
  if(document.error||!document.data)throw new FunctionError(404,'job_document_not_found','That job description document could not be found on this job.')
  /* PDF only, matching generate-interview-rubric. parse-candidate-cv reaches DOCX through mammoth
   * plus an image pass; pulling that path in here would be a lot of surface for a format the JD
   * upload already steers away from. A DOCX JD is rejected by name rather than silently ignored. */
  if(document.data.mime_type!=='application/pdf')throw new FunctionError(415,'unsupported_job_document','Attach the job description as a PDF, or draft from the job fields alone.')

  return {job:job.data,document:document.data}
}

async function callProvider(context:Context,job:Record<string,unknown>,document:{storage_path:string;file_name:string}|null,model:string){
  const payload:JobRequirementsSourcePayload={
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
  content.push({type:'text',text:buildJobRequirementsUserMessage(payload)})

  // thinking disabled for the same reason as every other structured-extraction call here: adaptive
  // thinking can consume the whole max_tokens budget and leave no text block for the JSON output.
  const response=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'x-api-key':Deno.env.get('ANTHROPIC_API_KEY')||'','anthropic-version':'2023-06-01','content-type':'application/json'},
    body:JSON.stringify({
      model,max_tokens:4000,thinking:{type:'disabled'},
      system:JOB_REQUIREMENTS_SYSTEM_PROMPT,
      messages:[{role:'user',content}],
      output_config:{format:{type:'json_schema',schema:jobRequirementsJsonSchema}},
    }),
  })

  const body=await response.json().catch(()=>null) as {content?:{type:string;text?:string}[];usage?:{input_tokens?:number;output_tokens?:number};error?:{message?:string}}|null
  if(!response.ok){
    const message=body?.error?.message||`Requirement drafter returned ${response.status}.`
    if(providerBillingExhausted(message))throw new FunctionError(503,'provider_billing_exhausted','The AI provider balance is exhausted.')
    throw new FunctionError(response.status===429?429:502,response.status===429?'provider_rate_limited':'provider_rejected',message)
  }
  const text=body?.content?.find((item)=>item.type==='text')?.text
  if(!text)throw new FunctionError(502,'empty_result','The requirement drafter returned no result.')

  let parsed:unknown
  try{parsed=JSON.parse(text)}
  catch{throw new FunctionError(502,'malformed_output','The requirement drafter returned unreadable output.')}

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
