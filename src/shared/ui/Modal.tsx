import { useId } from 'react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useDialogShell } from './useDialogShell'
import { DiscardPrompt } from './DiscardPrompt'

/* Focus, Escape, scroll lock, focus restore, the Tab trap, and the dirty-close guard all live in
 * useDialogShell so this component and Drawer cannot drift apart on any of them. */
export function Modal({ title, open, onClose, children, wide=false, eyebrow='Agency workspace', dirty=false, discardMessage }: {title:string;open:boolean;onClose:()=>void;children:ReactNode;wide?:boolean;
  /* Defaults to the product's own name for the majority of dialogs, but overridable: a dialog that
   * belongs to one record ("Candidate action", "Client review") reads as mislabelled under a generic
   * workspace eyebrow. */
  eyebrow?:string;dirty?:boolean;discardMessage?:string}) {
  const titleId=useId()
  const {ref:dialogRef,requestClose,confirmingDiscard,confirmDiscard,cancelDiscard,discardMessage:discardCopy}=useDialogShell<HTMLDivElement>({open,onClose,dirty,discardMessage})
  if(!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)requestClose()}}><div ref={dialogRef} tabIndex={-1} className={`modal${wide?' modal-wide':''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><header><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2></div><button className="icon-button" onClick={requestClose} aria-label="Close dialog"><X size={18}/></button></header><div className="modal-content">{children}</div>{confirmingDiscard&&<DiscardPrompt message={discardCopy} onDiscard={confirmDiscard} onCancel={cancelDiscard}/>}</div></div>
}
