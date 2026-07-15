import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({ title, open, onClose, children, wide=false }: {title:string;open:boolean;onClose:()=>void;children:ReactNode;wide?:boolean}) {
  const titleId=useId();const dialogRef=useRef<HTMLDivElement>(null);const previousFocus=useRef<HTMLElement|null>(null)
  useEffect(()=>{if(!open)return;previousFocus.current=document.activeElement as HTMLElement;const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';const handleKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};document.addEventListener('keydown',handleKey);requestAnimationFrame(()=>dialogRef.current?.focus());return()=>{document.removeEventListener('keydown',handleKey);document.body.style.overflow=previousOverflow;previousFocus.current?.focus()}},[open,onClose])
  if(!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}}><div ref={dialogRef} tabIndex={-1} className={`modal${wide?' modal-wide':''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><header><div><p className="eyebrow">Agency workspace</p><h2 id={titleId}>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18}/></button></header><div className="modal-content">{children}</div></div></div>
}
