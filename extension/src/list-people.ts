import {api} from './api'
import {badgeFor} from './radar'
import {el,isDark,isListPage,onUrlChange,txtOf} from './dom'
import {canonicalProfileUrl} from './scrape'
import type {CapturePayload,JobSummary,OrgSummary,ProspectMatch,SourcingSession} from './messages'

// List surfaces: people-search results, a company's People tab, and post-engagement / "reactions"
// overlays. All three render each person as a list item containing an /in/ anchor, so one generic
// row scanner serves them. Each row gets an ATS radar badge + a checkbox; a floating bar bulk-captures
// the selected rows into a chosen job. Row data is shallow (name + headline + URL, no email) -- rich
// data still requires opening the profile. Reactive to the page only; never auto-scrolls to harvest.
function splitHeadline(h:string){const p=h.split(/\s+(?:at|@)\s+/i);return p.length>=2?{position:p[0].trim(),company:p.slice(1).join(' at ').trim()}:{position:h,company:''}}

interface Selected{url:string;name:string;headline:string}
const selected=new Map<string,Selected>()
let organizationId=''
let organizations:OrgSummary[]=[]
let bar:HTMLElement|null=null
let countLabel:HTMLElement|null=null
let jobSelect:HTMLSelectElement|null=null
let statusLabel:HTMLElement|null=null

function updateCount(){if(countLabel)countLabel.textContent=`${selected.size} selected`;if(bar)bar.style.display=selected.size>0?'flex':'none'}

async function loadJobs(){
  if(!jobSelect)return
  jobSelect.replaceChildren(el('option',{value:'',textContent:'— no specific job —'}))
  const {jobs}=await api.listJobs(organizationId)
  for(const j of (jobs||[]) as JobSummary[])jobSelect.append(el('option',{value:j.id,textContent:j.title}))
  // Pre-aimed at the session's target, shown in the control you would use to change it.
  if(sourcing.jobId&&(jobs||[]).some((j:JobSummary)=>j.id===sourcing.jobId))jobSelect.value=sourcing.jobId
}

function ensureBar(){
  if(bar)return
  bar=el('div',{id:'ats-bulk-bar',className:`ats-bulk-bar${isDark()?' ats-dark':''}`})
  countLabel=el('span',{className:'ats-bulk-count',textContent:'0 selected'})
  const orgSelect=el('select',{className:'ats-input ats-bulk-select'},organizations.map((o)=>el('option',{value:o.id,textContent:o.name})))
  orgSelect.value=organizationId
  orgSelect.onchange=()=>{organizationId=orgSelect.value;known.clear();void loadJobs();void resolveBadges(slots)}
  jobSelect=el('select',{className:'ats-input ats-bulk-select'})
  statusLabel=el('span',{className:'ats-note'})
  const captureBtn=el('button',{className:'ats-btn ats-btn-primary',textContent:'Capture selected'})
  captureBtn.onclick=async()=>{
    if(!selected.size)return
    captureBtn.disabled=true;if(statusLabel){statusLabel.className='ats-note';statusLabel.textContent='Capturing…'}
    try{
      const items:CapturePayload[]=Array.from(selected.values()).map((s)=>{const {position,company}=splitHeadline(s.headline);return {full_name:s.name,current_position:position||undefined,current_company:company||undefined,linkedin_url:s.url,source:'LinkedIn'}})
      const {results,error}=await api.bulkCapture(organizationId,'candidate',items,jobSelect?.value||undefined)
      if(error){if(statusLabel){statusLabel.className='ats-error';statusLabel.textContent=error}return}
      const ok=(results||[]).filter((r)=>r.ok).length
      if(statusLabel){statusLabel.className='ats-success';statusLabel.textContent=`Captured ${ok} of ${results?.length||0}.`}
      selected.clear();document.querySelectorAll<HTMLInputElement>('.ats-row-check').forEach((c)=>{c.checked=false});updateCount()
      // These rows are now in the ATS, so the cached verdicts are stale -- this is the one case that
      // justifies re-querying everything on screen.
      known.clear();void resolveBadges(slots)
    }catch(err){if(statusLabel){statusLabel.className='ats-error';statusLabel.textContent=err instanceof Error?err.message:'Capture failed.'}}
    finally{captureBtn.disabled=false}
  }
  const clearBtn=el('button',{className:'ats-btn ats-btn-ghost',textContent:'Clear',onclick:()=>{selected.clear();document.querySelectorAll<HTMLInputElement>('.ats-row-check').forEach((c)=>{c.checked=false});updateCount()}})
  bar.append(countLabel,el('span',{className:'ats-bulk-into',textContent:'→'}),orgSelect,jobSelect,captureBtn,clearBtn,statusLabel)
  bar.style.display='none'
  document.body.append(bar)
  void loadJobs()
}

function removeBar(){bar?.remove();bar=null;countLabel=null;jobSelect=null;statusLabel=null;selected.clear()}

function rowAnchor(li:Element):HTMLAnchorElement|null{
  const a=li.querySelector<HTMLAnchorElement>('a[href*="/in/"]')
  return a&&/\/in\//.test(a.getAttribute('href')||'')?a:null
}

interface Slot{url:string;slot:HTMLElement}
let slots:Slot[]=[]
// url -> match, or null for a confirmed miss. Caching the verdict is what lets a scroll batch query
// only the URLs it just introduced instead of everything accumulated so far.
const known=new Map<string,ProspectMatch|null>()

const chunk=<T,>(items:T[],size:number):T[][]=>{const out:T[][]=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out}

function paint(urls:string[]){
  const wanted=new Set(urls.map((u)=>u.toLowerCase()))
  for(const entry of slots){
    if(!entry.slot.isConnected||!wanted.has(entry.url.toLowerCase()))continue
    entry.slot.replaceChildren(badgeFor(known.get(entry.url)||undefined))
  }
}

async function resolveBadges(target:Slot[]){
  // Drop slots whose row LinkedIn has since recycled; the old code let this list grow forever and
  // re-sent every URL in it on each scroll batch.
  slots=slots.filter((entry)=>entry.slot.isConnected)
  if(!organizationId)return
  const cached=target.filter((entry)=>known.has(entry.url)).map((entry)=>entry.url)
  if(cached.length)paint(cached)
  const missing=Array.from(new Set(target.filter((entry)=>!known.has(entry.url)).map((entry)=>entry.url)))
  for(const batch of chunk(missing,50)){
    const {matches,error}=await api.lookup(organizationId,batch)
    if(error)return
    const byUrl=new Map((matches||[]).map((m:ProspectMatch)=>[m.linkedin_url.toLowerCase(),m]))
    for(const url of batch)known.set(url,byUrl.get(url.toLowerCase())||null)
    paint(batch)
  }
}

// Attach controls to any person row that doesn't have live ones. The presence check is deliberate:
// LinkedIn re-renders rows as you scroll, which strips our injected span while leaving the row in
// place -- keying only off a dataset marker left those rows permanently bare.
function processRows(candidates:HTMLElement[]):Slot[]{
  const fresh:Slot[]=[]
  for(const li of candidates){
    if(!li.isConnected||li.querySelector('.ats-row-controls'))continue
    const anchor=rowAnchor(li)
    if(!anchor||anchor.closest('.ats-row-controls'))continue
    // Skip nav/self chrome: require the row to carry visible text and an /in/ profile link.
    const url=canonicalProfileUrl(anchor.href)
    const name=txtOf(anchor.querySelector('span[aria-hidden="true"]'))||txtOf(anchor).split('View')[0].trim()
    if(!name||name.length<2)continue
    li.dataset.atsRow='1'
    const headline=txtOf(li.querySelector('.entity-result__primary-subtitle, .t-14.t-black--light, .subline-level-1'))
    const check=el('input',{className:'ats-row-check',type:'checkbox'}) as HTMLInputElement
    check.checked=selected.has(url)
    check.onchange=()=>{if(check.checked)selected.set(url,{url,name,headline});else selected.delete(url);updateCount()}
    const slot=el('span',{className:'ats-row-slot'})
    anchor.parentElement?.insertBefore(el('span',{className:`ats-row-controls${isDark()?' ats-dark':''}`},[check,slot]),anchor)
    fresh.push({url,slot})
  }
  return fresh
}

// Only look inside what actually changed. The previous implementation ran querySelectorAll('li') over
// the entire document every 2.5s, so the cost of a scan grew with the length of an infinite list.
function candidatesIn(roots:Element[]):HTMLElement[]{
  const out=new Set<HTMLElement>()
  for(const root of roots){
    if(!root.isConnected)continue
    const own=root.closest('li')
    if(own)out.add(own as HTMLElement)
    root.querySelectorAll('li').forEach((li)=>out.add(li as HTMLElement))
  }
  return Array.from(out)
}

let observer:MutationObserver|null=null
let pendingRoots=new Set<Element>()
let scanTimer:ReturnType<typeof setTimeout>|undefined

function scheduleScan(){
  if(scanTimer)clearTimeout(scanTimer)
  scanTimer=setTimeout(()=>{
    const roots=Array.from(pendingRoots);pendingRoots=new Set()
    const fresh=processRows(candidatesIn(roots))
    if(!fresh.length)return
    ensureBar()
    slots=slots.concat(fresh)
    void resolveBadges(fresh)
  },300)
}

function start(){
  if(observer)return
  observer=new MutationObserver((records)=>{
    for(const record of records)for(const node of Array.from(record.addedNodes))if(node instanceof Element)pendingRoots.add(node)
    if(pendingRoots.size)scheduleScan()
  })
  observer.observe(document.body,{childList:true,subtree:true})
  pendingRoots.add(document.body);scheduleScan()
}

function stop(){
  observer?.disconnect();observer=null
  if(scanTimer)clearTimeout(scanTimer)
  pendingRoots=new Set();slots=[];known.clear()
  removeBar()
}

// Mirror of the background's sourcing session. Until one is active this script does nothing at all:
// no observer, no injected controls, and above all no lookups. Previously it started on every list
// surface -- and isListPage() includes /feed and /mynetwork -- so casually scrolling your own feed
// injected a checkbox into every person row and fired batched queries at the ATS.
let sourcing:SourcingSession={active:false,organizationId:'',startedAt:0,captured:0}

// Chrome only injects content scripts on full page loads, so this script matches all of linkedin.com
// and decides for itself whether the current route is a list surface.
const sync=()=>{if(sourcing.active&&isListPage())start();else stop()}

// Deferred until a session actually starts. This used to run on every LinkedIn page load.
async function ensureWorkspaces():Promise<boolean>{
  if(organizations.length)return true
  let state:Awaited<ReturnType<typeof api.getState>>
  // An orphaned content script (extension reloaded since this tab loaded) cannot reach the background;
  // stay silent rather than throwing into LinkedIn's console. Refreshing the page restores it.
  try{state=await api.getState()}catch{return false}
  if(!state.connected||state.organizations.length===0)return false
  organizations=state.organizations;organizationId=organizations[0].id
  return true
}

async function applySourcing(session:SourcingSession){
  sourcing=session
  if(!session.active){stop();return}
  // Signed out or no workspace: stay dormant rather than injecting controls that cannot save.
  if(!await ensureWorkspaces()){sourcing={...session,active:false};return}
  if(session.organizationId&&session.organizationId!==organizationId){organizationId=session.organizationId;known.clear()}
  sync()
}

chrome.runtime.onMessage.addListener((message)=>{
  if(message?.type==='sourcing-changed')void applySourcing(message.session)
  return undefined
})

onUrlChange(sync)
void (async()=>{try{await applySourcing(await api.getSourcing())}catch{/* orphaned content script */}})()
