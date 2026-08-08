import {FunctionError,requirePermission} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {resolveAccent} from '../_shared/branding.ts'
import {compatibilityRequestKey} from '../_shared/idempotency.ts'

interface SubmissionItem{job_candidate_id:string;candidate_summary:string;recruiter_comments?:string;expected_salary?:number;currency?:string;notice_period?:string;availability?:string;document_ids?:string[]}
interface Input{action?:'send'|'retry';deliveryId?:string;requestKey?:string;organizationId:string;jobId?:string;contactId?:string;title?:string;message?:string;items?:SubmissionItem[];recipientName?:string;recipientEmail?:string;expiryDays?:number}
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character]??character))

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request);const started=Date.now()
  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json() as Input
    if(!input.organizationId)throw new FunctionError(400,'invalid_request','Organization is required.')
    const {caller,admin}=await requirePermission(request,input.organizationId,'submissions.write')

    let deliveryId:string
    let packageId:string
    let jobId:string
    let title:string
    let message:string|undefined
    let recipientEmail:string
    let token:string
    let expiresAt:string
    let count:number

    if(input.action==='retry'){
      if(!input.deliveryId)throw new FunctionError(400,'invalid_request','Delivery is required.')
      const {data:delivery,error:deliveryError}=await admin.from('email_deliveries')
        .select('id,recipient_email,related_entity_id,email_type,status').eq('id',input.deliveryId)
        .eq('organization_id',input.organizationId).eq('email_type','client_submission').maybeSingle()
      if(deliveryError||!delivery?.related_entity_id)throw new FunctionError(404,'delivery_not_found','Submission delivery was not found.')
      if(delivery.status==='sent'||delivery.status==='delivered')throw new FunctionError(409,'delivery_already_sent','This submission email has already been sent.')
      const [{data:payload,error:payloadError},{data:pack,error:packageError}]=await Promise.all([
        admin.from('email_delivery_payloads').select('secret_token,expires_at').eq('delivery_id',delivery.id).eq('organization_id',input.organizationId).maybeSingle(),
        admin.from('submission_packages').select('id,job_id,title,message,public_submission_links(id,expires_at,revoked_at,created_at)').eq('id',delivery.related_entity_id).eq('organization_id',input.organizationId).maybeSingle(),
      ])
      if(payloadError||packageError||!payload||!pack)throw new FunctionError(409,'delivery_payload_missing','The saved delivery payload is unavailable.')
      const links=(pack.public_submission_links||[]) as {id:string;expires_at:string;revoked_at:string|null;created_at:string}[]
      const link=links.filter((entry)=>!entry.revoked_at&&new Date(entry.expires_at)>new Date()).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]
      if(!link)throw new FunctionError(409,'submission_link_inactive','The review link is no longer active. Send a fresh package instead.')
      const {count:candidateCount,error:countError}=await admin.from('candidate_submissions').select('id',{count:'exact',head:true}).eq('package_id',pack.id).eq('organization_id',input.organizationId)
      if(countError)throw new FunctionError(500,'submission_count_failed','Could not prepare the saved submission.')
      deliveryId=delivery.id;packageId=pack.id;jobId=pack.job_id;title=pack.title;message=pack.message||undefined
      recipientEmail=delivery.recipient_email;token=payload.secret_token
      expiresAt=payload.expires_at;count=candidateCount||0
      const {error:pendingError}=await admin.rpc('finalize_email_delivery',{p_delivery_id:deliveryId,p_status:'pending',p_provider_message_id:null,p_error_code:null,p_error_message:null})
      if(pendingError)throw new FunctionError(500,'delivery_status_failed','Could not prepare the saved delivery for retry.')
    }else{
      const requestedJobId=input.jobId;const requestedTitle=input.title?.trim();const requestedItems=input.items;const requestedEmail=input.recipientEmail
      if(!requestedJobId||!requestedTitle||!requestedItems?.length||!requestedEmail||!/^\S+@\S+\.\S+$/.test(requestedEmail))throw new FunctionError(400,'invalid_request','Vacancy, title, candidates, and recipient email are required.')
      const requestedKey=input.requestKey||await compatibilityRequestKey({organizationId:input.organizationId,jobId:requestedJobId,contactId:input.contactId||null,title:requestedTitle,message:input.message?.trim()||null,items:requestedItems,recipientName:input.recipientName?.trim()||null,recipientEmail:requestedEmail.trim().toLowerCase()})
      if(!input.requestKey)log('warn','submission.compatibility_request_key',{requestId:id,organizationId:input.organizationId})
      for(const item of requestedItems){
        if(!item.document_ids?.length)continue
        const assignment=await admin.from('job_candidates').select('candidate_id').eq('id',item.job_candidate_id).eq('organization_id',input.organizationId).eq('job_id',requestedJobId).maybeSingle()
        if(assignment.error||!assignment.data)throw new FunctionError(400,'invalid_submission_candidate','A selected candidate is not attached to this vacancy.')
        const uniqueIds=[...new Set(item.document_ids)]
        const documents=await admin.from('document_links').select('document_id,documents!inner(organization_id,deleted_at)').eq('organization_id',input.organizationId).eq('candidate_id',assignment.data.candidate_id).in('document_id',uniqueIds)
        const valid=new Set((documents.data||[]).filter((row)=>{const document=row.documents as unknown as {organization_id:string;deleted_at:string|null};return document.organization_id===input.organizationId&&!document.deleted_at}).map((row)=>row.document_id))
        if(documents.error||valid.size!==uniqueIds.length)throw new FunctionError(400,'invalid_submission_document','Every selected document must belong to this candidate and organization.')
        item.document_ids=uniqueIds
      }
      const normalizedEmail=requestedEmail.trim().toLowerCase()
      const {data,error}=await caller.rpc('create_submission_delivery',{p_organization_id:input.organizationId,p_job_id:requestedJobId,p_request_key:requestedKey,p_contact_id:input.contactId||null,p_title:requestedTitle,p_message:input.message?.trim()||null,p_items:requestedItems,p_recipient_name:input.recipientName?.trim()||null,p_recipient_email:normalizedEmail,p_expiry_days:Math.min(30,Math.max(1,input.expiryDays||7))})
      if(error)throw new FunctionError(400,'submission_failed',error.message)
      const result=data as {package_id:string;delivery_id:string;token:string;expires_at:string}
      // A request key may legitimately arrive twice after a browser/network
      // timeout. Rehydrate the canonical first request instead of combining its
      // saved token with changed fields from a later request using the same key.
      const [{data:delivery,error:deliveryError},{data:pack,error:packageError},{count:candidateCount,error:countError}]=await Promise.all([
        admin.from('email_deliveries').select('id,recipient_email,related_entity_id').eq('id',result.delivery_id)
          .eq('organization_id',input.organizationId).eq('email_type','client_submission').eq('related_entity_id',result.package_id).maybeSingle(),
        admin.from('submission_packages').select('id,job_id,title,message').eq('id',result.package_id).eq('organization_id',input.organizationId).maybeSingle(),
        admin.from('candidate_submissions').select('id',{count:'exact',head:true}).eq('package_id',result.package_id).eq('organization_id',input.organizationId),
      ])
      if(deliveryError||packageError||countError||!delivery||!pack)throw new FunctionError(409,'delivery_payload_missing','The saved submission delivery is unavailable.')
      deliveryId=delivery.id;packageId=pack.id;jobId=pack.job_id;title=pack.title;message=pack.message||undefined
      recipientEmail=delivery.recipient_email;token=result.token
      expiresAt=result.expires_at;count=candidateCount||0
    }

    const activeLink=await admin.from('public_submission_links').select('id').eq('package_id',packageId)
      .eq('organization_id',input.organizationId).is('revoked_at',null).gt('expires_at',new Date().toISOString()).limit(1).maybeSingle()
    if(activeLink.error||!activeLink.data)throw new FunctionError(409,'submission_link_inactive','The review link is no longer active. Send a fresh package instead.')

    const [{data:organization},{data:job},{data:branding}]=await Promise.all([
      caller.from('organizations').select('name').eq('id',input.organizationId).single(),
      caller.from('jobs').select('title').eq('id',jobId).single(),
      caller.from('organization_settings').select('primary_color').eq('organization_id',input.organizationId).maybeSingle(),
    ])
    const accent=resolveAccent(branding?.primary_color)
    const origin=(Deno.env.get('APP_ORIGIN')||'http://127.0.0.1:5173').split(',')[0].trim().replace(/\/$/,'')
    const reviewUrl=`${origin}/review/${encodeURIComponent(token)}`
    const fallbackMessage=`Please review ${count===1?'a candidate':`${count} candidates`} for ${String(job?.title||'the vacancy')}.`
    const resendKey=Deno.env.get('RESEND_API_KEY');let providerMessageId:string|undefined;let deliveryStatus='sent';let errorMessage:string|undefined
    if(resendKey){
      try{
        const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json','Idempotency-Key':`client-submission-${deliveryId}`},body:JSON.stringify({from:Deno.env.get('EMAIL_FROM')||'Agency ATS <onboarding@resend.dev>',to:[recipientEmail],subject:`${organization?.name||'Recruitment team'}: ${title}`,html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message||fallbackMessage)}</p><p><a href="${reviewUrl}" style="display:inline-block;background:${accent};color:white;padding:12px 18px;border-radius:8px;text-decoration:none">Review candidates securely</a></p><p>This confidential link expires on ${new Date(expiresAt).toLocaleDateString('en-GB')}.</p></div>`})})
        const body=await response.json().catch(()=>({})) as {id?:string;message?:string}
        if(!response.ok){deliveryStatus='failed';errorMessage=body.message||'Email provider rejected the submission.'}else providerMessageId=body.id
      }catch(error){deliveryStatus='failed';errorMessage=error instanceof Error?error.message:'Email provider could not be reached.'}
    }else if((Deno.env.get('ENVIRONMENT')||'development')==='production'){
      deliveryStatus='failed';errorMessage='Production email is not configured.'
    }else deliveryStatus='pending'

    const {data:savedStatus,error:statusError}=await admin.rpc('finalize_email_delivery',{p_delivery_id:deliveryId,p_status:deliveryStatus,
      p_provider_message_id:providerMessageId||null,p_error_code:deliveryStatus==='failed'?'email_delivery_failed':null,p_error_message:errorMessage||null})
    if(statusError)throw new FunctionError(500,'delivery_status_failed','The email result could not be saved. Retry safely with the existing delivery.')
    deliveryStatus=String(savedStatus)
    if(deliveryStatus==='sent'||deliveryStatus==='delivered')errorMessage=undefined
    log(deliveryStatus==='failed'?'error':'info','submission.delivery_finished',{requestId:id,organizationId:input.organizationId,packageId,deliveryId,deliveryStatus,durationMs:Date.now()-started})
    return json(request,{packageId,deliveryId,expiresAt,deliveryStatus,errorMessage,...(deliveryStatus==='pending'?{previewUrl:reviewUrl}:{})},input.action==='retry'?200:201)
  }catch(error){
    const known=error instanceof FunctionError;log('error','submission.failed',{requestId:id,code:known?error.code:'unexpected_error',durationMs:Date.now()-started})
    return json(request,{error:{code:known?error.code:'unexpected_error',message:known?error.message:'Could not send submission.',requestId:id}},known?error.status:500)
  }
})
