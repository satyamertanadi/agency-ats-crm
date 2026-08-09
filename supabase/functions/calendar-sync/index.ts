import {FunctionError,requirePermission} from '../_shared/auth.ts'
import {decryptSecret} from '../_shared/crypto.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'

interface Input{organizationId:string;interviewId:string;action?:'sync'|'cancel'}
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character]??character))

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request);const started=Date.now();let interviewId='';let action:Input['action'];let interviewConfirmed=false
  let admin:Awaited<ReturnType<typeof requirePermission>>['admin']|undefined
  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json() as Input;interviewId=input.interviewId;action=input.action
    if(!input.organizationId||!input.interviewId)throw new FunctionError(400,'invalid_request','Organization and interview are required.')
    const context=await requirePermission(request,input.organizationId,'interviews.write');admin=context.admin
    const {data:interview,error:interviewError}=await context.caller.from('interviews').select('id,organization_id,organizer_member_id,starts_at,ends_at,timezone,location,meeting_url,status,attendee_emails,create_google_meet,calendar_event_id,calendar_sync_version,job_candidates(candidates(full_name),jobs(title))').eq('organization_id',input.organizationId).eq('id',input.interviewId).single()
    if(interviewError||!interview)throw new FunctionError(404,'interview_not_found','Interview not found.')
    interviewConfirmed=true
    const relation=interview.job_candidates as {candidates?:{full_name?:string};jobs?:{title?:string}}|null
    const candidate=relation?.candidates?.full_name||'Candidate'
    const job=relation?.jobs?.title||'Interview'

    if(input.action==='cancel'){
      const queued=await context.caller.rpc('queue_interview_cancellation',{p_organization_id:input.organizationId,p_interview_id:input.interviewId})
      if(queued.error)throw new FunctionError(queued.error.code==='22023'?409:400,'interview_cancellation_failed',queued.error.message)
      const deliveries=(queued.data||[]) as {delivery_id:string;recipient_email:string;delivery_status:string}[]

      let calendarStatus:'cancelled'|'not_connected'|'not_required'|'failed'='not_required'
      let calendarSentNotices=false
      if(interview.calendar_event_id&&interview.organizer_member_id){
        try{
          const {data:connection,error:connectionError}=await admin.from('google_calendar_connections').select('*').eq('organization_id',input.organizationId).eq('member_id',interview.organizer_member_id).eq('status','connected').single()
          if(connectionError||!connection?.token_secret_id){calendarStatus='not_connected';throw new Error('Reconnect Google Calendar to remove the existing event.')}
          const {data:secret,error:secretError}=await admin.from('google_calendar_secrets').select('encrypted_refresh_token').eq('id',connection.token_secret_id).single()
          if(secretError||!secret)throw new Error('Reconnect Google Calendar to remove the existing event.')
          const clientId=Deno.env.get('GOOGLE_CLIENT_ID');const clientSecret=Deno.env.get('GOOGLE_CLIENT_SECRET')
          if(!clientId||!clientSecret)throw new Error('Google Calendar is not configured.')
          const refreshToken=await decryptSecret(secret.encrypted_refresh_token)
          const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})})
          const token=await tokenResponse.json() as {access_token?:string}
          if(!tokenResponse.ok||!token.access_token)throw new Error('Reconnect Google Calendar to remove the existing event.')
          const calendarId=encodeURIComponent(connection.calendar_id||'primary')
          const response=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(interview.calendar_event_id)}?sendUpdates=all`,{method:'DELETE',headers:{Authorization:`Bearer ${token.access_token}`}})
          if(!response.ok&&response.status!==404)throw new Error(`Google Calendar cancellation failed (${response.status}).`)
          // Google has already emailed every event guest when a real deletion succeeds with
          // sendUpdates=all. Do not send a second, duplicate Resend email to the same people. A 404
          // is different: the organizer event is gone, but this attempt did not notify anyone, so
          // the durable fallback emails below still run.
          calendarSentNotices=response.ok
          calendarStatus='cancelled'
          await Promise.all([
            admin.from('interviews').update({calendar_sync_status:'cancelled',calendar_last_synced_at:new Date().toISOString(),calendar_last_error:null}).eq('id',input.interviewId),
            admin.from('google_calendar_connections').update({last_synced_at:new Date().toISOString(),last_error:null,last_error_at:null}).eq('id',connection.id),
          ])
        }catch(error){
          if(calendarStatus!=='not_connected')calendarStatus='failed'
          const message=error instanceof Error?error.message:'Google Calendar cancellation failed.'
          await admin.from('interviews').update({calendar_sync_status:'failed',calendar_last_error:message}).eq('id',input.interviewId)
          log('error','calendar.cancellation_failed',{requestId:id,interviewId:input.interviewId,calendarStatus,message})
        }
      }else{
        await admin.from('interviews').update({calendar_sync_status:'cancelled',calendar_last_synced_at:new Date().toISOString(),calendar_last_error:null}).eq('id',input.interviewId)
      }

      const {data:organization}=await context.caller.from('organizations').select('name').eq('id',input.organizationId).single()
      const resendKey=Deno.env.get('RESEND_API_KEY');const production=(Deno.env.get('ENVIRONMENT')||'development')==='production'
      const when=new Date(interview.starts_at).toLocaleString('en-GB',{dateStyle:'full',timeStyle:'short',timeZone:interview.timezone})
      const statuses:string[]=[]
      for(const delivery of deliveries){
        if(['sent','delivered'].includes(delivery.delivery_status)){statuses.push(delivery.delivery_status);continue}
        if(calendarSentNotices){
          const finalized=await admin.rpc('finalize_email_delivery',{p_delivery_id:delivery.delivery_id,p_status:'sent',p_provider_message_id:`google-calendar:${interview.calendar_event_id}`,p_error_code:null,p_error_message:null})
          if(finalized.error)throw new FunctionError(500,'delivery_status_failed','The cancellation was saved, but its notification result could not be recorded.')
          statuses.push(String(finalized.data));continue
        }
        let status='sent';let providerMessageId:string|undefined;let errorMessage:string|undefined
        if(!resendKey){status=production?'failed':'pending';errorMessage=production?'Production email is not configured.':undefined}
        else try{
          const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json','Idempotency-Key':`interview-cancellation-${delivery.delivery_id}`},body:JSON.stringify({from:Deno.env.get('EMAIL_FROM')||'Agency ATS <onboarding@resend.dev>',to:[delivery.recipient_email],subject:`Interview cancelled: ${candidate} - ${job}`,html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>Interview cancelled</h1><p>The interview for <strong>${escapeHtml(candidate)}</strong> and <strong>${escapeHtml(job)}</strong>, scheduled for ${escapeHtml(when)}, has been cancelled.</p><p>Please remove it from your plans. Contact ${escapeHtml(String(organization?.name||'the recruitment team'))} if you need any clarification.</p></div>`})})
          const body=await response.json().catch(()=>({})) as {id?:string;message?:string}
          if(!response.ok){status='failed';errorMessage=body.message||'Email provider rejected the cancellation notice.'}else providerMessageId=body.id
        }catch(error){status='failed';errorMessage=error instanceof Error?error.message:'Email provider could not be reached.'}
        const finalized=await admin.rpc('finalize_email_delivery',{p_delivery_id:delivery.delivery_id,p_status:status,p_provider_message_id:providerMessageId||null,p_error_code:status==='failed'?'email_delivery_failed':null,p_error_message:errorMessage||null})
        if(finalized.error)throw new FunctionError(500,'delivery_status_failed','The cancellation was saved, but its notification result could not be recorded.')
        statuses.push(String(finalized.data))
      }
      const failedRecipientCount=statuses.filter((status)=>['failed','bounced','suppressed'].includes(status)).length
      const pending=statuses.filter((status)=>status==='pending').length
      const notificationStatus=deliveries.length===0?'not_required':failedRecipientCount===deliveries.length?'failed':failedRecipientCount>0?'partial':pending>0?'pending':'sent'
      await admin.from('audit_logs').insert({organization_id:input.organizationId,actor_user_id:context.user.id,action:'interview.cancellation_notifications_processed',entity_type:'interview',entity_id:input.interviewId,metadata:{calendar_status:calendarStatus,notification_status:notificationStatus,recipient_count:deliveries.length,failed_recipient_count:failedRecipientCount}})
      log(failedRecipientCount||calendarStatus==='failed'||calendarStatus==='not_connected'?'error':'info','interview.cancellation_completed',{requestId:id,organizationId:input.organizationId,interviewId:input.interviewId,calendarStatus,notificationStatus,recipientCount:deliveries.length,failedRecipientCount,durationMs:Date.now()-started})
      return json(request,{status:'cancelled',calendarStatus,notificationStatus,recipientCount:deliveries.length,failedRecipientCount})
    }

    if(!interview.organizer_member_id)throw new FunctionError(400,'organizer_required','Choose an organizer before syncing Calendar.')
    const {data:connection,error:connectionError}=await admin.from('google_calendar_connections').select('*').eq('organization_id',input.organizationId).eq('member_id',interview.organizer_member_id).eq('status','connected').single()
    if(connectionError||!connection||!connection.token_secret_id)throw new FunctionError(409,'calendar_not_connected','The interview organizer must connect Google Calendar.')
    const {data:secret,error:secretError}=await admin.from('google_calendar_secrets').select('encrypted_refresh_token').eq('id',connection.token_secret_id).single()
    if(secretError||!secret)throw new FunctionError(409,'calendar_reauthorization_required','Reconnect Google Calendar.')
    const refreshToken=await decryptSecret(secret.encrypted_refresh_token)
    const clientId=Deno.env.get('GOOGLE_CLIENT_ID');const clientSecret=Deno.env.get('GOOGLE_CLIENT_SECRET');if(!clientId||!clientSecret)throw new FunctionError(500,'calendar_not_configured','Google Calendar is not configured.')
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})})
    const token=await tokenResponse.json() as {access_token?:string;error?:string};if(!tokenResponse.ok||!token.access_token){await admin.from('google_calendar_connections').update({status:'reauthorization_required',last_error:'Google authorization expired.',last_error_at:new Date().toISOString()}).eq('id',connection.id);throw new FunctionError(409,'calendar_reauthorization_required','Reconnect Google Calendar.')}
    const eventId=interview.calendar_event_id||`ats${input.interviewId.replaceAll('-','')}`
    const calendarId=encodeURIComponent(connection.calendar_id||'primary');const eventEndpoint=`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`
    const headers={Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'}
    const event={id:eventId,summary:`${candidate} - ${job}`,description:`Recruitment interview managed by Agency ATS. Reference: ${input.interviewId}`,location:interview.location||undefined,start:{dateTime:interview.starts_at,timeZone:interview.timezone},end:{dateTime:interview.ends_at,timeZone:interview.timezone},attendees:(interview.attendee_emails||[]).map((email:string)=>({email})),conferenceData:interview.create_google_meet?{createRequest:{requestId:`meet-${input.interviewId}-${Number(new Date(interview.starts_at))}`}}:undefined}
    const suffix='?sendUpdates=all&conferenceDataVersion=1';let response:Response
    if(interview.calendar_event_id)response=await fetch(`${eventEndpoint}/${encodeURIComponent(eventId)}${suffix}`,{method:'PUT',headers,body:JSON.stringify(event)})
    else response=await fetch(`${eventEndpoint}${suffix}`,{method:'POST',headers,body:JSON.stringify(event)})
    if(response.status===409)response=await fetch(`${eventEndpoint}/${encodeURIComponent(eventId)}${suffix}`,{method:'PUT',headers,body:JSON.stringify(event)})
    const result=await response.json().catch(()=>({})) as {htmlLink?:string;hangoutLink?:string;error?:{message?:string}}
    if(!response.ok)throw new Error(result.error?.message||`Google Calendar synchronization failed (${response.status}).`)
    await admin.from('interviews').update({calendar_event_id:eventId,calendar_event_url:result.htmlLink||null,meeting_url:result.hangoutLink||interview.meeting_url,calendar_sync_status:'synced',calendar_last_synced_at:new Date().toISOString(),calendar_last_error:null,calendar_synced_version:interview.calendar_sync_version}).eq('id',input.interviewId)
    await Promise.all([admin.from('google_calendar_connections').update({last_synced_at:new Date().toISOString(),last_error:null,last_error_at:null}).eq('id',connection.id),admin.from('audit_logs').insert({organization_id:input.organizationId,actor_user_id:context.user.id,action:'calendar.event_synced',entity_type:'interview',entity_id:input.interviewId})])
    log('info','calendar.sync_completed',{requestId:id,organizationId:input.organizationId,interviewId:input.interviewId,action:'sync',durationMs:Date.now()-started})
    return json(request,{status:'synced',eventId})
  }catch(error){const known=error instanceof FunctionError;const message=known?error.message:'Calendar synchronization failed.'
    // Never let an authorized user poison another tenant's interview by supplying its id: only a
    // successfully loaded sync target may be marked failed. Cancellation has its own atomic queue
    // and per-side-effect statuses, so a later email-ledger failure is not a Calendar failure.
    if(admin&&interviewId&&interviewConfirmed&&action!=='cancel')await admin.rpc('mark_calendar_sync_failed',{p_interview_id:interviewId,p_message:message})
    log('error','calendar.sync_failed',{requestId:id,interviewId,code:known?error.code:'unexpected_error',durationMs:Date.now()-started});return json(request,{error:{code:known?error.code:'unexpected_error',message,requestId:id}},known?error.status:500)}
})
