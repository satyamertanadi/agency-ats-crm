import {FunctionError,requirePermission} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'

interface SubmissionItem{job_candidate_id:string;candidate_summary:string;recruiter_comments?:string;expected_salary?:number;currency?:string;notice_period?:string;availability?:string;document_ids?:string[]}
interface Input{organizationId:string;jobId:string;contactId?:string;title:string;message?:string;items:SubmissionItem[];recipientName?:string;recipientEmail:string;expiryDays?:number}
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character]??character))

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request);const started=Date.now()
  try{
    const input=await request.json() as Input
    if(!input.organizationId||!input.jobId||!input.title?.trim()||!input.items?.length||!/^\S+@\S+\.\S+$/.test(input.recipientEmail||''))throw new FunctionError(400,'invalid_request','Vacancy, title, candidates, and recipient email are required.')
    const {caller,admin,user}=await requirePermission(request,input.organizationId,'submissions.write')
    for(const item of input.items){
      if(!item.document_ids?.length)continue
      const assignment=await admin.from('job_candidates').select('candidate_id').eq('id',item.job_candidate_id).eq('organization_id',input.organizationId).eq('job_id',input.jobId).maybeSingle()
      if(assignment.error||!assignment.data)throw new FunctionError(400,'invalid_submission_candidate','A selected candidate is not attached to this vacancy.')
      const uniqueIds=[...new Set(item.document_ids)]
      const documents=await admin.from('document_links').select('document_id,documents!inner(organization_id,deleted_at)').eq('organization_id',input.organizationId).eq('candidate_id',assignment.data.candidate_id).in('document_id',uniqueIds)
      const valid=new Set((documents.data||[]).filter((row)=>{const document=row.documents as unknown as {organization_id:string;deleted_at:string|null};return document.organization_id===input.organizationId&&!document.deleted_at}).map((row)=>row.document_id))
      if(documents.error||valid.size!==uniqueIds.length)throw new FunctionError(400,'invalid_submission_document','Every selected document must belong to this candidate and organization.')
      item.document_ids=uniqueIds
    }
    const {data,error}=await caller.rpc('create_submission_package',{p_organization_id:input.organizationId,p_job_id:input.jobId,p_contact_id:input.contactId||null,p_title:input.title.trim(),p_message:input.message?.trim()||null,p_items:input.items,p_recipient_name:input.recipientName?.trim()||null,p_recipient_email:input.recipientEmail.trim().toLowerCase(),p_expiry_days:Math.min(30,Math.max(1,input.expiryDays||7))})
    if(error)throw new FunctionError(400,'submission_failed',error.message)
    const result=data as {package_id:string;link_id:string;token:string;expires_at:string}
    const [{data:organization},{data:job}]=await Promise.all([caller.from('organizations').select('name').eq('id',input.organizationId).single(),caller.from('jobs').select('title,companies(name)').eq('id',input.jobId).single()])
    const origin=(Deno.env.get('APP_ORIGIN')||'http://127.0.0.1:5173').split(',')[0].trim().replace(/\/$/,'');const reviewUrl=`${origin}/review/${encodeURIComponent(result.token)}`
    /* The package has always accepted an array; only the UI was singular, so this default was written
     * when it could never be more than one candidate. It says how many now, because "review
     * candidates" tells a client nothing about whether opening the link is a two-minute job or a
     * shortlist to work through. Candidate names stay out of the email body: the link is the
     * confidential surface, and an unencrypted inbox is not where they should first appear. */
    const count=input.items.length;const fallbackMessage=`Please review ${count===1?'a candidate':`${count} candidates`} for ${String(job?.title||'the vacancy')}.`
    const resendKey=Deno.env.get('RESEND_API_KEY');let providerMessageId:string|undefined;let deliveryStatus='sent'
    if(resendKey){const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json','Idempotency-Key':`client-submission-${result.link_id}`},body:JSON.stringify({from:Deno.env.get('EMAIL_FROM')||'Agency ATS <onboarding@resend.dev>',to:[input.recipientEmail.trim().toLowerCase()],subject:`${organization?.name||'Recruitment team'}: ${input.title.trim()}`,html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>${escapeHtml(input.title.trim())}</h1><p>${escapeHtml(input.message?.trim()||fallbackMessage)}</p><p><a href="${reviewUrl}" style="display:inline-block;background:#236c64;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">Review candidates securely</a></p><p>This confidential link expires on ${new Date(result.expires_at).toLocaleDateString('en-GB')}.</p></div>`})});const body=await response.json().catch(()=>({})) as {id?:string;message?:string};if(!response.ok)throw new FunctionError(502,'email_delivery_failed',body.message||'Email provider rejected the submission.');providerMessageId=body.id}else if((Deno.env.get('ENVIRONMENT')||'development')==='production')throw new FunctionError(500,'email_not_configured','Production email is not configured.');else deliveryStatus='pending'
    await admin.from('email_deliveries').insert({organization_id:input.organizationId,email_type:'client_submission',recipient_email:input.recipientEmail.trim().toLowerCase(),provider_message_id:providerMessageId||null,status:deliveryStatus,related_entity_type:'public_submission_link',related_entity_id:result.link_id,requested_by:user.id})
    log('info','submission.sent',{requestId:id,organizationId:input.organizationId,packageId:result.package_id,deliveryStatus,durationMs:Date.now()-started})
    return json(request,{packageId:result.package_id,expiresAt:result.expires_at,deliveryStatus,...(deliveryStatus==='pending'?{previewUrl:reviewUrl}:{})},201)
  }catch(error){const known=error instanceof FunctionError;log('error','submission.failed',{requestId:id,code:known?error.code:'unexpected_error',durationMs:Date.now()-started});return json(request,{error:{code:known?error.code:'unexpected_error',message:known?error.message:'Could not send submission.',requestId:id}},known?error.status:500)}
})
