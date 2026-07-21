import {useEffect,useState,type ReactNode} from 'react'

/* Generalizes the ad hoc <details className="advanced-fields"> / "filter-panel" pattern used
 * elsewhere in the app. `forceOpen` is a one-way signal (e.g. "this section has a low-confidence
 * field") -- it opens the section once but does not fight a user who collapses it back afterward,
 * since the effect only reacts to forceOpen flipping true, not to `open` itself. */
export function CollapsibleSection({title,badge,defaultOpen=false,forceOpen=false,className='',children}:{title:string;badge?:ReactNode;defaultOpen?:boolean;forceOpen?:boolean;className?:string;children:ReactNode}){
  const [open,setOpen]=useState(defaultOpen||forceOpen)
  useEffect(()=>{if(forceOpen)setOpen(true)},[forceOpen])
  return <details className={['collapsible-section',className].filter(Boolean).join(' ')} open={open} onToggle={(event)=>setOpen(event.currentTarget.open)}>
    <summary><span>{title}</span>{badge}</summary>
    <div className="collapsible-section-body">{children}</div>
  </details>
}
