import { useId, useRef } from 'react'
import type { ReactNode } from 'react'

/* Tabs with the semantics the hand-rolled versions were missing.
 *
 * The app had three treatments: `.record-tabs` inside Page's tabs slot (JobWorkspacePage),
 * `.record-tabs` outside Page entirely (CandidateDetailPage), and bare buttons inheriting `.page-tabs`
 * (styleguide). Only one set role="tab"/aria-selected, none set role="tabpanel",
 * aria-controls, or arrow-key navigation -- so to assistive tech they were an unexplained row of
 * buttons, and to a keyboard user every tab was a separate Tab stop.
 *
 * This keeps the `.record-tabs` visual (accent underline) and adds the contract: one Tab stop for the
 * whole strip, arrows to move between tabs, Home/End to jump to the ends, and a panel wired to its tab
 * by id. Selection is caller-owned so it can live in the URL, which every current caller does. */

export interface TabItem<T extends string> {id:T;label:ReactNode;
  /* Rendered after the label -- a count, a tone dot. Kept out of `label` so the accessible name
   * stays the words alone. */
  badge?:ReactNode}

export function Tabs<T extends string>({items,value,onChange,label,id,className=''}:{
  items:readonly TabItem<T>[]
  value:T
  onChange:(id:T)=>void
  /* Names the tablist for screen readers ("Candidate sections"). Two tablists on one page are
   * otherwise indistinguishable. */
  label:string
  /* Pass the value from useTabsId() when the panels render elsewhere on the page, so tab and panel
   * agree on the ids that join them. Omit it when there are no TabPanels to wire up (a strip used
   * purely as navigation, which is how Page's tabs slot uses it). */
  id?:string
  className?:string
}){
  const fallbackId=useTabsId()
  const baseId=id??fallbackId
  const strip=useRef<HTMLDivElement>(null)
  const move=(delta:number)=>{
    const index=items.findIndex((item)=>item.id===value)
    if(index<0)return
    // Wraps deliberately: a roving-focus strip that dead-ends at its edges makes the user reverse
    // direction to reach the tab one step the other way.
    const next=items[(index+delta+items.length)%items.length]
    if(!next)return
    onChange(next.id)
    // Focus follows selection (the automatic-activation pattern), so the arrow key both selects and
    // moves the visible focus ring rather than leaving them out of sync.
    requestAnimationFrame(()=>strip.current?.querySelector<HTMLButtonElement>(`#${cssId(baseId,next.id)}`)?.focus())
  }
  return <div ref={strip} className={['record-tabs',className].filter(Boolean).join(' ')} role="tablist" aria-label={label} onKeyDown={(event)=>{
    if(event.key==='ArrowRight'||event.key==='ArrowDown'){event.preventDefault();move(1)}
    else if(event.key==='ArrowLeft'||event.key==='ArrowUp'){event.preventDefault();move(-1)}
    else if(event.key==='Home'){const first=items[0];if(first){event.preventDefault();onChange(first.id)}}
    else if(event.key==='End'){const last=items[items.length-1];if(last){event.preventDefault();onChange(last.id)}}
  }}>
    {items.map((item)=><button key={item.id} id={cssId(baseId,item.id)} role="tab" type="button"
      aria-selected={item.id===value} aria-controls={panelId(baseId,item.id)}
      /* Only the selected tab is tabbable, so Tab enters and leaves the strip once instead of
       * stopping on every tab in it. */
      tabIndex={item.id===value?0:-1}
      className={item.id===value?'active':''} onClick={()=>onChange(item.id)}>{item.label}{item.badge}</button>)}
  </div>
}

/* The panel half of the contract. Rendered wherever the content lives -- which for every current
 * caller is a different part of the page from the strip -- so the two are joined by the shared
 * `tabsId` rather than by nesting. */
export function TabPanel<T extends string>({tabsId,id,children,className=''}:{tabsId:string;id:T;children:ReactNode;className?:string}){
  return <div id={panelId(tabsId,id)} role="tabpanel" aria-labelledby={cssId(tabsId,id)} tabIndex={0} className={className}>{children}</div>
}

/* useTabsId strips the colons useId() emits: they are legal in an id attribute but not in a
 * querySelector selector unless escaped, and the arrow-key handler above looks tabs up by selector. */
const cssId=(base:string,id:string)=>`tab-${base}-${id}`
const panelId=(base:string,id:string)=>`tabpanel-${base}-${id}`

/* Exported so a caller rendering TabPanel far from its Tabs can share one id between them. */
export function useTabsId(){return useId().replace(/:/g,'')}
