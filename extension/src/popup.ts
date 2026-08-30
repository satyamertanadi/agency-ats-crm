import {api} from './api'
import {el} from './dom'
import type {JobSummary,OrgSummary,SourcingSession} from './messages'

// The session console behind the toolbar button.
//
// This is where a sourcing session is armed, aimed and ended -- and, deliberately, where connecting to
// the ATS now lives. Connect used to be buried inside the profile panel, which meant discovering you
// were signed out only after landing on someone worth capturing.
const root=document.getElementById('ats-popup') as HTMLElement

// Nothing here runs inside LinkedIn, so the OS preference is the only theme signal available.
if(window.matchMedia?.('(prefers-color-scheme: dark)').matches)root.classList.add('ats-dark')

const note=(text:string)=>el('p',{className:'ats-note',textContent:text})
const heading=(text:string)=>el('div',{className:'ats-popup-head'},[el('strong',{textContent:text})])

function show(...nodes:(Node|string)[]){root.replaceChildren(...nodes)}

function renderDisconnected(error?:string){
  show(
    heading('Agency ATS'),
    note('Connect to your ATS before sourcing.'),
    el('button',{className:'ats-btn ats-btn-primary',textContent:'Connect to ATS',onclick:async()=>{
      await api.connect()
      show(heading('Agency ATS'),note('A tab opened to your ATS. Sign in there, then open this menu again.'))
    }}),
    ...(error?[el('p',{className:'ats-error',textContent:error})]:[]),
  )
}

function renderConsole(organizations:OrgSummary[],session:SourcingSession){
  const orgSelect=el('select',{className:'ats-input'},organizations.map((o)=>el('option',{value:o.id,textContent:o.name})))
  orgSelect.value=session.organizationId&&organizations.some((o)=>o.id===session.organizationId)?session.organizationId:organizations[0].id

  const jobSelect=el('select',{className:'ats-input'})
  const status=el('p',{className:'ats-note'})

  async function loadJobs(){
    jobSelect.replaceChildren(el('option',{value:'',textContent:'— talent pool (no job) —'}))
    const {jobs}=await api.listJobs(orgSelect.value)
    for(const j of (jobs||[]) as JobSummary[])jobSelect.append(el('option',{value:j.id,textContent:j.title}))
    if(session.jobId&&(jobs||[]).some((j:JobSummary)=>j.id===session.jobId))jobSelect.value=session.jobId
  }
  orgSelect.onchange=()=>{void loadJobs()}

  const jobTitleOf=()=>jobSelect.options[jobSelect.selectedIndex]?.textContent||undefined

  const primary=el('button',{className:'ats-btn ats-btn-primary',textContent:session.active?'Update target':'Start sourcing'})
  primary.onclick=async()=>{
    primary.disabled=true
    try{
      const next=await api.startSourcing(orgSelect.value,jobSelect.value||undefined,jobSelect.value?jobTitleOf():undefined)
      render(next)
    }catch(err){status.className='ats-error';status.textContent=err instanceof Error?err.message:'Could not start.'}
    finally{primary.disabled=false}
  }

  const nodes:(Node|string)[]=[
    heading('Agency ATS'),
    el('label',{className:'ats-field'},[el('span',{textContent:'Workspace'}),orgSelect]),
    el('label',{className:'ats-field'},[el('span',{textContent:'Sourcing for'}),jobSelect]),
  ]

  if(session.active){
    nodes.push(
      el('p',{className:'ats-popup-live'},[
        el('span',{className:'ats-radar-badge ats-radar-in',textContent:`● Sourcing · ${session.captured} captured`}),
      ]),
      el('div',{className:'ats-row'},[
        primary,
        el('button',{className:'ats-btn ats-btn-ghost',textContent:'End session',onclick:async()=>{render(await api.endSourcing())}}),
      ]),
    )
  }else{
    nodes.push(
      primary,
      note('While a session runs, LinkedIn gets the capture button, row checkboxes and “already in ATS” badges. Outside one, nothing is injected and nothing is queried.'),
    )
  }

  nodes.push(status,el('p',{className:'ats-popup-hint',textContent:'Alt+Shift+A starts or ends a session with the last target.'}))
  show(...nodes)
  void loadJobs()
}

function render(session:SourcingSession){
  void (async()=>{
    let state
    try{state=await api.getState()}
    catch{show(heading('Agency ATS'),el('p',{className:'ats-error',textContent:'The extension was reloaded — reopen this menu.'}));return}
    if(!state.connected){renderDisconnected(state.error);return}
    if(!state.organizations.length){show(heading('Agency ATS'),el('p',{className:'ats-error',textContent:'Your account has no active workspace.'}));return}
    renderConsole(state.organizations,session)
  })()
}

show(heading('Agency ATS'),note('Loading…'))
void (async()=>{
  try{render(await api.getSourcing())}
  catch{show(heading('Agency ATS'),el('p',{className:'ats-error',textContent:'The extension was reloaded — reopen this menu.'}))}
})()
