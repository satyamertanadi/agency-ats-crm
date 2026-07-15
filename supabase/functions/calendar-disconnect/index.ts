import {FunctionError,requireUser} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request)
  try{
    const {organizationId}=await request.json() as {organizationId:string};const {user,caller,admin}=await requireUser(request)
    const {data:member}=await caller.from('organization_members').select('id').eq('organization_id',organizationId).eq('user_id',user.id).eq('status','active').single()
    if(!member)throw new FunctionError(403,'membership_required','An active workspace membership is required.')
    const {data:connection}=await admin.from('google_calendar_connections').select('id,token_secret_id').eq('organization_id',organizationId).eq('member_id',member.id).maybeSingle()
    if(connection){if(connection.token_secret_id)await admin.from('google_calendar_secrets').delete().eq('id',connection.token_secret_id);await admin.from('google_calendar_connections').update({status:'disconnected',token_secret_id:null,disconnected_at:new Date().toISOString()}).eq('id',connection.id);await admin.from('audit_logs').insert({organization_id:organizationId,actor_user_id:user.id,action:'calendar.disconnected',entity_type:'google_calendar_connection',entity_id:connection.id})}
    log('info','calendar.disconnected',{requestId:id,organizationId,memberId:member.id});return json(request,{status:'disconnected'})
  }catch(error){const known=error instanceof FunctionError;return json(request,{error:{code:known?error.code:'unexpected_error',message:known?error.message:'Could not disconnect Calendar.',requestId:id}},known?error.status:500)}
})
