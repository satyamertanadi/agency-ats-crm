import type {CaptureResult,CompanySummary,JobSummary,ProspectKind,StateResponse} from './messages'

// LinkedIn's DOM is obfuscated and changes without notice (see extension/README.md). Every selector
// here is best-effort with fallbacks, and whatever we scrape is pre-filled into an EDITABLE form the
// user confirms -- so a broken selector degrades to an empty field, never a wrong save.
const q=(sel:string,root:ParentNode=document)=>root.querySelector(sel)
const txt=(sel:string,root:ParentNode=document)=>(q(sel,root)?.textContent||'').replace(/\s+/g,' ').trim()

function canonicalProfileUrl():string{
  const match=location.pathname.match(/\/in\/([^/]+)/)
  return match?`https://www.linkedin.com/in/${match[1]}/`:location.href.split('?')[0]
}

interface Scraped{full_name:string;headline:string;current_position:string;current_company:string;location:string;linkedin_url:string}
function scrape():Scraped{
  const full_name=txt('main h1')||txt('h1')
  const headline=txt('main .text-body-medium.break-words')||txt('.pv-text-details__left-panel .text-body-medium')||txt('[data-generated-suggestion-target]')
  const location=txt('main .text-body-small.inline.t-black--light.break-words')||txt('.pv-text-details__left-panel .text-body-small.inline')
  // The top-card "current company" button, when present, is the most reliable company signal.
  let current_company=txt('main button[aria-label^="Current company"]')||txt('[data-field="experience_company_logo"]')
  let current_position=''
  // Headlines are commonly "Position at Company" / "Position @ Company"; split as a fallback.
  const parts=headline.split(/\s+(?:at|@)\s+/i)
  if(parts.length>=2){current_position=parts[0].trim();if(!current_company)current_company=parts.slice(1).join(' at ').trim()}
  else current_position=headline
  return {full_name,headline,current_position,current_company,location,linkedin_url:canonicalProfileUrl()}
}

// --- panel ---------------------------------------------------------------------------------------
const PANEL_ID='ats-sourcing-panel'
let panelOpen=false

function el<K extends keyof HTMLElementTagNameMap>(tag:K,props:Partial<HTMLElementTagNameMap[K]>={},children:(Node|string)[]=[]):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);Object.assign(node,props);for(const c of children)node.append(c);return node
}
function field(label:string,input:HTMLElement):HTMLLabelElement{return el('label',{className:'ats-field'},[el('span',{textContent:label}),input])}
async function send<T>(message:unknown):Promise<T>{return chrome.runtime.sendMessage<T>(message)}

function removePanel(){document.getElementById(PANEL_ID)?.remove();panelOpen=false}

async function openPanel(){
  if(panelOpen){removePanel();return}
  removePanel();panelOpen=true
  const data=scrape()
  const root=el('div',{id:PANEL_ID,className:'ats-panel'})
  const header=el('div',{className:'ats-header'},[el('strong',{textContent:'Agency ATS'}),el('button',{className:'ats-x',textContent:'×',title:'Close',onclick:removePanel})])
  const body=el('div',{className:'ats-body'})
  root.append(header,body)
  document.body.append(root)

  const state=await send<StateResponse>({type:'get-state'})
  if(!state.connected){
    body.append(
      el('p',{className:'ats-note',textContent:'Connect the extension to your ATS to capture profiles.'}),
      el('button',{className:'ats-btn ats-btn-primary',textContent:'Connect to ATS',onclick:async()=>{
        await send({type:'connect'});body.replaceChildren(el('p',{className:'ats-note',textContent:'A tab opened to your ATS. Sign in if needed, then click the extension again.'}))
      }}),
    )
    if(state.error)body.append(el('p',{className:'ats-error',textContent:state.error}))
    return
  }
  if(state.organizations.length===0){body.append(el('p',{className:'ats-error',textContent:'Your account has no active workspace.'}));return}

  // Form state
  let kind:ProspectKind='candidate'
  const nameInput=el('input',{className:'ats-input',value:data.full_name})
  const positionInput=el('input',{className:'ats-input',value:data.current_position})
  const companyInput=el('input',{className:'ats-input',value:data.current_company})
  const locationInput=el('input',{className:'ats-input',value:data.location})
  const emailInput=el('input',{className:'ats-input',type:'email',placeholder:'Not on LinkedIn — add if known'})
  const linkedinInput=el('input',{className:'ats-input',value:data.linkedin_url})

  const orgSelect=el('select',{className:'ats-input'},state.organizations.map((o)=>el('option',{value:o.id,textContent:o.name})))
  const jobSelect=el('select',{className:'ats-input'})
  const companySelect=el('select',{className:'ats-input'})
  const jobField=field('Add to job (optional)',jobSelect)
  const companyField=field('Company (required for contacts)',companySelect)
  companyField.style.display='none'

  async function loadJobs(){
    jobSelect.replaceChildren(el('option',{value:'',textContent:'— none —'}))
    const {jobs}=await send<{jobs:JobSummary[]}>({type:'list-jobs',organizationId:orgSelect.value})
    for(const j of jobs)jobSelect.append(el('option',{value:j.id,textContent:j.title}))
  }
  async function loadCompanies(){
    companySelect.replaceChildren(el('option',{value:'',textContent:'— select company —'}))
    const {companies}=await send<{companies:CompanySummary[]}>({type:'list-companies',organizationId:orgSelect.value})
    for(const c of companies)companySelect.append(el('option',{value:c.id,textContent:c.name}))
  }
  orgSelect.onchange=()=>{void loadJobs();if(kind==='contact')void loadCompanies()}

  const kindToggle=el('div',{className:'ats-toggle'})
  const candBtn=el('button',{className:'ats-seg ats-seg-on',textContent:'Candidate'})
  const contBtn=el('button',{className:'ats-seg',textContent:'Contact'})
  const setKind=(next:ProspectKind)=>{
    kind=next
    candBtn.className=`ats-seg${next==='candidate'?' ats-seg-on':''}`
    contBtn.className=`ats-seg${next==='contact'?' ats-seg-on':''}`
    jobField.style.display=next==='candidate'?'':'none'
    companyField.style.display=next==='contact'?'':'none'
    if(next==='contact')void loadCompanies()
  }
  candBtn.onclick=()=>setKind('candidate');contBtn.onclick=()=>setKind('contact')
  kindToggle.append(candBtn,contBtn)

  const status=el('p',{className:'ats-note'})
  const saveBtn=el('button',{className:'ats-btn ats-btn-primary',textContent:'Save to ATS'})
  saveBtn.onclick=async()=>{
    if(!nameInput.value.trim()){status.className='ats-error';status.textContent='A name is required.';return}
    if(kind==='contact'&&!companySelect.value){status.className='ats-error';status.textContent='Choose a company for a contact.';return}
    saveBtn.disabled=true;status.className='ats-note';status.textContent='Saving…'
    const res=await send<CaptureResult>({type:'capture',organizationId:orgSelect.value,kind,jobId:kind==='candidate'?jobSelect.value||undefined:undefined,payload:{
      full_name:nameInput.value.trim(),current_position:positionInput.value.trim()||undefined,current_company:companyInput.value.trim()||undefined,
      location:locationInput.value.trim()||undefined,email:emailInput.value.trim()||undefined,linkedin_url:linkedinInput.value.trim()||undefined,
      company_id:kind==='contact'?companySelect.value:undefined,source:'LinkedIn',
    }})
    saveBtn.disabled=false
    if(res.error){status.className='ats-error';status.textContent=res.error;return}
    status.className='ats-success'
    status.textContent=res.result?.deduped?'Already in your ATS — record updated.':(res.result?.job_linked?'Added and placed in the job.':'Added to your ATS.')
  }

  body.append(kindToggle,field('Name',nameInput),field('Position',positionInput),field('Company',companyInput),field('Location',locationInput),field('Email',emailInput),field('LinkedIn URL',linkedinInput),field('Workspace',orgSelect),jobField,companyField,saveBtn,status)
  void loadJobs()
}

// Floating launcher button, re-added if LinkedIn's SPA navigation wipes it.
function ensureLauncher(){
  if(document.getElementById('ats-launcher'))return
  const btn=el('button',{id:'ats-launcher',className:'ats-launcher',textContent:'ATS',title:'Capture to Agency ATS',onclick:()=>void openPanel()})
  document.body.append(btn)
}
ensureLauncher()
setInterval(ensureLauncher,2000)
