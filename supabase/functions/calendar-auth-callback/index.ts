import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {encryptSecret,sha256} from '../_shared/crypto.ts'
import {corsHeaders,log,requestId} from '../_shared/http.ts'

function redirect(path:string,params:Record<string,string>){
  const origin=(Deno.env.get('APP_ORIGIN')||'http://127.0.0.1:5173').split(',')[0].trim().replace(/\/$/,'')
  const target=new URL(path.startsWith('/')&&!path.startsWith('//')?path:'/app',origin);Object.entries(params).forEach(([key,value])=>target.searchParams.set(key,value))
  return Response.redirect(target.toString(),302)
}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  if(request.method!=='GET')return new Response('Method not allowed.',{status:405,headers:{...corsHeaders(request),'Content-Type':'text/plain; charset=utf-8'}})
  const id=requestId(request);const url=new URL(request.url);const state=url.searchParams.get('state')||'';const code=url.searchParams.get('code')||''
  const supabaseUrl=Deno.env.get('SUPABASE_URL');const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');const clientId=Deno.env.get('GOOGLE_CLIENT_ID');const clientSecret=Deno.env.get('GOOGLE_CLIENT_SECRET');const redirectUri=Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI')
  if(!supabaseUrl||!service||!clientId||!clientSecret||!redirectUri)return redirect('/app',{calendar:'configuration_error'})
  const admin=createClient(supabaseUrl,service,{auth:{persistSession:false}})
  try{
    if(url.searchParams.get('error'))return redirect('/app',{calendar:'denied'})
    if(!state||!code)return redirect('/app',{calendar:'invalid_callback'})
    const stateHash=await sha256(state)
    const {data:oauthState,error:stateError}=await admin.from('google_oauth_states').select('*').eq('state_hash',stateHash).is('consumed_at',null).gt('expires_at',new Date().toISOString()).single()
    if(stateError||!oauthState)return redirect('/app',{calendar:'expired_state'})
    await admin.from('google_oauth_states').update({consumed_at:new Date().toISOString()}).eq('id',oauthState.id)
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code'})})
    const tokens=await tokenResponse.json() as {access_token?:string;refresh_token?:string;scope?:string;error_description?:string}
    if(!tokenResponse.ok||!tokens.access_token)throw new Error(tokens.error_description||'Google token exchange failed.')
    const userInfoResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${tokens.access_token}`}})
    const userInfo=await userInfoResponse.json() as {email?:string;email_verified?:boolean}
    const {data:profile}=await admin.from('profiles').select('email').eq('id',oauthState.user_id).single()
    if(!userInfo.email||!userInfo.email_verified||userInfo.email.toLowerCase()!==String(profile?.email||'').toLowerCase())throw new Error('Calendar account must match the signed-in Google account.')
    const {data:existing}=await admin.from('google_calendar_connections').select('id,token_secret_id').eq('organization_id',oauthState.organization_id).eq('member_id',oauthState.member_id).maybeSingle()
    const {data:connection,error:connectionError}=await admin.from('google_calendar_connections').upsert({id:existing?.id,organization_id:oauthState.organization_id,member_id:oauthState.member_id,google_email:userInfo.email.toLowerCase(),calendar_id:'primary',status:'connected',scopes:(tokens.scope||'').split(' ').filter(Boolean),connected_at:new Date().toISOString(),disconnected_at:null,last_error:null,last_error_at:null},{onConflict:'organization_id,member_id'}).select('id,token_secret_id').single()
    if(connectionError||!connection)throw connectionError||new Error('Could not store Calendar connection.')
    if(tokens.refresh_token){
      const encrypted=await encryptSecret(tokens.refresh_token)
      const {data:secret,error:secretError}=await admin.from('google_calendar_secrets').upsert({id:connection.token_secret_id||undefined,connection_id:connection.id,encrypted_refresh_token:encrypted,encryption_version:1},{onConflict:'connection_id'}).select('id').single()
      if(secretError||!secret)throw secretError||new Error('Could not store Calendar credential.')
      await admin.from('google_calendar_connections').update({token_secret_id:secret.id}).eq('id',connection.id)
    }else if(!connection.token_secret_id)throw new Error('Google did not return offline access. Reconnect and approve Calendar access.')
    await admin.from('audit_logs').insert({organization_id:oauthState.organization_id,actor_user_id:oauthState.user_id,action:'calendar.connected',entity_type:'google_calendar_connection',entity_id:connection.id})
    log('info','calendar.connected',{requestId:id,organizationId:oauthState.organization_id,connectionId:connection.id})
    return redirect(oauthState.return_path,{calendar:'connected'})
  }catch(error){log('error','calendar.callback_failed',{requestId:id,errorCode:error instanceof Error?error.name:'unknown'});return redirect('/app',{calendar:'connection_failed'})}
})
