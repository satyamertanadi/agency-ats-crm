import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({ title, open, onClose, children }: {title:string;open:boolean;onClose:()=>void;children:ReactNode}) {
  if(!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></header><div className="modal-content">{children}</div></div></div>
}

