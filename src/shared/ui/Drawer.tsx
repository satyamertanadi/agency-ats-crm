import { useId } from 'react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useDialogShell } from './useDialogShell'
import { DiscardPrompt } from './DiscardPrompt'

export interface DrawerProps {title:string;description?:string;eyebrow?:string;open:boolean;onClose:()=>void;children:ReactNode;footer?:ReactNode;dirty?:boolean;discardMessage?:string}

/* Focus, Escape, scroll lock, focus restore, the Tab trap, and the dirty-close guard all live in
 * useDialogShell so this component and Modal cannot drift apart on any of them. */
export function Drawer({title,description,eyebrow='Quick create',open,onClose,children,footer,dirty=false,discardMessage}:DrawerProps){
  const titleId=useId()
  const {ref:drawerRef,requestClose,confirmingDiscard,confirmDiscard,cancelDiscard,discardMessage:discardCopy}=useDialogShell<HTMLElement>({open,onClose,dirty,discardMessage})
  if(!open)return null
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)requestClose()}}><aside ref={drawerRef} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}><header><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2>{description&&<p>{description}</p>}</div><button className="icon-button" onClick={requestClose} aria-label="Close drawer"><X size={19}/></button></header><div className="drawer-content">{children}</div>{footer&&<footer>{footer}</footer>}{confirmingDiscard&&<DiscardPrompt message={discardCopy} onDiscard={confirmDiscard} onCancel={cancelDiscard}/>}</aside></div>
}
