import {supabase} from './supabase'
import {APP_ORIGIN} from './config'
import type {BgRequest,OrgSummary,StateResponse} from './messages'

async function currentOrgs():Promise<OrgSummary[]>{
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)return []
  const {data}=await supabase.from('organization_members').select('organizations(id,name)').eq('user_id',user.id).eq('status','active')
  // The embedded FK resolves to a single org at runtime; the generated types widen it to an array, so
  // normalise both shapes.
  const rows=(data||[]) as unknown as Array<{organizations:{id:string;name:string}|{id:string;name:string}[]|null}>
  return rows.flatMap((row)=>{const org=Array.isArray(row.organizations)?row.organizations[0]:row.organizations;return org?[{id:org.id,name:org.name}]:[]})
}

async function getState():Promise<StateResponse>{
  const {data:{session},error}=await supabase.auth.getSession()
  console.log('[ATS ext] getState: session present?',Boolean(session),'error?',error?.message)
  if(!session)return {connected:false,organizations:[]}
  const organizations=await currentOrgs()
  console.log('[ATS ext] getState: organizations found:',organizations.length,organizations)
  return {connected:true,email:session.user.email,organizations}
}

// Track the tab we opened for a session handoff so we can close it once the session arrives -- but only
// that tab. A session message from the user simply browsing the ATS (handoff.ts runs on every app page)
// must never close their tab.
let handoffTabId:number|undefined

chrome.runtime.onMessage.addListener((message:BgRequest,_sender,sendResponse)=>{
  console.log('[ATS ext] background received message:',message.type,'from tab',_sender.tab?.id,_sender.tab?.url);
  (async()=>{
    try{
      switch(message.type){
        case 'get-state':return sendResponse(await getState())
        case 'connect':{const tab=await chrome.tabs.create({url:APP_ORIGIN,active:true});handoffTabId=tab.id;console.log('[ATS ext] connect: opened tab',tab.id,'to',APP_ORIGIN);return sendResponse({ok:true})}
        case 'disconnect':await supabase.auth.signOut();return sendResponse({connected:false,organizations:[]})
        case 'session':{
          console.log('[ATS ext] session message received, has access_token?',Boolean(message.session?.access_token))
          const {error}=await supabase.auth.setSession(message.session)
          console.log('[ATS ext] setSession result, error?',error?.message)
          if(handoffTabId!==undefined){try{await chrome.tabs.remove(handoffTabId)}catch{/* already closed */}handoffTabId=undefined}
          return sendResponse(error?{connected:false,organizations:[],error:error.message}:await getState())
        }
        case 'list-jobs':{
          const {data,error}=await supabase.from('jobs').select('id,title').eq('organization_id',message.organizationId).eq('status','open').is('deleted_at',null).order('title')
          return sendResponse(error?{error:error.message,jobs:[]}:{jobs:data||[]})
        }
        case 'list-companies':{
          const {data,error}=await supabase.from('companies').select('id,name').eq('organization_id',message.organizationId).is('deleted_at',null).order('name')
          return sendResponse(error?{error:error.message,companies:[]}:{companies:data||[]})
        }
        case 'list-members':{
          const {data,error}=await supabase.from('organization_members').select('id,profiles:user_id(full_name,email)').eq('organization_id',message.organizationId).eq('status','active')
          if(error)return sendResponse({error:error.message,members:[]})
          const members=(data||[]).map((row:{id:string;profiles:{full_name?:string|null;email?:string|null}|{full_name?:string|null;email?:string|null}[]|null})=>{const p=Array.isArray(row.profiles)?row.profiles[0]:row.profiles;return {id:row.id,name:p?.full_name||p?.email||'Member'}})
          return sendResponse({members})
        }
        case 'list-tags':{
          const {data,error}=await supabase.from('tags').select('name').eq('organization_id',message.organizationId).order('name')
          return sendResponse(error?{error:error.message,tags:[]}:{tags:(data||[]).map((t:{name:string})=>t.name)})
        }
        case 'lookup':{
          const {data,error}=await supabase.rpc('lookup_prospects_by_linkedin',{p_organization_id:message.organizationId,p_linkedin_urls:message.linkedinUrls})
          return sendResponse(error?{error:error.message}:{matches:data||[]})
        }
        case 'ai-parse':{
          const {data,error}=await supabase.functions.invoke('parse-linkedin-profile',{body:{organizationId:message.organizationId,text:message.text}})
          if(error)return sendResponse({error:error.message})
          const payload=data as {extraction?:unknown;error?:{message?:string}}
          if(payload?.error)return sendResponse({error:payload.error.message||'AI parsing failed.'})
          return sendResponse({extraction:payload.extraction})
        }
        case 'capture':{
          const {data,error}=await supabase.rpc('capture_prospect',{p_organization_id:message.organizationId,p_kind:message.kind,p_payload:message.payload,p_job_id:message.jobId||undefined})
          return sendResponse(error?{error:error.message}:{result:data})
        }
        case 'bulk-capture':{
          const {data,error}=await supabase.rpc('capture_prospects_bulk',{p_organization_id:message.organizationId,p_kind:message.kind,p_items:message.items,p_job_id:message.jobId||undefined})
          return sendResponse(error?{error:error.message}:{results:data||[]})
        }
      }
    }catch(err){sendResponse({error:err instanceof Error?err.message:'Unexpected error'})}
  })()
  return true // keep the message channel open for the async sendResponse
})
