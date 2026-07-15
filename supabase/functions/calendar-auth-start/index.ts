import {FunctionError,requireUser} from '../_shared/auth.ts'
import {randomToken,sha256} from '../_shared/crypto.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request)
  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const {organizationId,returnPath='/app'}=await request.json() as {organizationId:string;returnPath?:string}
    const {user,caller,admin}=await requireUser(request)
    const {data:member,error}=await caller.from('organization_members').select('id').eq('organization_id',organizationId).eq('user_id',user.id).eq('status','active').single()
    if(error||!member)throw new FunctionError(403,'membership_required','An active workspace membership is required.')
    const clientId=Deno.env.get('GOOGLE_CLIENT_ID');const redirectUri=Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI')
    if(!clientId||!redirectUri)throw new FunctionError(500,'calendar_not_configured','Google Calendar is not configured.')
    const state=randomToken();const safeReturn=returnPath.startsWith('/')&&!returnPath.startsWith('//')?returnPath:'/app'
    const {error:stateError}=await admin.from('google_oauth_states').insert({state_hash:await sha256(state),organization_id:organizationId,member_id:member.id,user_id:user.id,return_path:safeReturn,expires_at:new Date(Date.now()+10*60_000).toISOString()})
    if(stateError)throw stateError
    const params=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid email https://www.googleapis.com/auth/calendar.events',access_type:'offline',prompt:'consent',include_granted_scopes:'true',state})
    log('info','calendar.authorization_started',{requestId:id,organizationId,memberId:member.id})
    return json(request,{authorizationUrl:`https://accounts.google.com/o/oauth2/v2/auth?${params}`})
  }catch(error){const known=error instanceof FunctionError;log('error','calendar.authorization_failed',{requestId:id,code:known?error.code:'unexpected_error'});return json(request,{error:{code:known?error.code:'unexpected_error',message:known?error.message:'Could not start Calendar authorization.',requestId:id}},known?error.status:500)}
})
