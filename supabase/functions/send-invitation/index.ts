import {FunctionError,requirePermission} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {compatibilityRequestKey} from '../_shared/idempotency.ts'

interface Input{action?:'send'|'retry';organizationId:string;email?:string;roleId?:string;deliveryId?:string;requestKey?:string}
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character]??character))

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request);const started=Date.now()
  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json() as Input
    if(!input.organizationId)throw new FunctionError(400,'invalid_request','Organization is required.')
    const {caller,admin}=await requirePermission(request,input.organizationId,'organization.manage')
    let invitationId:string;let deliveryId:string;let email:string;let roleId:string;let token:string;let expiresAt:string

    if(input.action==='retry'){
      if(!input.deliveryId)throw new FunctionError(400,'invalid_request','Delivery is required.')
      const {data:delivery,error:deliveryError}=await admin.from('email_deliveries').select('id,recipient_email,related_entity_id,status')
        .eq('id',input.deliveryId).eq('organization_id',input.organizationId).eq('email_type','team_invitation').maybeSingle()
      if(deliveryError||!delivery?.related_entity_id)throw new FunctionError(404,'delivery_not_found','Invitation delivery was not found.')
      if(delivery.status==='sent'||delivery.status==='delivered')throw new FunctionError(409,'delivery_already_sent','This invitation email has already been sent.')
      const [{data:payload,error:payloadError},{data:invitation,error:invitationError}]=await Promise.all([
        admin.from('email_delivery_payloads').select('secret_token,expires_at').eq('delivery_id',delivery.id).eq('organization_id',input.organizationId).maybeSingle(),
        admin.from('organization_invitations').select('id,role_id,revoked_at,accepted_at').eq('id',delivery.related_entity_id).eq('organization_id',input.organizationId).maybeSingle(),
      ])
      if(payloadError||invitationError||!payload||!invitation)throw new FunctionError(409,'delivery_payload_missing','The saved invitation payload is unavailable.')
      if(invitation.revoked_at||invitation.accepted_at||new Date(payload.expires_at)<=new Date())throw new FunctionError(409,'invitation_inactive','This invitation is no longer active.')
      invitationId=invitation.id;deliveryId=delivery.id;email=delivery.recipient_email;roleId=invitation.role_id;token=payload.secret_token;expiresAt=payload.expires_at
      const {error:pendingError}=await admin.rpc('finalize_email_delivery',{p_delivery_id:deliveryId,p_status:'pending',p_provider_message_id:null,p_error_code:null,p_error_message:null})
      if(pendingError)throw new FunctionError(500,'delivery_status_failed','Could not prepare the saved invitation for retry.')
    }else{
      const inviteEmail=input.email;const requestedRoleId=input.roleId
      if(!requestedRoleId||!inviteEmail||!/^\S+@\S+\.\S+$/.test(inviteEmail))throw new FunctionError(400,'invalid_request','Role and a valid email are required.')
      const requestedKey=input.requestKey||await compatibilityRequestKey({organizationId:input.organizationId,email:inviteEmail.trim().toLowerCase(),roleId:requestedRoleId})
      if(!input.requestKey)log('warn','invitation.compatibility_request_key',{requestId:id,organizationId:input.organizationId})
      const {data,error}=await caller.rpc('create_invitation_delivery',{p_organization_id:input.organizationId,p_email:inviteEmail,p_role_id:requestedRoleId,p_request_key:requestedKey,p_expiry_days:7})
      if(error)throw new FunctionError(400,'invitation_failed',error.message)
      const result=data as {invitation_id:string;delivery_id:string;token:string;expires_at:string}
      // Treat the first persisted request as canonical if the same request key
      // is replayed. Never pair an existing secret link with a later email/role.
      const [{data:delivery,error:deliveryError},{data:invitation,error:invitationError}]=await Promise.all([
        admin.from('email_deliveries').select('id,recipient_email,related_entity_id').eq('id',result.delivery_id)
          .eq('organization_id',input.organizationId).eq('email_type','team_invitation').eq('related_entity_id',result.invitation_id).maybeSingle(),
        admin.from('organization_invitations').select('id,role_id').eq('id',result.invitation_id).eq('organization_id',input.organizationId).maybeSingle(),
      ])
      if(deliveryError||invitationError||!delivery||!invitation)throw new FunctionError(409,'delivery_payload_missing','The saved invitation delivery is unavailable.')
      invitationId=invitation.id;deliveryId=delivery.id;email=delivery.recipient_email;roleId=invitation.role_id;token=result.token;expiresAt=result.expires_at
    }

    const activeInvitation=await admin.from('organization_invitations').select('id').eq('id',invitationId)
      .eq('organization_id',input.organizationId).is('revoked_at',null).is('accepted_at',null).gt('expires_at',new Date().toISOString()).maybeSingle()
    if(activeInvitation.error||!activeInvitation.data)throw new FunctionError(409,'invitation_inactive','This invitation is no longer active.')

    const [{data:organization,error:organizationError},{data:role,error:roleError}]=await Promise.all([
      caller.from('organizations').select('id,name,slug').eq('id',input.organizationId).single(),
      caller.from('roles').select('id,name').eq('organization_id',input.organizationId).eq('id',roleId).single(),
    ])
    if(organizationError||roleError||!organization||!role)throw new FunctionError(404,'workspace_not_found','Workspace or role not found.')
    const appOrigin=(Deno.env.get('APP_ORIGIN')||'http://127.0.0.1:5173').split(',')[0].trim().replace(/\/$/,'')
    const invitationUrl=`${appOrigin}/invite/${encodeURIComponent(token)}`
    const resendKey=Deno.env.get('RESEND_API_KEY');const from=Deno.env.get('EMAIL_FROM')||'Agency ATS <onboarding@resend.dev>'
    let providerMessageId:string|undefined;let deliveryStatus='sent';let errorMessage:string|undefined
    if(resendKey){
      try{
        const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json','Idempotency-Key':`team-invitation-${deliveryId}`},body:JSON.stringify({from,to:[email],subject:`You are invited to ${organization.name}`,html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>Join ${escapeHtml(organization.name)}</h1><p>You have been invited as <strong>${escapeHtml(role.name)}</strong>.</p><p><a href="${invitationUrl}" style="display:inline-block;background:#236c64;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">Accept invitation with Google</a></p><p>This link expires on ${new Date(expiresAt).toLocaleDateString('en-GB')}.</p></div>`})})
        const body=await response.json().catch(()=>({})) as {id?:string;message?:string}
        if(!response.ok){deliveryStatus='failed';errorMessage=body.message||'Email provider rejected the invitation.'}else providerMessageId=body.id
      }catch(error){deliveryStatus='failed';errorMessage=error instanceof Error?error.message:'Email provider could not be reached.'}
    }else if((Deno.env.get('ENVIRONMENT')||'development')==='production'){
      deliveryStatus='failed';errorMessage='Production invitation email is not configured.'
    }else deliveryStatus='pending'

    const {data:savedStatus,error:statusError}=await admin.rpc('finalize_email_delivery',{p_delivery_id:deliveryId,p_status:deliveryStatus,
      p_provider_message_id:providerMessageId||null,p_error_code:deliveryStatus==='failed'?'email_delivery_failed':null,p_error_message:errorMessage||null})
    if(statusError)throw new FunctionError(500,'delivery_status_failed','The invitation result could not be saved. Retry safely with the existing delivery.')
    deliveryStatus=String(savedStatus)
    if(deliveryStatus==='sent'||deliveryStatus==='delivered')errorMessage=undefined
    log(deliveryStatus==='failed'?'error':'info','invitation.delivery_finished',{requestId:id,organizationId:input.organizationId,invitationId,deliveryId,deliveryStatus,durationMs:Date.now()-started})
    return json(request,{invitationId,deliveryId,expiresAt,deliveryStatus,errorMessage,...(deliveryStatus==='pending'?{previewUrl:invitationUrl}:{})},input.action==='retry'?200:201)
  }catch(error){
    const known=error instanceof FunctionError;log('error','invitation.failed',{requestId:id,code:known?error.code:'unexpected_error',durationMs:Date.now()-started})
    return json(request,{error:{code:known?error.code:'unexpected_error',message:known?error.message:'Could not send invitation.',requestId:id}},known?error.status:500)
  }
})
