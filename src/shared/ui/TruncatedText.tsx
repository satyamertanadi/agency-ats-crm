import {useCallback,useEffect,useRef,useState} from 'react'
import type {ElementType,ReactNode} from 'react'

/* One-line text that discloses its full value when -- and only when -- it is actually cut off.
 *
 * Three decisions worth stating, because the obvious implementations of each are wrong here:
 *
 * 1. TRUNCATION IS MEASURED, NOT ASSUMED. `scrollWidth > clientWidth` on the element itself, re-run
 *    on resize. A tooltip that appears on text which is fully visible is worse than none: it trains
 *    the reader to ignore the affordance, so the one value that IS cut off gets ignored too. The
 *    measurement is also why this cannot be pure CSS -- nothing in CSS can ask "did this ellipsis".
 *
 * 2. IT ADDS NO TAB STOPS. The tempting version puts tabIndex={0} on every truncated cell so
 *    keyboard users can reach the tooltip. On a 50-row table with a name, a role and an owner per
 *    row that is up to 150 new stops between the search box and the first action -- it would make
 *    the keyboard path dramatically worse in the name of accessibility. Instead the tooltip also
 *    shows on :focus-within (see .truncate-reveal in components.css), so tabbing to the link a name
 *    already sits inside reveals it, using the focusable element the row already had.
 *
 *    That leaves secondary text with no focusable ancestor -- a role sub-line, an owner name --
 *    reachable by pointer and by opening the record, but not by Tab alone. That is deliberate: the
 *    record itself is the accessible route to a value the row only ever shows an abbreviation of.
 *
 * 3. `title` IS KEPT AS THE FLOOR. The visual tooltip is a decoration on top of it, not a
 *    replacement: title is what a screen reader, a touch long-press, and a user with custom CSS
 *    still get. It is set only when truncated, so it never announces text already fully on screen.
 */
export interface TruncatedTextProps{
  /** The complete value. What renders, what `title` carries, and what the tooltip shows. */
  children:string
  /** Defaults to span; pass 'strong' for a record name so weight still comes from the element. */
  as?:ElementType
  className?:string
  /** Rendered instead of `children` when the value is empty -- keeps "Not recorded" out of tooltips. */
  fallback?:ReactNode
}

export function TruncatedText({children,as:Tag='span',className='',fallback}:TruncatedTextProps){
  const ref=useRef<HTMLElement|null>(null)
  const [truncated,setTruncated]=useState(false)

  const measure=useCallback(()=>{
    const node=ref.current
    if(!node)return
    /* +1 tolerance: sub-pixel layout leaves scrollWidth a fraction above clientWidth on text that is
     * not actually clipped, which would otherwise mark most cells truncated at certain zoom levels. */
    setTruncated(node.scrollWidth>node.clientWidth+1)
  },[])

  useEffect(()=>{
    measure()
    const node=ref.current
    if(!node||typeof ResizeObserver==='undefined')return
    /* Observes the element, not the window: a column can change width without the viewport doing so
     * -- the candidate table's own tier ladder does exactly that when selection mode turns on. */
    const observer=new ResizeObserver(measure)
    observer.observe(node)
    return ()=>observer.disconnect()
  },[measure,children])

  if(!children)return <>{fallback??null}</>
  return <Tag
    ref={ref}
    className={`truncate-reveal ${className}`.trim()}
    data-truncated={truncated?'true':undefined}
    data-full={truncated?children:undefined}
    title={truncated?children:undefined}
  >{children}</Tag>
}
