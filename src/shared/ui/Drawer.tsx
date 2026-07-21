import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export interface DrawerProps {title:string;description?:string;eyebrow?:string;open:boolean;onClose:()=>void;children:ReactNode;footer?:ReactNode}

export function Drawer({title,description,eyebrow='Quick create',open,onClose,children,footer}:DrawerProps){
  const titleId=useId()
  const drawerRef=useRef<HTMLElement>(null)
  const previousFocus=useRef<HTMLElement|null>(null)
  // Keeping the latest onClose in a ref -- rather than as an effect dependency -- matters because
  // callers pass a fresh inline arrow every render. A controlled input inside the drawer re-renders
  // its parent on every keystroke, which used to recreate onClose, retrigger this effect, and steal
  // focus back to the drawer shell mid-keystroke. The effect below now only reruns when `open` itself
  // changes.
  const onCloseRef=useRef(onClose)
  useEffect(()=>{onCloseRef.current=onClose})
  useEffect(()=>{
    if(!open)return
    previousFocus.current=document.activeElement as HTMLElement
    const previousOverflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    const handleKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onCloseRef.current()}
    document.addEventListener('keydown',handleKey)
    requestAnimationFrame(()=>drawerRef.current?.focus())
    return()=>{document.removeEventListener('keydown',handleKey);document.body.style.overflow=previousOverflow;previousFocus.current?.focus()}
  },[open])
  if(!open)return null
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}}><aside ref={drawerRef} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}><header><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2>{description&&<p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close drawer"><X size={19}/></button></header><div className="drawer-content">{children}</div>{footer&&<footer>{footer}</footer>}</aside></div>
}
