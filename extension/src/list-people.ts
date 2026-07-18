import {api} from './api'
import {badgeFor} from './radar'
import {canonicalProfileUrl} from './scrape'
import type {CapturePayload,JobSummary,OrgSummary,ProspectMatch} from './messages'

// List surfaces: people-search results, a company's People tab, and post-engagement / "reactions"
// overlays. All three render each person as a list item containing an /in/ anchor, so one generic
// row scanner serves them. Each row gets an ATS radar badge + a checkbox; a floating bar bulk-captures
// the selected rows into a chosen job. Row data is shallow (name + headline + URL, no email) -- rich
// data still requires opening the profile. Reactive to the page only; never auto-scrolls to harvest.
function el<K extends keyof HTMLElementTagNameMap>(tag:K,props:Partial<HTMLElementTagNameMap[K]>={},children:(Node|string)[]=[]):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);Object.assign(node,props);for(const c of children)node.append(c);return node
}
const txt=(node:Element|null|undefined)=>(node?.textContent||'').replace(/\s+/g,' ').trim()
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
}

function ensureBar(){
  if(bar)return
  bar=el('div',{id:'ats-bulk-bar',className:'ats-bulk-bar'})
  countLabel=el('span',{className:'ats-bulk-count',textContent:'0 selected'})
  const orgSelect=el('select',{className:'ats-input ats-bulk-select'},organizations.map((o)=>el('option',{value:o.id,textContent:o.name})))
  orgSelect.value=organizationId
  orgSelect.onchange=()=>{organizationId=orgSelect.value;void loadJobs()}
  jobSelect=el('select',{className:'ats-input ats-bulk-select'})
  statusLabel=el('span',{className:'ats-note'})
  const captureBtn=el('button',{className:'ats-btn ats-btn-primary',textContent:'Capture selected'})
  captureBtn.onclick=async()=>{
    if(!selected.size)return
    captureBtn.disabled=true;if(statusLabel){statusLabel.className='ats-note';statusLabel.textContent='Capturing…'}
    const items:CapturePayload[]=Array.from(selected.values()).map((s)=>{const {position,company}=splitHeadline(s.headline);return {full_name:s.name,current_position:position||undefined,current_company:company||undefined,linkedin_url:s.url,source:'LinkedIn'}})
    const {results,error}=await api.bulkCapture(organizationId,'candidate',items,jobSelect?.value||undefined)
    captureBtn.disabled=false
    if(error){if(statusLabel){statusLabel.className='ats-error';statusLabel.textContent=error}return}
    const ok=(results||[]).filter((r)=>r.ok).length
    if(statusLabel){statusLabel.className='ats-success';statusLabel.textContent=`Captured ${ok} of ${results?.length||0}.`}
    selected.clear();document.querySelectorAll<HTMLInputElement>('.ats-row-check').forEach((c)=>{c.checked=false});updateCount()
    void repaintRadar()
  }
  const clearBtn=el('button',{className:'ats-btn ats-btn-ghost',textContent:'Clear',onclick:()=>{selected.clear();document.querySelectorAll<HTMLInputElement>('.ats-row-check').forEach((c)=>{c.checked=false});updateCount()}})
  bar.append(countLabel,el('span',{className:'ats-bulk-into',textContent:'→'}),orgSelect,jobSelect,captureBtn,clearBtn,statusLabel)
  bar.style.display='none'
  document.body.append(bar)
  void loadJobs()
}

function rowAnchor(li:Element):HTMLAnchorElement|null{
  const a=li.querySelector<HTMLAnchorElement>('a[href*="/in/"]')
  return a&&/\/in\//.test(a.getAttribute('href')||'')?a:null
}

// Find unprocessed person rows on the page. A "row" is the nearest list item that contains an /in/ link.
function scanRows():{li:HTMLElement;anchor:HTMLAnchorElement;url:string;name:string;headline:string}[]{
  const out:{li:HTMLElement;anchor:HTMLAnchorElement;url:string;name:string;headline:string}[]=[]
  document.querySelectorAll<HTMLElement>('li').forEach((li)=>{
    if(li.dataset.atsRow)return
    const anchor=rowAnchor(li)
    if(!anchor)return
    // Skip nav/self chrome: require the row to carry visible text and an /in/ profile link.
    const url=canonicalProfileUrl(anchor.href)
    const name=txt(anchor.querySelector('span[aria-hidden="true"]'))||txt(anchor).split('View')[0].trim()
    if(!name||name.length<2)return
    li.dataset.atsRow='1'
    const headline=txt(li.querySelector('.entity-result__primary-subtitle, .t-14.t-black--light, .subline-level-1'))
    out.push({li,anchor,url,name,headline})
  })
  return out
}

const badgeSlots=new Map<string,HTMLElement>()

async function repaintRadar(){
  const urls=Array.from(badgeSlots.keys())
  if(!urls.length)return
  const {matches}=await api.lookup(organizationId,urls)
  const byUrl=new Map((matches||[]).map((m:ProspectMatch)=>[m.linkedin_url.toLowerCase(),m]))
  for(const [url,slot] of badgeSlots){slot.replaceChildren(badgeFor(byUrl.get(url.toLowerCase())))}
}

async function processNewRows(){
  const rows=scanRows()
  if(!rows.length)return
  ensureBar()
  for(const row of rows){
    const check=el('input',{className:'ats-row-check',type:'checkbox'}) as HTMLInputElement
    check.onchange=()=>{if(check.checked)selected.set(row.url,{url:row.url,name:row.name,headline:row.headline});else selected.delete(row.url);updateCount()}
    const slot=el('span',{className:'ats-row-slot'})
    badgeSlots.set(row.url,slot)
    const wrap=el('span',{className:'ats-row-controls'},[check,slot])
    row.anchor.parentElement?.insertBefore(wrap,row.anchor)
  }
  await repaintRadar()
}

async function init(){
  const state=await api.getState()
  if(!state.connected||state.organizations.length===0)return
  organizations=state.organizations;organizationId=organizations[0].id
  await processNewRows()
  // LinkedIn is a SPA with infinite lists; re-scan periodically for rows added by scroll/navigation.
  setInterval(()=>{void processNewRows()},2500)
}
void init()
