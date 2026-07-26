import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/* The overflow/action popover, with the keyboard model the three hand-rolled versions lacked.
 *
 * quick-add, the user menu, and the candidate-detail overflow all declared role="menu" and
 * role="menuitem" but implemented none of what those roles promise: no arrow keys, no typeahead, no
 * roving focus, no aria-activedescendant. A screen-reader user was told "menu" and then handed
 * something that behaved like a div of buttons; a keyboard user Tabbed through every item.
 *
 * Real focus is moved onto each item (rather than aria-activedescendant on the container) because the
 * items are ordinary buttons and links -- moving focus keeps Enter/Space working natively and keeps
 * the visible focus ring where the user's attention is.
 *
 * Opening with ArrowDown lands on the first item and ArrowUp on the last, which is what makes
 * "keyboard down into the menu" feel immediate rather than requiring a second key. */

export interface MenuItemSpec {
  id:string
  label:ReactNode
  icon?:ReactNode
  onSelect?:()=>void
  /* Renders an anchor instead of a button -- for items that navigate, so middle-click and
   * open-in-new-tab keep working. */
  href?:string
  disabled?:boolean
  /* Draws a divider above this item. Cheaper than a separate item type, and it cannot end up
   * focusable by accident the way a standalone <hr> item would. */
  separatorBefore?:boolean
  /* Red text, for the destructive item that conventionally sits at the bottom. */
  tone?:'default'|'danger'
  /* Plain-text fallback for typeahead when `label` is a node rather than a string. */
  text?:string
}

export function Menu({trigger,items,label,align='end',className=''}:{
  /* Receives the props the trigger must carry. Passing them through rather than rendering a fixed
   * button lets callers use Button, an icon-only button, or a card affordance without this component
   * knowing about any of them. */
  trigger:(props:{onClick:()=>void;onKeyDown:(event:React.KeyboardEvent)=>void;'aria-expanded':boolean;'aria-haspopup':'menu';id:string;ref:React.Ref<HTMLButtonElement>})=>ReactNode
  items:readonly MenuItemSpec[]
  label:string
  align?:'start'|'end'
  className?:string
}){
  const baseId=useId().replace(/:/g,'')
  const [open,setOpen]=useState(false)
  const [activeIndex,setActiveIndex]=useState(-1)
  const container=useRef<HTMLDivElement>(null)
  const triggerRef=useRef<HTMLButtonElement>(null)
  const itemRefs=useRef<(HTMLElement|null)[]>([])
  const enabled=items.filter((item)=>!item.disabled)

  const close=useCallback((restoreFocus=true)=>{setOpen(false);setActiveIndex(-1);if(restoreFocus)triggerRef.current?.focus()},[])

  // Focus follows activeIndex rather than being set at each call site, so every path that changes the
  // active item (arrows, typeahead, Home/End, opening) gets focus movement for free.
  useEffect(()=>{if(open&&activeIndex>=0)itemRefs.current[activeIndex]?.focus()},[open,activeIndex])

  useEffect(()=>{
    if(!open)return
    const onPointer=(event:MouseEvent)=>{if(!container.current?.contains(event.target as Node))close(false)}
    document.addEventListener('mousedown',onPointer)
    return()=>document.removeEventListener('mousedown',onPointer)
  },[open,close])

  const step=(delta:number)=>setActiveIndex((current)=>enabled.length===0?-1:(current+delta+enabled.length)%enabled.length)

  /* Typeahead over first characters, matching how native menus behave. Single-character keys only, so
   * it never competes with the navigation keys handled above. */
  const typeahead=(key:string)=>{
    const target=key.toLowerCase()
    const textOf=(item:MenuItemSpec)=>(item.text??(typeof item.label==='string'?item.label:'')).toLowerCase()
    const from=activeIndex+1
    const ordered=[...enabled.slice(from),...enabled.slice(0,from)]
    const hit=ordered.find((item)=>textOf(item).startsWith(target))
    if(hit)setActiveIndex(enabled.indexOf(hit))
  }

  const onMenuKeyDown=(event:React.KeyboardEvent)=>{
    if(event.key==='Escape'){event.preventDefault();close();return}
    if(event.key==='ArrowDown'){event.preventDefault();step(1);return}
    if(event.key==='ArrowUp'){event.preventDefault();step(-1);return}
    if(event.key==='Home'){event.preventDefault();setActiveIndex(0);return}
    if(event.key==='End'){event.preventDefault();setActiveIndex(enabled.length-1);return}
    if(event.key==='Tab'){close(false);return}
    if(event.key.length===1&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();typeahead(event.key)}
  }

  return <div ref={container} className={['ui-menu',className].filter(Boolean).join(' ')}>
    {trigger({
      id:`${baseId}-trigger`,ref:triggerRef,'aria-expanded':open,'aria-haspopup':'menu',
      // Pointer-opened menus start with nothing active, so the panel appears without a focus ring on
      // an item the user did not choose; the keyboard paths below set an active item on the way in.
      onClick:()=>{setActiveIndex(-1);setOpen((value)=>!value)},
      onKeyDown:(event)=>{
        if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);setActiveIndex(0)}
        else if(event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActiveIndex(Math.max(enabled.length-1,0))}
      },
    })}
    {open&&<div className={`ui-menu-panel${align==='start'?' ui-menu-panel-start':''}`} role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
      {items.map((item)=>{
        const index=enabled.indexOf(item)
        const shared={
          role:'menuitem' as const,tabIndex:-1,
          className:[item.separatorBefore?'ui-menu-separated':'',item.tone==='danger'?'menu-caution':''].filter(Boolean).join(' ')||undefined,
          ref:(node:HTMLElement|null)=>{if(index>=0)itemRefs.current[index]=node},
        }
        if(item.href)return <a key={item.id} {...shared} href={item.href} onClick={()=>close(false)}>{item.icon}{item.label}</a>
        return <button key={item.id} {...shared} type="button" disabled={item.disabled} aria-disabled={item.disabled||undefined}
          onClick={()=>{if(item.disabled)return;close(false);item.onSelect?.()}}>{item.icon}{item.label}</button>
      })}
    </div>}
  </div>
}
