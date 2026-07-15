import {FunctionError,requirePermission} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'

interface Input{organizationId:string;email:string;roleId:string}
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character]??character))

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request);const started=Date.now()
  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json() as Input
    if(!input.organizationId||!input.roleId||!/^\S+@\S+\.\S+$/.test(input.email||''))throw new FunctionError(400,'invalid_request','Organization, role, and a valid email are required.')
    const {caller,admin,user}=await requirePermission(request,input.organizationId,'organization.manage')
    const [{data:organization,error:organizationError},{data:role,error:roleError}]=await Promise.all([
      caller.from('organizations').select('id,name,slug').eq('id',input.organizationId).single(),
      caller.from('roles').select('id,name').eq('organization_id',input.organizationId).eq('id',input.roleId).single(),
    ])
    if(organizationError||roleError||!organization||!role)throw new FunctionError(404,'workspace_not_found','Workspace or role not found.')
    const {data:invitation,error:inviteError}=await caller.rpc('create_organization_invitation',{p_organization_id:input.organizationId,p_email:input.email,p_role_id:input.roleId,p_expiry_days:7})
    if(inviteError)throw new FunctionError(400,'invitation_failed',inviteError.message)
    const result=invitation as {invitation_id:string;token:string;expires_at:string}
    const appOrigin=(Deno.env.get('APP_ORIGIN')||'http://127.0.0.1:5173').split(',')[0].trim().replace(/\/$/,'')
    const invitationUrl=`${appOrigin}/invite/${encodeURIComponent(result.token)}`
    const resendKey=Deno.env.get('RESEND_API_KEY');const from=Deno.env.get('EMAIL_FROM')||'Agency ATS <onboarding@resend.dev>'
    let providerMessageId:string|undefined;let deliveryStatus='sent'
    if(resendKey){
      const response=await fetch('https://api.resend.com/emails',{
        method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json','Idempotency-Key':`team-invitation-${result.invitation_id}`},
        body:JSON.stringify({from,to:[input.email.trim().toLowerCase()],subject:`You are invited to ${organization.name}`,
          html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>Join ${escapeHtml(organization.name)}</h1><p>You have been invited as <strong>${escapeHtml(role.name)}</strong>.</p><p><a href="${invitationUrl}" style="display:inline-block;background:#236c64;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">Accept invitation with Google</a></p><p>This link expires in seven days. Only the invited Google email can accept it.</p></div>`})
      })
      const responseBody=await response.json().catch(()=>({})) as {id?:string;message?:string}
      if(!response.ok)throw new FunctionError(502,'email_delivery_failed',responseBody.message||'Email provider rejected the invitation.')
      providerMessageId=responseBody.id
    }else if((Deno.env.get('ENVIRONMENT')||'development')==='production'){
      throw new FunctionError(500,'email_not_configured','Production invitation email is not configured.')
    }else deliveryStatus='pending'
    await Promise.all([
      admin.from('organization_invitations').update({delivery_status:deliveryStatus,delivery_id:providerMessageId||null,last_sent_at:new Date().toISOString(),delivery_error:null}).eq('id',result.invitation_id),
      admin.from('email_deliveries').insert({organization_id:input.organizationId,email_type:'team_invitation',recipient_email:input.email.trim().toLowerCase(),provider_message_id:providerMessageId||null,status:deliveryStatus,related_entity_type:'organization_invitation',related_entity_id:result.invitation_id,requested_by:user.id}),
    ])
    log('info','invitation.sent',{requestId:id,organizationId:input.organizationId,invitationId:result.invitation_id,deliveryStatus,durationMs:Date.now()-started})
    return json(request,{invitationId:result.invitation_id,expiresAt:result.expires_at,deliveryStatus,...(deliveryStatus==='pending'?{previewUrl:invitationUrl}:{})},201)
  }catch(error){
    const known=error instanceof FunctionError;log('error','invitation.failed',{requestId:id,code:known?error.code:'unexpected_error',durationMs:Date.now()-started})
    return json(request,{error:{code:known?error.code:'unexpected_error',message:known?error.message:'Could not send invitation.',requestId:id}},known?error.status:500)
  }
})
