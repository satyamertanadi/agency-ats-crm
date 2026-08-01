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
