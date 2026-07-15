import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export interface DrawerProps {title:string;description?:string;open:boolean;onClose:()=>void;children:ReactNode;footer?:ReactNode}

export function Drawer({title,description,open,onClose,children,footer}:DrawerProps){
  const titleId=useId()
  const drawerRef=useRef<HTMLElement>(null)
  const previousFocus=useRef<HTMLElement|null>(null)
  useEffect(()=>{
    if(!open)return
    previousFocus.current=document.activeElement as HTMLElement
    const previousOverflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    const handleKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()}
    document.addEventListener('keydown',handleKey)
    requestAnimationFrame(()=>drawerRef.current?.focus())
    return()=>{document.removeEventListener('keydown',handleKey);document.body.style.overflow=previousOverflow;previousFocus.current?.focus()}
  },[open,onClose])
  if(!open)return null
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}}><aside ref={drawerRef} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}><header><div><p className="eyebrow">Quick create</p><h2 id={titleId}>{title}</h2>{description&&<p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close drawer"><X size={19}/></button></header><div className="drawer-content">{children}</div>{footer&&<footer>{footer}</footer>}</aside></div>
}
