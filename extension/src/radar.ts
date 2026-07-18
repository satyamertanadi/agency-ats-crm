import {api} from './api'
import type {ProspectMatch} from './messages'

// Turns a lookup match into an inline badge. Reused on the profile panel and on every list row.
export function badgeFor(match:ProspectMatch|undefined):HTMLElement{
  const el=document.createElement('span')
  el.className='ats-radar-badge'
  if(match?.candidate){
    const stage=match.candidate.stages[0]
    el.classList.add('ats-radar-in')
    el.textContent=stage?`● In ATS · ${stage.stage}`:`● In ATS · ${match.candidate.status}`
    if(match.candidate.stages.length>1)el.title=match.candidate.stages.map((s)=>`${s.job}: ${s.stage}`).join('\n')
  }else if(match?.contact){
    el.classList.add('ats-radar-in')
    el.textContent='● Contact in ATS'
  }else{
    el.classList.add('ats-radar-out')
    el.textContent='○ Not in ATS'
  }
  return el
}

// One batched lookup for every URL on a page, then place each badge next to its row. Callers supply a
// `place` callback so radar stays agnostic to each surface's DOM.
export async function paintRadar(organizationId:string,targets:{url:string;place:(badge:HTMLElement)=>void}[]):Promise<void>{
  const urls=Array.from(new Set(targets.map((t)=>t.url).filter(Boolean)))
  if(!urls.length)return
  const {matches,error}=await api.lookup(organizationId,urls)
  if(error||!matches)return
  const byUrl=new Map(matches.map((m)=>[m.linkedin_url.toLowerCase(),m]))
  for(const t of targets)t.place(badgeFor(byUrl.get(t.url.toLowerCase())))
}
