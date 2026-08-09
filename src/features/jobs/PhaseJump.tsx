import {useEffect,useState,type RefObject} from 'react'

export interface PhaseJumpColumn {key:string;label:string;count:number}

/* Direct navigation between board phases.
 *
 * The board is a horizontal scroller, which on a 375px screen means seven phases reachable only by
 * swiping through every one in between -- so checking Offer from Sourcing is six swipes, and there
 * is no way to see that Offer has anyone in it without arriving there.
 *
 * This scrolls rather than filters. Filtering to one phase would break drag-and-drop between
 * phases and quietly change what "the board" means between viewports; scrolling keeps one board
 * with a shortcut into it, so swipe still works exactly as before and the control is additive.
 */
export function PhaseJump({containerRef,columns}:{containerRef:RefObject<HTMLDivElement|null>;columns:PhaseJumpColumn[]}){
  const [active,setActive]=useState(columns[0]?.key??'')

  useEffect(()=>{
    const container=containerRef.current
    if(!container||typeof IntersectionObserver==='undefined')return
    // Tracks which column the user has actually swiped to, so the pill bar reflects the board rather
    // than only the last button pressed. Rooted on the scroller itself, not the viewport, because
    // the board scrolls inside the page.
    const observer=new IntersectionObserver((entries)=>{
      const visible=entries.filter((entry)=>entry.isIntersecting)
        .sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0]
      const key=visible?.target.getAttribute('data-phase-key')
      if(key)setActive(key)
    },{root:container,threshold:[0.5,0.75]})
    for(const node of container.querySelectorAll('[data-phase-key]'))observer.observe(node)
    return()=>observer.disconnect()
    // Re-observes when the column set changes after pipeline data refreshes; an observer still
    // holding removed nodes would freeze the indicator.
  },[containerRef,columns])

  const jump=(key:string)=>{
    const target=containerRef.current?.querySelector(`[data-phase-key="${CSS.escape(key)}"]`)
    if(!target)return
    // Honours the same reduced-motion preference the stylesheet does; the CSS rule cannot reach a
    // programmatic smooth scroll, so it is checked here instead.
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({behavior:reduced?'auto':'smooth',inline:'start',block:'nearest'})
    setActive(key)
  }

  return <div className="phase-jump" role="tablist" aria-label="Jump to pipeline phase">
    {columns.map((column)=>
      <button key={column.key} type="button" role="tab" aria-selected={active===column.key}
        className={active===column.key?'active':''} onClick={()=>jump(column.key)}>
        {column.label}
        {/* The count is the reason this is more than a scroll shortcut: it shows where the work is
          * without navigating there. Empty phases stay visible but read as empty. */}
        <span className={column.count?'':'phase-jump-empty'}>{column.count}</span>
      </button>)}
  </div>
}
