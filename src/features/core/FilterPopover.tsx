import {useEffect,useId,useRef,useState,type ReactNode} from 'react'
import {ChevronDown,SlidersHorizontal} from 'lucide-react'
import {Button} from '../../shared/ui/Button'

/* The secondary filters of a list page, folded into one control.
 *
 * Every list page used to render its filters as a permanently visible `<details>` disclosure titled
 * "Filters and sorting", sitting between the toolbar and the data. Collapsed it still cost a full
 * row; expanded it pushed the first record most of a screen down. Either way it was a horizontal
 * layer whose only content was the *possibility* of filtering.
 *
 * A popover instead: the trigger states how many filters are currently applied, so the collapsed
 * state carries the information the disclosure never did, and the panel overlays the table rather
 * than displacing it. Nothing about which filters exist or what they do has changed -- the same
 * fields, writing the same URL params.
 *
 * Deliberately NOT a `role="menu"`: the panel holds labelled form controls, and menu semantics would
 * promise arrow-key item navigation to a screen reader and then hand it a grid of selects. It is a
 * plain disclosure with an expanded/collapsed relationship to its trigger, which is what it is.
 */
export function FilterPopover({count,children,label='Filters',onClearAll}:{
  /** How many of these filters are currently applied. Rendered on the trigger. */
  count:number
  children:ReactNode
  label?:string
  onClearAll?:()=>void
}){
  const [open,setOpen]=useState(false)
  const panelId=useId().replace(/:/g,'')
  const container=useRef<HTMLDivElement>(null)
  const triggerRef=useRef<HTMLButtonElement>(null)

  useEffect(()=>{
    if(!open)return
    const onPointer=(event:MouseEvent)=>{if(!container.current?.contains(event.target as Node))setOpen(false)}
    /* Escape returns focus to the trigger; a pointer dismissal deliberately does not, because the
     * user's attention is already wherever they clicked. Same split as Menu. */
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);triggerRef.current?.focus()}}
    document.addEventListener('mousedown',onPointer);document.addEventListener('keydown',onKey)
    return()=>{document.removeEventListener('mousedown',onPointer);document.removeEventListener('keydown',onKey)}
  },[open])

  return <div className="filter-popover" ref={container}>
    <Button ref={triggerRef} type="button" size="sm" variant="secondary"
      className={count>0?'filter-popover-trigger-active':undefined}
      aria-expanded={open} aria-controls={open?panelId:undefined}
      leadingIcon={<SlidersHorizontal size={14}/>} trailingIcon={<ChevronDown size={14}/>}
      onClick={()=>setOpen((value)=>!value)}>
      {label}{count>0?` (${count})`:''}
    </Button>
    {open&&<div className="filter-popover-panel" id={panelId}>
      <div className="filter-grid">{children}</div>
      <div className="filter-popover-actions">
        {onClearAll&&<Button size="sm" variant="quiet" disabled={count===0} onClick={onClearAll}>Clear filters</Button>}
        <Button size="sm" variant="secondary" onClick={()=>{setOpen(false);triggerRef.current?.focus()}}>Done</Button>
      </div>
    </div>}
  </div>
}
