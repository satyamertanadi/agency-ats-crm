import {api} from './api'
import {profileText,readContactInfo,scrapeProfile} from './scrape'
import type {CapturePayload,CompanySummary,JobSummary,MemberSummary,ProspectKind} from './messages'

// Profile-page cockpit: scrape (rich) → radar status → optional AI clean-up / contact-info → capture
// the full candidate record with metadata. See scrape.ts for the DOM-fragility caveats.
function el<K extends keyof HTMLElementTagNameMap>(tag:K,props:Partial<HTMLElementTagNameMap[K]>={},children:(Node|string)[]=[]):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);Object.assign(node,props);for(const c of children)node.append(c);return node
}
function field(label:string,input:HTMLElement):HTMLLabelElement{return el('label',{className:'ats-field'},[el('span',{textContent:label}),input])}

const PANEL_ID='ats-sourcing-panel'
let panelOpen=false
function removePanel(){document.getElementById(PANEL_ID)?.remove();panelOpen=false}

const STATUSES=['active','passive','placed','do_not_contact','archived']

async function openPanel(){
  if(panelOpen){removePanel();return}
  removePanel();panelOpen=true
  const scraped=scrapeProfile()
  // Rich arrays travel silently with the capture; the panel shows a summary and lets AI refill them.
  const rich:{employment:CapturePayload['employment'];education:CapturePayload['education'];skills:CapturePayload['skills'];languages:CapturePayload['languages'];private:NonNullable<CapturePayload['private']>}={
    employment:scraped.employment||[],education:[],skills:scraped.skills||[],languages:[],private:{},
  }

  const root=el('div',{id:PANEL_ID,className:'ats-panel'})
  const header=el('div',{className:'ats-header'},[el('strong',{textContent:'Agency ATS'}),el('button',{className:'ats-x',textContent:'×',title:'Close',onclick:removePanel})])
  const body=el('div',{className:'ats-body'})
  root.append(header,body)
  document.body.append(root)

  // A content script left over from before an extension reload/update can no longer reach the
  // background ("Extension context invalidated"). Say so plainly instead of rendering an empty panel.
  let state:Awaited<ReturnType<typeof api.getState>>
  try{state=await api.getState()}
  catch{
    body.append(
      el('p',{className:'ats-error',textContent:'The extension was updated or reloaded.'}),
      el('p',{className:'ats-note',textContent:'Refresh this LinkedIn page (F5) to reconnect the panel.'}),
      el('button',{className:'ats-btn ats-btn-primary',textContent:'Refresh page',onclick:()=>location.reload()}),
    )
    return
  }
  if(!state.connected){
    body.append(
      el('p',{className:'ats-note',textContent:'Connect the extension to your ATS to capture profiles.'}),
      el('button',{className:'ats-btn ats-btn-primary',textContent:'Connect to ATS',onclick:async()=>{await api.connect();body.replaceChildren(el('p',{className:'ats-note',textContent:'A tab opened to your ATS. Sign in if needed, then click the extension again.'}))}}),
    )
    if(state.error)body.append(el('p',{className:'ats-error',textContent:state.error}))
    return
  }
  if(state.organizations.length===0){body.append(el('p',{className:'ats-error',textContent:'Your account has no active workspace.'}));return}

  let kind:ProspectKind='candidate'
  const nameInput=el('input',{className:'ats-input',value:scraped.full_name||''})
  const positionInput=el('input',{className:'ats-input',value:scraped.current_position||''})
  const companyInput=el('input',{className:'ats-input',value:scraped.current_company||''})
  const locationInput=el('input',{className:'ats-input',value:scraped.location||''})
  const emailInput=el('input',{className:'ats-input',type:'email',placeholder:'Not on LinkedIn — Pull contact info or add'})
  const phoneInput=el('input',{className:'ats-input',placeholder:'Optional'})
  const linkedinInput=el('input',{className:'ats-input',value:scraped.linkedin_url||''})
  const noteInput=el('textarea',{className:'ats-input',rows:2,placeholder:'Why they’re a fit, where you found them…'})
  const tagsInput=el('input',{className:'ats-input',placeholder:'e.g. Hot, Tech Leadership'})
  tagsInput.setAttribute('list','ats-tag-list')
  const tagList=el('datalist',{id:'ats-tag-list'})

  const orgSelect=el('select',{className:'ats-input'},state.organizations.map((o)=>el('option',{value:o.id,textContent:o.name})))
  const jobSelect=el('select',{className:'ats-input'})
  const companySelect=el('select',{className:'ats-input'})
  const ownerSelect=el('select',{className:'ats-input'},[el('option',{value:'',textContent:'— unassigned —'})])
  const statusSelect=el('select',{className:'ats-input'},STATUSES.map((s)=>el('option',{value:s,textContent:s.replace(/_/g,' ')})))
  const jobField=field('Add to job (optional)',jobSelect)
  const companyField=field('Company (required for contacts)',companySelect)
  companyField.style.display='none'

  const radar=el('div',{className:'ats-radar'})
  const richSummary=el('p',{className:'ats-note'})
  const updateSummary=()=>{richSummary.textContent=`Will save: ${(rich.employment||[]).length} role(s) · ${(rich.skills||[]).length} skill(s)`}
  updateSummary()

  async function refreshRadar(){
    radar.replaceChildren(el('span',{className:'ats-note',textContent:'Checking your ATS…'}))
    const {matches}=await api.lookup(orgSelect.value,[scraped.linkedin_url||''])
    const m=matches?.[0]
    if(m?.candidate){
      const stage=m.candidate.stages[0]
      radar.replaceChildren(el('span',{className:'ats-radar-badge ats-radar-in',textContent:stage?`● Already in ATS · ${stage.stage}`:`● Already in ATS · ${m.candidate.status}`}))
    }else radar.replaceChildren(el('span',{className:'ats-radar-badge ats-radar-out',textContent:'○ Not yet in your ATS'}))
  }
  async function loadJobs(){jobSelect.replaceChildren(el('option',{value:'',textContent:'— none —'}));const {jobs}=await api.listJobs(orgSelect.value);for(const j of (jobs||[]) as JobSummary[])jobSelect.append(el('option',{value:j.id,textContent:j.title}))}
  async function loadCompanies(){companySelect.replaceChildren(el('option',{value:'',textContent:'— select company —'}));const {companies}=await api.listCompanies(orgSelect.value);for(const c of (companies||[]) as CompanySummary[])companySelect.append(el('option',{value:c.id,textContent:c.name}))}
  async function loadMembers(){ownerSelect.replaceChildren(el('option',{value:'',textContent:'— unassigned —'}));const {members}=await api.listMembers(orgSelect.value);for(const m of (members||[]) as MemberSummary[])ownerSelect.append(el('option',{value:m.id,textContent:m.name}))}
  async function loadTags(){const {tags}=await api.listTags(orgSelect.value);tagList.replaceChildren(...(tags||[]).map((t)=>el('option',{value:t})))}
  orgSelect.onchange=()=>{void refreshRadar();void loadJobs();void loadMembers();void loadTags();if(kind==='contact')void loadCompanies()}

  const kindToggle=el('div',{className:'ats-toggle'})
  const candBtn=el('button',{className:'ats-seg ats-seg-on',textContent:'Candidate'})
  const contBtn=el('button',{className:'ats-seg',textContent:'Contact'})
  const candidateOnly=el('div')
  const setKind=(next:ProspectKind)=>{kind=next;candBtn.className=`ats-seg${next==='candidate'?' ats-seg-on':''}`;contBtn.className=`ats-seg${next==='contact'?' ats-seg-on':''}`;jobField.style.display=next==='candidate'?'':'none';companyField.style.display=next==='contact'?'':'none';candidateOnly.style.display=next==='candidate'?'':'none';if(next==='contact')void loadCompanies()}
  candBtn.onclick=()=>setKind('candidate');contBtn.onclick=()=>setKind('contact')
  kindToggle.append(candBtn,contBtn)

  const status=el('p',{className:'ats-note'})

  const aiBtn=el('button',{className:'ats-btn ats-btn-ghost',textContent:'✨ AI clean-up'})
  aiBtn.onclick=async()=>{
    aiBtn.disabled=true;const label=aiBtn.textContent;aiBtn.textContent='Thinking…'
    const {extraction,error}=await api.aiParse(orgSelect.value,profileText())
    aiBtn.disabled=false;aiBtn.textContent=label
    if(error||!extraction){status.className='ats-error';status.textContent=error||'AI parsing failed.';return}
    if(extraction.full_name)nameInput.value=extraction.full_name
    if(extraction.current_position)positionInput.value=extraction.current_position
    if(extraction.current_company)companyInput.value=extraction.current_company
    if(extraction.location)locationInput.value=extraction.location
    if(extraction.private?.email)emailInput.value=extraction.private.email
    if(extraction.private?.phone)phoneInput.value=extraction.private.phone
    rich.employment=extraction.employment||rich.employment
    rich.education=extraction.education||[]
    rich.skills=extraction.skills||rich.skills
    rich.languages=extraction.languages||[]
    rich.private={...rich.private,...(extraction.private||{})}
    updateSummary();status.className='ats-success';status.textContent='Structured by AI — review and save.'
  }
  const contactBtn=el('button',{className:'ats-btn ats-btn-ghost',textContent:'Pull contact info'})
  contactBtn.onclick=async()=>{
    contactBtn.disabled=true;const label=contactBtn.textContent;contactBtn.textContent='Reading…'
    const info=await readContactInfo()
    contactBtn.disabled=false;contactBtn.textContent=label
    if(info.email)emailInput.value=info.email
    if(info.phone)phoneInput.value=info.phone
    status.className=info.email||info.phone?'ats-success':'ats-note'
    status.textContent=info.email||info.phone?'Contact info added.':'No contact info shared on this profile.'
  }

  const saveBtn=el('button',{className:'ats-btn ats-btn-primary',textContent:'Save to ATS'})
  saveBtn.onclick=async()=>{
    if(!nameInput.value.trim()){status.className='ats-error';status.textContent='A name is required.';return}
    if(kind==='contact'&&!companySelect.value){status.className='ats-error';status.textContent='Choose a company for a contact.';return}
    saveBtn.disabled=true;status.className='ats-note';status.textContent='Saving…'
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
    saveBtn.disabled=false
    if(res.error){status.className='ats-error';status.textContent=res.error;return}
    status.className='ats-success'
    status.textContent=res.result?.deduped?'Already in your ATS — record updated.':(res.result?.job_linked?'Added and placed in the job.':'Added to your ATS.')
    void refreshRadar()
  }

  candidateOnly.append(
    field('Note',noteInput),field('Tags',tagsInput),tagList,
    field('Owner',ownerSelect),field('Status',statusSelect),jobField,
  )
  body.append(
    radar,kindToggle,
    el('div',{className:'ats-row'},[aiBtn,contactBtn]),richSummary,
    field('Name',nameInput),field('Position',positionInput),field('Company',companyInput),field('Location',locationInput),
    field('Email',emailInput),field('Phone',phoneInput),field('LinkedIn URL',linkedinInput),
    field('Workspace',orgSelect),companyField,candidateOnly,saveBtn,status,
  )
  void refreshRadar();void loadJobs();void loadMembers();void loadTags()
}

function ensureLauncher(){
  if(document.getElementById('ats-launcher'))return
  const btn=el('button',{id:'ats-launcher',className:'ats-launcher',textContent:'ATS',title:'Capture to Agency ATS',onclick:()=>void openPanel()})
  document.body.append(btn)
}
ensureLauncher()
setInterval(ensureLauncher,2000)
