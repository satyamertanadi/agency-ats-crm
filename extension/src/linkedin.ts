import {api} from './api'
import {badgeFor} from './radar'
import {el,findProfileActionRow,isDark,isProfilePage,observeBody,onUrlChange} from './dom'
import {canonicalProfileUrl,hasContactInfoLink,profileText,readContactInfo,scrapeProfile} from './scrape'
import type {CapturePayload,CompanySummary,JobSummary,MemberSummary,ProspectKind,ProspectMatch,SourcingSession,StateResponse} from './messages'

// Profile-page cockpit: scrape (rich) → radar status → auto enrichment → capture the full candidate
// record with metadata. See scrape.ts for the DOM-fragility caveats.
function field(label:string,input:HTMLElement):HTMLLabelElement{return el('label',{className:'ats-field'},[el('span',{textContent:label}),input])}

const PANEL_ID='ats-sourcing-panel'
const BUTTON_ID='ats-capture-btn'
let panelOpen=false
let currentProfile=canonicalProfileUrl()

// Mirror of the background's sourcing session. Nothing in this file mounts, scrapes or looks anything
// up unless `sourcing.active` -- see applySourcing at the bottom.
let sourcing:SourcingSession={active:false,organizationId:'',startedAt:0,captured:0}

// Profiles where the drawer was explicitly closed. Auto-open must not fight the user: without this the
// close button reopens itself on the next navigation and reads as broken.
const autoSuppressed=new Set<string>()

function removePanel(){document.getElementById(PANEL_ID)?.remove();panelOpen=false;syncButtonVisibility()}
// Closing by hand is a decision about THIS profile, not about the session.
function dismissPanel(){autoSuppressed.add(canonicalProfileUrl());removePanel()}

// The floating fallback button would sit underneath the drawer; the in-row one is unaffected.
function syncButtonVisibility(){document.getElementById(BUTTON_ID)?.classList.toggle('ats-hidden',panelOpen)}

const STATUSES=['active','passive','placed','do_not_contact','archived']

// Fields the user has edited are never overwritten by a late-arriving scrape or by the automatic AI
// gap-fill -- both land asynchronously, so without this your typing could be clobbered mid-sentence.
type TextField=HTMLInputElement|HTMLTextAreaElement
const trackEdits=(input:TextField)=>{input.addEventListener('input',()=>{input.dataset.atsTouched='1'});return input}
const fillIfEmpty=(input:TextField,value:string|undefined)=>{if(value&&!input.value&&!input.dataset.atsTouched)input.value=value}

// One lookup per profile, started the moment the launcher mounts, so the panel already knows the ATS
// status before it opens -- and so the launcher itself can show it without opening anything.
let radarPrefetch:{url:string;promise:Promise<{match?:ProspectMatch;error?:string;organizationId?:string}>}|null=null

function primeRadar(url:string){
  if(radarPrefetch?.url===url)return radarPrefetch.promise
  const promise=(async()=>{
    try{
      const state=await api.getState()
      if(!state.connected||!state.organizations.length)return {}
      const organizationId=state.organizations[0].id
      const {matches,error}=await api.lookup(organizationId,[url])
      return error?{error,organizationId}:{match:matches?.[0],organizationId}
    }catch{return {error:'lookup failed'}}
  })()
  radarPrefetch={url,promise}
  return promise
}

async function openPanel(){
  if(panelOpen){dismissPanel();return}
  removePanel();panelOpen=true
  syncButtonVisibility()
  const profileUrl=canonicalProfileUrl()

  const root=el('div',{id:PANEL_ID,className:`ats-panel${isDark()?' ats-dark':''}`})
  const header=el('div',{className:'ats-header'},[
    el('div',{className:'ats-title'},[
      el('strong',{textContent:'Agency ATS'}),
      el('span',{className:'ats-subtitle',textContent:sourcing.jobTitle?`Sourcing · ${sourcing.jobTitle}`:'Sourcing · talent pool'}),
    ]),
    el('button',{className:'ats-x',textContent:'×',title:'Close',onclick:dismissPanel}),
  ])
  const body=el('div',{className:'ats-body'})
  root.append(header,body)
  document.body.append(root)

  let kind:ProspectKind='candidate'
  const rich:{employment:CapturePayload['employment'];education:CapturePayload['education'];skills:CapturePayload['skills'];languages:CapturePayload['languages'];private:NonNullable<CapturePayload['private']>}={
    employment:[],education:[],skills:[],languages:[],private:{},
  }

  const nameInput=trackEdits(el('input',{className:'ats-input'}))
  const positionInput=trackEdits(el('input',{className:'ats-input'}))
  const companyInput=trackEdits(el('input',{className:'ats-input'}))
  const locationInput=trackEdits(el('input',{className:'ats-input'}))
  const emailInput=trackEdits(el('input',{className:'ats-input',type:'email',placeholder:'Not on LinkedIn — Pull contact info or add'}))
  const phoneInput=trackEdits(el('input',{className:'ats-input',placeholder:'Optional'}))
  const linkedinInput=trackEdits(el('input',{className:'ats-input',value:profileUrl}))
  const noteInput=trackEdits(el('textarea',{className:'ats-input',rows:2,placeholder:'Why they’re a fit, where you found them…'}))
  const tagsInput=trackEdits(el('input',{className:'ats-input',placeholder:'e.g. Hot, Tech Leadership'}))
  tagsInput.setAttribute('list','ats-tag-list')
  const tagList=el('datalist',{id:'ats-tag-list'})

  const orgSelect=el('select',{className:'ats-input'})
  const jobSelect=el('select',{className:'ats-input'})
  const companySelect=el('select',{className:'ats-input'})
  const ownerSelect=el('select',{className:'ats-input'},[el('option',{value:'',textContent:'— unassigned —'})])
  const statusSelect=el('select',{className:'ats-input'},STATUSES.map((s)=>el('option',{value:s,textContent:s.replace(/_/g,' ')})))
  const jobField=field('Add to job (optional)',jobSelect)
  const companyField=field('Company (required for contacts)',companySelect)
  companyField.style.display='none'

  const radar=el('div',{className:'ats-radar'})
  const richSummary=el('p',{className:'ats-note'})
  const status=el('p',{className:'ats-note',textContent:'Reading profile…'})
  const updateSummary=()=>{richSummary.textContent=`Will save: ${(rich.employment||[]).length} role(s) · ${(rich.education||[]).length} school(s) · ${(rich.skills||[]).length} skill(s)`}
  updateSummary()

  const aiBtn=el('button',{className:'ats-btn ats-btn-ghost',textContent:'✨ AI clean-up'})
  const contactBtn=el('button',{className:'ats-btn ats-btn-ghost',textContent:'Pull contact info'})
  const saveBtn=el('button',{className:'ats-btn ats-btn-primary',textContent:'Save to ATS'})

  const kindToggle=el('div',{className:'ats-toggle'})
  const candBtn=el('button',{className:'ats-seg ats-seg-on',textContent:'Candidate'})
  const contBtn=el('button',{className:'ats-seg',textContent:'Contact'})
  const candidateOnly=el('div')
  const setKind=(next:ProspectKind)=>{kind=next;candBtn.className=`ats-seg${next==='candidate'?' ats-seg-on':''}`;contBtn.className=`ats-seg${next==='contact'?' ats-seg-on':''}`;jobField.style.display=next==='candidate'?'':'none';companyField.style.display=next==='contact'?'':'none';candidateOnly.style.display=next==='candidate'?'':'none';if(next==='contact')void loadCompanies()}
  candBtn.onclick=()=>setKind('candidate');contBtn.onclick=()=>setKind('contact')
  kindToggle.append(candBtn,contBtn)

  candidateOnly.append(field('Note',noteInput),field('Tags',tagsInput),tagList,field('Owner',ownerSelect),field('Status',statusSelect),jobField)
  // Painted before any await: the panel is on screen with the form laid out while the scrape and the
  // workspace lookups are still in flight, instead of staying blank until getState() returns.
  body.append(
    radar,kindToggle,
    el('div',{className:'ats-row'},[aiBtn,contactBtn]),richSummary,
    field('Name',nameInput),field('Position',positionInput),field('Company',companyInput),field('Location',locationInput),
    field('Email',emailInput),field('Phone',phoneInput),field('LinkedIn URL',linkedinInput),
    field('Workspace',orgSelect),companyField,candidateOnly,saveBtn,status,
  )

  // Enter anywhere in a single-line field saves; textareas keep their newline.
  root.addEventListener('keydown',(event)=>{
    if(event.key!=='Enter'||event.shiftKey)return
    if((event.target as HTMLElement)?.tagName!=='INPUT')return
    event.preventDefault();saveBtn.click()
  })

  async function loadJobs(){
    jobSelect.replaceChildren(el('option',{value:'',textContent:'— none —'}))
    const {jobs}=await api.listJobs(orgSelect.value)
    for(const j of (jobs||[]) as JobSummary[])jobSelect.append(el('option',{value:j.id,textContent:j.title}))
    // Pre-aim at the session's job -- visibly, in the same control you would use to change it. The
    // background never injects p_job_id behind your back; mis-filing a candidate is too expensive.
    if(sourcing.jobId&&(jobs||[]).some((j:JobSummary)=>j.id===sourcing.jobId))jobSelect.value=sourcing.jobId
  }
  async function loadCompanies(){companySelect.replaceChildren(el('option',{value:'',textContent:'— select company —'}));const {companies}=await api.listCompanies(orgSelect.value);for(const c of (companies||[]) as CompanySummary[])companySelect.append(el('option',{value:c.id,textContent:c.name}))}
  async function loadMembers(){ownerSelect.replaceChildren(el('option',{value:'',textContent:'— unassigned —'}));const {members}=await api.listMembers(orgSelect.value);for(const m of (members||[]) as MemberSummary[])ownerSelect.append(el('option',{value:m.id,textContent:m.name}))}
  async function loadTags(){const {tags}=await api.listTags(orgSelect.value);tagList.replaceChildren(...(tags||[]).map((t)=>el('option',{value:t})))}

  // Reuses badgeFor() so the panel and the list rows agree. The old hand-rolled version here checked
  // only `candidate`, so anyone already saved as a Contact was reported as "not yet in your ATS", and
  // it ignored `error` entirely -- a permission or network failure looked exactly like a clean miss.
  async function refreshRadar(force=false){
    radar.replaceChildren(el('span',{className:'ats-note',textContent:'Checking your ATS…'}))
    const url=linkedinInput.value.trim()||profileUrl
    const prefetch=radarPrefetch
    const prefetched=!force&&prefetch?.url===url?await prefetch.promise:undefined
    const result=prefetched&&prefetched.organizationId===orgSelect.value?prefetched:await (async()=>{
      const {matches,error}=await api.lookup(orgSelect.value,[url])
      return error?{error}:{match:matches?.[0]}
    })()
    if(!panelOpen)return
    if(result.error){radar.replaceChildren(el('span',{className:'ats-radar-badge ats-radar-err',textContent:'⚠ Could not check your ATS'}));return}
    radar.replaceChildren(badgeFor(result.match))
  }

  // Contact info is a purely local DOM read -- no request, no tokens -- so there is no reason to make
  // the user click for it. LinkedIn's overlay flashes open and shut once while this runs.
  async function autoContactInfo(){
    if(emailInput.value||!hasContactInfoLink())return
    try{
      const info=await readContactInfo()
      fillIfEmpty(emailInput,info.email);fillIfEmpty(phoneInput,info.phone)
    }catch{/* overlay didn't cooperate; the manual button is still there */}
  }

  // DOM-first: AI only runs when the scrape actually came up short, and then it fills blanks rather
  // than overwriting. A cleanly-scraped profile costs no tokens at all.
  function isIncomplete(){
    return !nameInput.value||!positionInput.value||!companyInput.value||!locationInput.value||!(rich.employment||[]).length
  }
  async function autoAiFill(organizationId:string){
    if(!isIncomplete())return
    status.className='ats-note';status.textContent='Filling gaps with AI…'
    const {extraction,error}=await api.aiParse(organizationId,profileText())
    if(!panelOpen)return
    if(error||!extraction){status.className='ats-note';status.textContent='Review and save.';return}
    fillIfEmpty(nameInput,extraction.full_name);fillIfEmpty(positionInput,extraction.current_position)
    fillIfEmpty(companyInput,extraction.current_company);fillIfEmpty(locationInput,extraction.location)
    fillIfEmpty(emailInput,extraction.private?.email);fillIfEmpty(phoneInput,extraction.private?.phone)
    if(!(rich.employment||[]).length&&extraction.employment?.length)rich.employment=extraction.employment
    if(!(rich.education||[]).length&&extraction.education?.length)rich.education=extraction.education
    if(!(rich.skills||[]).length&&extraction.skills?.length)rich.skills=extraction.skills
    if(!(rich.languages||[]).length&&extraction.languages?.length)rich.languages=extraction.languages
    rich.private={...(extraction.private||{}),...rich.private}
    updateSummary();status.className='ats-success';status.textContent='Filled gaps with AI — review and save.'
  }

  aiBtn.onclick=async()=>{
    const label=aiBtn.textContent
    aiBtn.disabled=true;aiBtn.textContent='Thinking…'
    try{
      const {extraction,error}=await api.aiParse(orgSelect.value,profileText())
      if(error||!extraction){status.className='ats-error';status.textContent=error||'AI parsing failed.';return}
      // The manual button is an explicit "redo this properly", so unlike the automatic pass it wins
      // over what's already in the form.
      if(extraction.full_name)nameInput.value=extraction.full_name
      if(extraction.current_position)positionInput.value=extraction.current_position
      if(extraction.current_company)companyInput.value=extraction.current_company
      if(extraction.location)locationInput.value=extraction.location
      if(extraction.private?.email)emailInput.value=extraction.private.email
      if(extraction.private?.phone)phoneInput.value=extraction.private.phone
      rich.employment=extraction.employment||rich.employment
      rich.education=extraction.education||rich.education
      rich.skills=extraction.skills||rich.skills
      rich.languages=extraction.languages||rich.languages
      rich.private={...rich.private,...(extraction.private||{})}
      updateSummary();status.className='ats-success';status.textContent='Structured by AI — review and save.'
    }catch(err){status.className='ats-error';status.textContent=err instanceof Error?err.message:'AI parsing failed.'}
    // finally, so a throw can never strand the button disabled and reading "Thinking…".
    finally{aiBtn.disabled=false;aiBtn.textContent=label}
  }

  contactBtn.onclick=async()=>{
    const label=contactBtn.textContent
    contactBtn.disabled=true;contactBtn.textContent='Reading…'
    try{
      const info=await readContactInfo()
      if(info.email)emailInput.value=info.email
      if(info.phone)phoneInput.value=info.phone
      status.className=info.email||info.phone?'ats-success':'ats-note'
      status.textContent=info.email||info.phone?'Contact info added.':'No contact info shared on this profile.'
    }catch{status.className='ats-error';status.textContent='Could not open the contact-info overlay.'}
    finally{contactBtn.disabled=false;contactBtn.textContent=label}
  }

  saveBtn.onclick=async()=>{
    if(!nameInput.value.trim()){status.className='ats-error';status.textContent='A name is required.';return}
    if(kind==='contact'&&!companySelect.value){status.className='ats-error';status.textContent='Choose a company for a contact.';return}
    if(!orgSelect.value){status.className='ats-error';status.textContent='Still loading your workspace — try again in a moment.';return}
    saveBtn.disabled=true;status.className='ats-note';status.textContent='Saving…'
    try{
      const payload:CapturePayload={
        full_name:nameInput.value.trim(),current_position:positionInput.value.trim()||undefined,current_company:companyInput.value.trim()||undefined,
        location:locationInput.value.trim()||undefined,linkedin_url:linkedinInput.value.trim()||undefined,source:'LinkedIn',
        private:{...rich.private,email:emailInput.value.trim()||rich.private.email,phone:phoneInput.value.trim()||rich.private.phone},
        company_id:kind==='contact'?companySelect.value:undefined,
      }
      if(kind==='candidate'){
        payload.employment=rich.employment;payload.education=rich.education;payload.skills=rich.skills;payload.languages=rich.languages
        payload.note=noteInput.value.trim()||undefined
        payload.tags=tagsInput.value.split(',').map((t)=>t.trim()).filter(Boolean)
        payload.owner_member_id=ownerSelect.value||undefined
        payload.status=statusSelect.value||undefined
      }
      const res=await api.capture(orgSelect.value,kind,payload,kind==='candidate'?jobSelect.value||undefined:undefined)
      if(res.error){status.className='ats-error';status.textContent=res.error;return}
      status.className='ats-success'
      status.textContent=res.result?.deduped?'Already in your ATS — record updated.':(res.result?.job_linked?'Added and placed in the job.':'Added to your ATS.')
      radarPrefetch=null
      void refreshRadar(true)
      void paintCaptureState()
    }catch(err){status.className='ats-error';status.textContent=err instanceof Error?err.message:'Could not save.'}
    finally{saveBtn.disabled=false}
  }

  // --- everything below is async; the form above is already interactive ---

  // Never rejects: the panel below decides its own fate on the state call, and an unhandled rejection
  // here would surface as a console error inside LinkedIn's page instead of anything actionable.
  const hydrate=(async()=>{
    try{
      const scraped=await scrapeProfile()
      if(!panelOpen)return
      rich.employment=scraped.employment||[];rich.education=scraped.education||[]
      rich.skills=scraped.skills||[];rich.languages=scraped.languages||[]
      fillIfEmpty(nameInput,scraped.full_name);fillIfEmpty(positionInput,scraped.current_position)
      fillIfEmpty(companyInput,scraped.current_company);fillIfEmpty(locationInput,scraped.location)
      fillIfEmpty(linkedinInput,scraped.linkedin_url)
      updateSummary()
      status.className='ats-note';status.textContent=''
      await autoContactInfo()
    }catch{
      status.className='ats-note';status.textContent='Could not read this profile — fill the fields in manually.'
    }
  })()

  let state:StateResponse
  try{state=await api.getState()}
  catch{
    // A content script left over from before an extension reload/update can no longer reach the
    // background ("Extension context invalidated"). Say so plainly instead of leaving a dead form.
    body.replaceChildren(
      el('p',{className:'ats-error',textContent:'The extension was updated or reloaded.'}),
      el('p',{className:'ats-note',textContent:'Refresh this LinkedIn page (F5) to reconnect the panel.'}),
      el('button',{className:'ats-btn ats-btn-primary',textContent:'Refresh page',onclick:()=>location.reload()}),
    )
    return
  }
  if(!panelOpen)return
  if(!state.connected){
    body.replaceChildren(
      el('p',{className:'ats-note',textContent:'Connect the extension to your ATS to capture profiles.'}),
      el('button',{className:'ats-btn ats-btn-primary',textContent:'Connect to ATS',onclick:async()=>{await api.connect();body.replaceChildren(el('p',{className:'ats-note',textContent:'A tab opened to your ATS. Sign in if needed, then click the extension again.'}))}}),
    )
    if(state.error)body.append(el('p',{className:'ats-error',textContent:state.error}))
    return
  }
  if(state.organizations.length===0){body.replaceChildren(el('p',{className:'ats-error',textContent:'Your account has no active workspace.'}));return}

  orgSelect.replaceChildren(...state.organizations.map((o)=>el('option',{value:o.id,textContent:o.name})))
  if(sourcing.organizationId&&state.organizations.some((o)=>o.id===sourcing.organizationId))orgSelect.value=sourcing.organizationId
  orgSelect.onchange=()=>{void refreshRadar(true);void loadJobs();void loadMembers();void loadTags();if(kind==='contact')void loadCompanies()}
  void refreshRadar();void loadJobs();void loadMembers();void loadTags()

  await hydrate
  // Gap-filling waits for the scrape so it can see what the DOM actually managed to produce.
  if(panelOpen)try{await autoAiFill(orgSelect.value)}catch{/* the form is filled and saveable regardless */}
}

// Turns the button into an answer to "do we already know them?" before anything is opened. The old
// 13px corner dot said the same thing far less legibly.
async function paintCaptureState(){
  const url=canonicalProfileUrl()
  const {match,error}=await primeRadar(url)
  const button=document.getElementById(BUTTON_ID)
  if(!button||canonicalProfileUrl()!==url||error)return
  const known=Boolean(match?.candidate||match?.contact)
  button.classList.toggle('ats-inline-in',known)
  button.textContent=known?'✓ In ATS':'Save to ATS'
  button.title=known?'Already in your Agency ATS — open to update':'Capture to Agency ATS'
}

// Sits inside LinkedIn's own action row (Message / Connect / More) when one can be found, so it reads
// as part of the profile rather than as an overlay. The floating pill is the fallback for layouts
// where the row cannot be located -- Recruiter, older templates, DOM churn.
function ensureCaptureButton(){
  const existing=document.getElementById(BUTTON_ID)
  if(!sourcing.active||!isProfilePage()){existing?.remove();removePanel();return}
  if(existing?.isConnected)return
  existing?.remove()
  const button=el('button',{id:BUTTON_ID,className:'ats-inline-btn',textContent:'Save to ATS',title:'Capture to Agency ATS',onclick:()=>void openPanel()})
  button.classList.toggle('ats-dark',isDark())
  const row=findProfileActionRow()
  if(row)row.append(button)
  else{button.classList.add('ats-inline-float');document.body.append(button)}
  syncButtonVisibility()
  void paintCaptureState()
}

// Opening by itself is only defensible because you told the extension you are sourcing. Fired on real
// navigation only -- never from the body observer, which would reopen a dismissed drawer constantly.
function maybeAutoOpen(){
  if(!sourcing.active||panelOpen||!isProfilePage())return
  if(autoSuppressed.has(canonicalProfileUrl()))return
  void openPanel()
}

function applySourcing(session:SourcingSession){
  const wasActive=sourcing.active
  sourcing=session
  if(!session.active){
    document.getElementById(BUTTON_ID)?.remove()
    removePanel()
    autoSuppressed.clear()
    radarPrefetch=null
    return
  }
  ensureCaptureButton()
  // Only auto-open when the session has just begun, not on every capture-count broadcast.
  if(!wasActive)maybeAutoOpen()
}

chrome.runtime.onMessage.addListener((message)=>{
  if(message?.type==='sourcing-changed')applySourcing(message.session)
  return undefined
})

onUrlChange(()=>{
  const profile=canonicalProfileUrl()
  if(profile!==currentProfile){
    currentProfile=profile
    // The open panel holds the PREVIOUS person's scraped data; leaving it up would let a save write
    // them against this URL. Note the contact-info overlay keeps the same slug, so it doesn't trip this.
    removePanel()
    radarPrefetch=null
  }
  ensureCaptureButton()
  maybeAutoOpen()
})
observeBody(ensureCaptureButton)

// Nothing above runs until this resolves and reports an active session. An orphaned content script
// (extension reloaded since this tab loaded) simply stays silent until the page is refreshed.
void (async()=>{try{applySourcing(await api.getSourcing())}catch{/* orphaned content script */}})()
