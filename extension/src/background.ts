import {supabase} from './supabase'
import {APP_ORIGIN,DEBUG} from './config'
import type {BgRequest,OrgSummary,SourcingSession,StateResponse} from './messages'

// Session presence, tab URLs and org lists are all PII-adjacent, so tracing is opt-in at build time
// (EXT_DEBUG=1) rather than always-on in a user's console.
const trace=(...args:unknown[])=>{if(DEBUG)console.log('[ATS ext]',...args)}
const SESSION_EXPIRED='Your ATS connection expired. Open the ATS and reconnect.'

// The panel fires get-state + four list calls on every open and every workspace switch. None of that
// changes minute to minute, so a short TTL cache turns a repeat open into zero round trips. Entries are
// dropped whenever the session changes; errors are never cached.
const TTL_MS=60000
const cache=new Map<string,{expires:number;value:{error?:string}}>()
const inFlight=new Map<string,Promise<{error?:string}>>()

async function cached<T extends {error?:string}>(key:string,work:()=>Promise<T>):Promise<T>{
  const hit=cache.get(key)
  if(hit&&hit.expires>Date.now())return hit.value as T
  // Collapse concurrent callers onto one request -- the panel's parallel bootstrap would otherwise
  // fire the same query several times before any of them populates the cache.
  const existing=inFlight.get(key)
  if(existing)return existing as Promise<T>
  const promise=work().then((value)=>{
    if(!value.error)cache.set(key,{expires:Date.now()+TTL_MS,value})
    return value
  }).finally(()=>{inFlight.delete(key)})
  inFlight.set(key,promise)
  return promise as Promise<T>
}

function invalidate(){cache.clear();inFlight.clear()}

async function currentOrgs():Promise<OrgSummary[]>{
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)return []
  const {data}=await supabase.from('organization_members').select('organizations(id,name)').eq('user_id',user.id).eq('status','active')
  // The embedded FK resolves to a single org at runtime; the generated types widen it to an array, so
  // normalise both shapes.
  const rows=(data||[]) as unknown as {organizations:{id:string;name:string}|{id:string;name:string}[]|null}[]
  return rows.flatMap((row)=>{const org=Array.isArray(row.organizations)?row.organizations[0]:row.organizations;return org?[{id:org.id,name:org.name}]:[]})
}

async function getState():Promise<StateResponse>{
  const {data:{session},error}=await supabase.auth.getSession()
  trace('getState: session present?',Boolean(session),'error?',error?.message)
  if(!session)return {connected:false,organizations:[],...(error?{error:SESSION_EXPIRED}:{})}
  const organizations=await currentOrgs()
  trace('getState: organizations found:',organizations.length)
  return {connected:true,email:session.user.email,organizations}
}

// ---------------------------------------------------------------------------------------------
// Sourcing session: the extension's on-switch.
//
// The worker owns this state and content scripts only ever react to a broadcast of it, so a script
// that never hears "active" injects nothing and queries nothing. It lives in chrome.storage.session --
// memory-backed and cleared when the browser exits, matching how the borrowed auth token is already
// scoped, so you can never come back tomorrow to a session you forgot was running.
// ---------------------------------------------------------------------------------------------
const SESSION_KEY='sourcing'
const LAST_TARGET_KEY='lastSourcingTarget'
const IDLE:SourcingSession={active:false,organizationId:'',startedAt:0,captured:0}

interface LastTarget{organizationId?:string;jobId?:string;jobTitle?:string}

async function readSourcing():Promise<SourcingSession>{
  const stored=(await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as SourcingSession|undefined
  return stored?.active?stored:IDLE
}

const iconSet=(suffix:string)=>({16:`icons/icon-16${suffix}.png`,32:`icons/icon-32${suffix}.png`,48:`icons/icon-48${suffix}.png`,128:`icons/icon-128${suffix}.png`})

// The toolbar button is the only always-visible trace of the extension, so it carries the session
// state: teal + a running count while sourcing, grey and bare when idle.
async function paintAction(session:SourcingSession){
  try{
    await chrome.action.setIcon({path:iconSet(session.active?'':'-idle')})
    await chrome.action.setBadgeBackgroundColor({color:'#287A72'})
    await chrome.action.setBadgeText({text:session.active?(session.captured?String(session.captured):'ON'):''})
  }catch{/* setIcon can fail if the icons are missing; session state is still correct */}
}

async function broadcast(session:SourcingSession){
  const tabs=await chrome.tabs.query({url:'https://*.linkedin.com/*'})
  await Promise.all(tabs.map(async(tab)=>{
    if(tab.id===undefined)return
    // Throws for tabs whose content script predates the last extension reload. Nothing can be done for
    // those until they're refreshed, so one stale tab must not fail the broadcast to the live ones.
    try{await chrome.tabs.sendMessage(tab.id,{type:'sourcing-changed',session})}catch{/* stale tab */}
  }))
}

async function writeSourcing(session:SourcingSession):Promise<SourcingSession>{
  await chrome.storage.session.set({[SESSION_KEY]:session})
  await paintAction(session)
  await broadcast(session)
  return session
}

async function startSourcing(target:{organizationId:string;jobId?:string;jobTitle?:string}):Promise<SourcingSession>{
  const current=await readSourcing()
  await chrome.storage.local.set({[LAST_TARGET_KEY]:target})
  // Re-aiming mid-session keeps the clock and the count -- switching which job you're filling is not
  // the same as starting over.
  return writeSourcing({
    active:true,organizationId:target.organizationId,jobId:target.jobId,jobTitle:target.jobTitle,
    startedAt:current.active?current.startedAt:Date.now(),captured:current.active?current.captured:0,
  })
}

// The keyboard shortcut has no UI to pick a job in, so it reuses the last target. Falls back to the
// first workspace; if there isn't one the user isn't connected and the popup is where that gets said.
async function toggleSourcing():Promise<SourcingSession>{
  if((await readSourcing()).active)return writeSourcing(IDLE)
  const last=(await chrome.storage.local.get(LAST_TARGET_KEY))[LAST_TARGET_KEY] as LastTarget|undefined
  const organizationId=last?.organizationId||(await currentOrgs())[0]?.id
  if(!organizationId)return IDLE
  return startSourcing({organizationId,jobId:last?.jobId,jobTitle:last?.jobTitle})
}

// Feeds the toolbar count. Only meaningful while a session is running.
async function bumpCaptured(n:number){
  if(n<=0)return
  const session=await readSourcing()
  if(!session.active)return
  await writeSourcing({...session,captured:session.captured+n})
}

chrome.commands.onCommand.addListener((command)=>{if(command==='toggle-panel')void toggleSourcing()})
// The worker is torn down when idle; repaint from stored state whenever it wakes.
void readSourcing().then(paintAction)

// Track the tab we opened for a session handoff so we can close it once the session arrives -- but only
// that tab. A session message from the user simply browsing the ATS (handoff.ts runs on every app page)
// must never close their tab.
let handoffTabId:number|undefined

async function handle(message:BgRequest):Promise<unknown>{
  switch(message.type){
    case 'get-state':return cached('state',getState)
    case 'connect':{invalidate();const tab=await chrome.tabs.create({url:APP_ORIGIN,active:true});handoffTabId=tab.id;trace('connect: opened tab',tab.id);return {ok:true}}
    case 'disconnect':{await supabase.auth.signOut({scope:'local'});invalidate();return {connected:false,organizations:[]}}
    case 'session':{
      trace('session message received, has access_token?',Boolean(message.session?.access_token))
      const closeHandoffTab=async()=>{if(handoffTabId!==undefined){try{await chrome.tabs.remove(handoffTabId)}catch{/* already closed */}handoffTabId=undefined}}
      // handoff.ts runs on every ATS page, so most of these messages carry the session we already hold.
      // Re-running setSession for those churns stored tokens and wipes the cache for nothing.
      const {data:{session:existing}}=await supabase.auth.getSession()
      if(existing?.access_token===message.session?.access_token){trace('session: already current, no-op');await closeHandoffTab();return cached('state',getState)}
      if(message.session.expires_at<=Math.floor(Date.now()/1000)+30){await closeHandoffTab();return {connected:false,organizations:[],error:SESSION_EXPIRED}}
      // supabase-js requires a non-empty refresh_token field even for a live access token. This fixed
      // sentinel satisfies that client contract but cannot mint credentials; expiry therefore fails
      // closed and sends the user through the ATS handoff again.
      const {error}=await supabase.auth.setSession({access_token:message.session.access_token,refresh_token:'extension-no-refresh'})
      invalidate()
      trace('setSession error?',error?.message)
      await closeHandoffTab()
      return error?{connected:false,organizations:[],error:error.message}:await getState()
    }
    case 'list-jobs':return cached(`jobs:${message.organizationId}`,async()=>{
      const {data,error}=await supabase.from('jobs').select('id,title').eq('organization_id',message.organizationId).eq('status','open').is('deleted_at',null).order('title')
      return error?{error:error.message,jobs:[]}:{jobs:data||[]}
    })
    case 'list-companies':return cached(`companies:${message.organizationId}`,async()=>{
      const {data,error}=await supabase.from('companies').select('id,name').eq('organization_id',message.organizationId).is('deleted_at',null).order('name')
      return error?{error:error.message,companies:[]}:{companies:data||[]}
    })
    case 'list-members':return cached(`members:${message.organizationId}`,async()=>{
      const {data,error}=await supabase.from('organization_members').select('id,profiles:user_id(full_name,email)').eq('organization_id',message.organizationId).eq('status','active')
      if(error)return {error:error.message,members:[]}
      const members=(data||[]).map((row:{id:string;profiles:{full_name?:string|null;email?:string|null}|{full_name?:string|null;email?:string|null}[]|null})=>{const p=Array.isArray(row.profiles)?row.profiles[0]:row.profiles;return {id:row.id,name:p?.full_name||p?.email||'Member'}})
      return {members}
    })
    case 'list-tags':return cached(`tags:${message.organizationId}`,async()=>{
      const {data,error}=await supabase.from('tags').select('name').eq('organization_id',message.organizationId).order('name')
      return error?{error:error.message,tags:[]}:{tags:(data||[]).map((t:{name:string})=>t.name)}
    })
    case 'lookup':{
      const {data,error}=await supabase.rpc('lookup_prospects_by_linkedin',{p_organization_id:message.organizationId,p_linkedin_urls:message.linkedinUrls})
      return error?{error:error.message}:{matches:data||[]}
    }
    case 'ai-parse':{
      const {data,error}=await supabase.functions.invoke('parse-linkedin-profile',{body:{organizationId:message.organizationId,text:message.text}})
      if(error)return {error:error.message}
      const payload=data as {extraction?:unknown;error?:{message?:string}}
      if(payload?.error)return {error:payload.error.message||'AI parsing failed.'}
      return {extraction:payload.extraction}
    }
    case 'capture':{
      const {data,error}=await supabase.rpc('capture_prospect',{p_organization_id:message.organizationId,p_kind:message.kind,p_payload:message.payload,p_job_id:message.jobId||undefined})
      if(error)return {error:error.message}
      await bumpCaptured(1)
      return {result:data}
    }
    case 'bulk-capture':{
      const {data,error}=await supabase.rpc('capture_prospects_bulk',{p_organization_id:message.organizationId,p_kind:message.kind,p_items:message.items,p_job_id:message.jobId||undefined})
      if(error)return {error:error.message}
      const results=(data||[]) as {ok:boolean}[]
      await bumpCaptured(results.filter((r)=>r.ok).length)
      return {results}
    }
    case 'get-sourcing':return readSourcing()
    case 'start-sourcing':return startSourcing({organizationId:message.organizationId,jobId:message.jobId,jobTitle:message.jobTitle})
    case 'end-sourcing':return writeSourcing(IDLE)
  }
}

// Every call previously ran without an AbortSignal or timeout of any kind, so one hung request left the
// panel's button disabled and mid-label ("Thinking…") with no way back. Always answering -- even if the
// answer is a timeout -- is what lets the UI recover.
const TIMEOUT_MS:Partial<Record<BgRequest['type'],number>>={'ai-parse':45000,capture:20000,'bulk-capture':45000,connect:15000,session:15000}
const DEFAULT_TIMEOUT_MS=10000

chrome.runtime.onMessage.addListener((message:BgRequest,_sender,sendResponse)=>{
  trace('received',message.type,'from tab',_sender.tab?.id);
  (async()=>{
    let settled=false
    const reply=(value:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);sendResponse(value)}
    const timer=setTimeout(()=>{if(!settled){settled=true;sendResponse({error:'Timed out — try again.'})}},TIMEOUT_MS[message.type]||DEFAULT_TIMEOUT_MS)
    try{reply(await handle(message))}
    catch(err){reply({error:err instanceof Error?err.message:'Unexpected error'})}
  })()
  return true // keep the message channel open for the async sendResponse
})
