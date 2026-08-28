import {FunctionError,serviceClient} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {isAuthorized} from '../scheduled-maintenance/authorization.ts'
import {digestSubject,renderDigestHtml,renderDigestText,type DigestContent} from '../_shared/interview-digest.ts'

/* Release B2: the daily owner brief.
 *
 * Driven by the hourly maintenance sweep rather than by a scheduler of its own -- the plan forbids a
 * second background-job system, and "is it past 17:30 in this workspace and has today's brief gone
 * out?" is exactly the question an hourly sweep is for.
 *
 * The ordering here is the delivery guarantee. The run row is claimed FIRST, on a unique constraint
 * over (organization, local report date), so a slow send, a retry, or two workers waking together
 * cannot produce a second copy of the same brief. Only then is anything aggregated or sent.
 */

const MAX_ORGANIZATIONS_PER_INVOCATION=10

interface ClaimResult {
  claimed:boolean
  reason?:string
  run_id?:string
  report_date?:string
  range_started_at?:string
  range_ended_at?:string
  recipient_count?:number
}

/* Whether a brief has anything in it worth an owner's attention.
 *
 * Deliberately not "did anything happen at all": outstanding coaching actions carried over from
 * previous days count, because an action nobody has picked up for a week is the single most useful
 * thing a daily brief can surface. A day with no interviews and no outstanding work is genuinely
 * empty, and sending that trains people to stop opening it.
 */
export function digestIsEmpty(content:DigestContent):boolean{
  return content.analysed_interviews===0
    && content.attention_findings===0
    && content.processing_failures===0
    && content.coaching.open===0
    && content.coaching.acknowledged===0
    && content.coaching.overdue===0
}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request)

  try{
    if(!isAuthorized(request.headers,{
      workerSecret:Deno.env.get('WORKER_SECRET')??null,
      serviceRoleKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??null,
    })){
      throw new FunctionError(401,'unauthorized','This endpoint is for the scheduled worker.')
    }

    const admin=serviceClient()
    const due=await admin.rpc('due_interview_digest_organizations',{p_limit:MAX_ORGANIZATIONS_PER_INVOCATION})
    if(due.error)throw due.error

    const organizations=(due.data||[]) as {organization_id:string}[]
    const sent:string[]=[]
    const skipped:string[]=[]
    const failed:string[]=[]

    for(const row of organizations){
      const organizationId=row.organization_id
      const claim=await admin.rpc('claim_interview_digest_run',{p_organization_id:organizationId})
      if(claim.error){failed.push(organizationId);log('error','digest.claim_failed',{requestId:id,organizationId});continue}
      const claimed=claim.data as ClaimResult
      // "Not due yet", "already sent today", "no recipients" -- all ordinary, all silent.
      if(!claimed.claimed)continue

      const runId=String(claimed.run_id)
      try{
        const built=await admin.rpc('build_interview_digest_content',{
          p_organization_id:organizationId,
          p_from:claimed.range_started_at,
          p_to:claimed.range_ended_at,
        })
        if(built.error)throw built.error
        const content=built.data as DigestContent

        const settings=await admin.from('organization_settings')
          .select('interview_digest_skip_empty').eq('organization_id',organizationId).single()
        const skipEmpty=settings.data?.interview_digest_skip_empty??true

        if(skipEmpty&&digestIsEmpty(content)){
          /* Recorded as a real outcome rather than silently dropped, and the aggregation window still
           * advances -- an empty period was reviewed. Leaving it open would make the next brief cover
           * two days, which the 36-hour cap would then truncate, quietly costing coverage. */
          await admin.rpc('finalize_interview_digest_run',{p_run_id:runId,p_status:'skipped_empty',p_content:content})
          skipped.push(organizationId)
          continue
        }

        const recipients=await resolveRecipients(admin,organizationId)
        if(recipients.length===0){
          await admin.rpc('finalize_interview_digest_run',{p_run_id:runId,p_status:'skipped_empty',p_content:content})
          skipped.push(organizationId)
          continue
        }

        const organization=await admin.from('organizations').select('name,slug').eq('id',organizationId).single()
        const appUrl=Deno.env.get('APP_URL')||''
        const html=renderDigestHtml(content,{
          organizationName:organization.data?.name||'your workspace',
          reportDate:String(claimed.report_date),
          scorecardUrl:appUrl&&organization.data?.slug?`${appUrl}/app/${organization.data.slug}/scorecard`:null,
          todayUrl:appUrl&&organization.data?.slug?`${appUrl}/app/${organization.data.slug}/today`:null,
        })

        const delivered=await deliver(admin,{
          organizationId,runId,recipients,
          subject:digestSubject(content,String(claimed.report_date)),
          html,text:renderDigestText(content),
        })

        if(delivered.failures===recipients.length){
          await admin.rpc('finalize_interview_digest_run',{
            p_run_id:runId,p_status:'failed',p_content:content,p_error_message:'email_provider_rejected'})
          failed.push(organizationId)
        }else{
          await admin.rpc('finalize_interview_digest_run',{p_run_id:runId,p_status:'sent',p_content:content})
          sent.push(organizationId)
        }
      }catch(error){
        /* The run row already exists, so the date stays claimed and tomorrow's brief still covers this
         * period through last_success_at, which a failure does not advance. */
        await admin.rpc('finalize_interview_digest_run',{
          p_run_id:runId,p_status:'failed',p_content:null,
          p_error_message:error instanceof Error?error.name:'digest_failed'})
        failed.push(organizationId)
        log('error','digest.build_failed',{requestId:id,organizationId})
      }
    }

    log('info','digest.sweep_completed',{
      requestId:id,considered:organizations.length,sent:sent.length,skipped:skipped.length,failed:failed.length})
    return json(request,{sent:sent.length,skipped:skipped.length,failed:failed.length})
  }catch(error){
    const known=error instanceof FunctionError
    log('error','digest.sweep_failed',{requestId:id,code:known?error.code:'unexpected_error'})
    return json(request,{error:{
      code:known?error.code:'unexpected_error',
      message:known?error.message:'The interview digest sweep could not run.',
      requestId:id,
    }},known?error.status:500)
  }
})

/* Recipient addresses come from auth, not from a column somebody could edit into a redirect. Only
 * active members, re-checked at send time rather than trusted from when they were added. */
async function resolveRecipients(admin:ReturnType<typeof serviceClient>,organizationId:string){
  const rows=await admin.from('interview_digest_recipients')
    .select('member_id,organization_members!inner(user_id,status)')
    .eq('organization_id',organizationId)
  if(rows.error)throw rows.error

  const userIds=(rows.data||[])
    .filter((row)=>(row.organization_members as {status?:string}|null)?.status==='active')
    .map((row)=>(row.organization_members as {user_id?:string}|null)?.user_id)
    .filter((value):value is string=>Boolean(value))

  const addresses:{userId:string;email:string}[]=[]
  for(const userId of userIds){
    const {data}=await admin.auth.admin.getUserById(userId)
    const email=data.user?.email
    if(email)addresses.push({userId,email})
  }
  return addresses
}

/* One delivery row per recipient, written before the provider is called, then finalized with the
 * outcome -- the same durable path invitations and submissions use. request_key makes a retry of the
 * same run reuse the same row rather than mailing somebody twice. */
async function deliver(admin:ReturnType<typeof serviceClient>,input:{
  organizationId:string
  runId:string
  recipients:{userId:string;email:string}[]
  subject:string
  html:string
  text:string
}){
  const resendKey=Deno.env.get('RESEND_API_KEY')
  const production=(Deno.env.get('ENVIRONMENT')||'development')==='production'
  let failures=0

  for(const recipient of input.recipients){
    const delivery=await admin.from('email_deliveries').upsert({
      organization_id:input.organizationId,
      email_type:'interview_quality_digest',
      recipient_email:recipient.email,
      status:'pending',
      related_entity_type:'interview_digest_run',
      related_entity_id:input.runId,
      request_key:input.runId,
    },{onConflict:'organization_id,email_type,request_key'}).select('id,status').single()
    if(delivery.error){failures+=1;continue}
    if(['sent','delivered'].includes(String(delivery.data.status)))continue

    let status='sent';let providerMessageId:string|undefined;let errorMessage:string|undefined
    if(!resendKey){
      status=production?'failed':'pending'
      errorMessage=production?'Production email is not configured.':undefined
    }else try{
      const response=await fetch('https://api.resend.com/emails',{
        method:'POST',
        headers:{
          Authorization:`Bearer ${resendKey}`,
          'Content-Type':'application/json',
          // Keyed on the run and the recipient, so a provider-side retry cannot duplicate the brief.
          'Idempotency-Key':`interview-digest-${input.runId}-${recipient.userId}`,
        },
        body:JSON.stringify({
          from:Deno.env.get('EMAIL_FROM')||'Agency ATS <onboarding@resend.dev>',
          to:[recipient.email],
          subject:input.subject,
          html:input.html,
          text:input.text,
        }),
      })
      const body=await response.json().catch(()=>({})) as {id?:string;message?:string}
      if(!response.ok){status='failed';errorMessage='Email provider rejected the digest.'}
      else providerMessageId=body.id
    }catch{
      status='failed';errorMessage='Email provider could not be reached.'
    }

    if(status==='failed')failures+=1
    await admin.rpc('finalize_email_delivery',{
      p_delivery_id:delivery.data.id,
      p_status:status,
      p_provider_message_id:providerMessageId||null,
      p_error_code:status==='failed'?'email_send_failed':null,
      p_error_message:errorMessage||null,
    })
  }
  return {failures}
}
