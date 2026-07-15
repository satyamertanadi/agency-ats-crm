import {FunctionError,requirePermission} from '../_shared/auth.ts'
import {decryptSecret} from '../_shared/crypto.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'

interface Input{organizationId:string;interviewId:string;action?:'sync'|'cancel'}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request);const started=Date.now();let interviewId='';let admin:Awaited<ReturnType<typeof requirePermission>>['admin']|undefined
  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json() as Input;interviewId=input.interviewId
    if(!input.organizationId||!input.interviewId)throw new FunctionError(400,'invalid_request','Organization and interview are required.')
    const context=await requirePermission(request,input.organizationId,'placements.write');admin=context.admin
    const {data:interview,error:interviewError}=await context.caller.from('interviews').select('id,organization_id,organizer_member_id,starts_at,ends_at,timezone,location,meeting_url,status,attendee_emails,create_google_meet,calendar_event_id,calendar_sync_version,job_candidates(candidates(full_name),jobs(title))').eq('organization_id',input.organizationId).eq('id',input.interviewId).single()
    if(interviewError||!interview)throw new FunctionError(404,'interview_not_found','Interview not found.')
    if(!interview.organizer_member_id)throw new FunctionError(400,'organizer_required','Choose an organizer before syncing Calendar.')
    const {data:connection,error:connectionError}=await admin.from('google_calendar_connections').select('*').eq('organization_id',input.organizationId).eq('member_id',interview.organizer_member_id).eq('status','connected').single()
    if(connectionError||!connection||!connection.token_secret_id)throw new FunctionError(409,'calendar_not_connected','The interview organizer must connect Google Calendar.')
    const {data:secret,error:secretError}=await admin.from('google_calendar_secrets').select('encrypted_refresh_token').eq('id',connection.token_secret_id).single()
    if(secretError||!secret)throw new FunctionError(409,'calendar_reauthorization_required','Reconnect Google Calendar.')
    const refreshToken=await decryptSecret(secret.encrypted_refresh_token)
    const clientId=Deno.env.get('GOOGLE_CLIENT_ID');const clientSecret=Deno.env.get('GOOGLE_CLIENT_SECRET');if(!clientId||!clientSecret)throw new FunctionError(500,'calendar_not_configured','Google Calendar is not configured.')
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})})
    const token=await tokenResponse.json() as {access_token?:string;error?:string};if(!tokenResponse.ok||!token.access_token){await admin.from('google_calendar_connections').update({status:'reauthorization_required',last_error:'Google authorization expired.',last_error_at:new Date().toISOString()}).eq('id',connection.id);throw new FunctionError(409,'calendar_reauthorization_required','Reconnect Google Calendar.')}
    const candidate=(interview.job_candidates as {candidates?:{full_name?:string};jobs?:{title?:string}}|null)?.candidates?.full_name||'Candidate'
    const job=(interview.job_candidates as {candidates?:{full_name?:string};jobs?:{title?:string}}|null)?.jobs?.title||'Interview'
    const eventId=interview.calendar_event_id||`ats${input.interviewId.replaceAll('-','')}`
    const calendarId=encodeURIComponent(connection.calendar_id||'primary');const eventEndpoint=`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`
    const headers={Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'}
    if(input.action==='cancel'){
      const response=await fetch(`${eventEndpoint}/${encodeURIComponent(eventId)}?sendUpdates=all`,{method:'DELETE',headers})
      if(!response.ok&&response.status!==404)throw new Error(`Google Calendar cancellation failed (${response.status}).`)
      await admin.from('interviews').update({status:'cancelled',cancelled_at:new Date().toISOString(),calendar_event_id:eventId,calendar_sync_status:'cancelled',calendar_last_synced_at:new Date().toISOString(),calendar_last_error:null}).eq('id',input.interviewId)
    }else{
      const event={id:eventId,summary:`${candidate} - ${job}`,description:`Recruitment interview managed by Agency ATS. Reference: ${input.interviewId}`,location:interview.location||undefined,start:{dateTime:interview.starts_at,timeZone:interview.timezone},end:{dateTime:interview.ends_at,timeZone:interview.timezone},attendees:(interview.attendee_emails||[]).map((email:string)=>({email})),conferenceData:interview.create_google_meet?{createRequest:{requestId:`meet-${input.interviewId}-${Number(new Date(interview.starts_at))}`}}:undefined}
      const suffix='?sendUpdates=all&conferenceDataVersion=1';let response:Response
      if(interview.calendar_event_id)response=await fetch(`${eventEndpoint}/${encodeURIComponent(eventId)}${suffix}`,{method:'PUT',headers,body:JSON.stringify(event)})
      else response=await fetch(`${eventEndpoint}${suffix}`,{method:'POST',headers,body:JSON.stringify(event)})
      if(response.status===409)response=await fetch(`${eventEndpoint}/${encodeURIComponent(eventId)}${suffix}`,{method:'PUT',headers,body:JSON.stringify(event)})
      const result=await response.json().catch(()=>({})) as {htmlLink?:string;hangoutLink?:string;error?:{message?:string}}
      if(!response.ok)throw new Error(result.error?.message||`Google Calendar synchronization failed (${response.status}).`)
      await admin.from('interviews').update({calendar_event_id:eventId,calendar_event_url:result.htmlLink||null,meeting_url:result.hangoutLink||interview.meeting_url,calendar_sync_status:'synced',calendar_last_synced_at:new Date().toISOString(),calendar_last_error:null,calendar_synced_version:interview.calendar_sync_version}).eq('id',input.interviewId)
    }
    await Promise.all([admin.from('google_calendar_connections').update({last_synced_at:new Date().toISOString(),last_error:null,last_error_at:null}).eq('id',connection.id),admin.from('audit_logs').insert({organization_id:input.organizationId,actor_user_id:context.user.id,action:input.action==='cancel'?'calendar.event_cancelled':'calendar.event_synced',entity_type:'interview',entity_id:input.interviewId})])
    log('info','calendar.sync_completed',{requestId:id,organizationId:input.organizationId,interviewId:input.interviewId,action:input.action||'sync',durationMs:Date.now()-started})
    return json(request,{status:input.action==='cancel'?'cancelled':'synced',eventId})
  }catch(error){const known=error instanceof FunctionError;const message=known?error.message:'Calendar synchronization failed.';if(admin&&interviewId)await admin.rpc('mark_calendar_sync_failed',{p_interview_id:interviewId,p_message:message});log('error','calendar.sync_failed',{requestId:id,interviewId,code:known?error.code:'unexpected_error',durationMs:Date.now()-started});return json(request,{error:{code:known?error.code:'unexpected_error',message,requestId:id}},known?error.status:500)}
})
