import {useEffect,useRef,useState,type RefObject} from 'react'

/* Measure an element, and put the DERIVED TIER in state -- never the raw width.
 *
 * The distinction is the whole point. A hook that stored the measurement would re-render its subtree
 * on every pixel of a window drag; dragging an edge across 400px would re-render a 50-row table 400
 * times to change its column set maybe twice. Resolving first and comparing means state updates only
 * at the handful of widths where the answer actually differs.
 *
 * `resolve` is also the second input, not just a formatter. When the caller's own state changes the
 * budget -- selection mode taking 44px, say -- it passes a new `resolve` and the tier is recomputed
 * against the LAST OBSERVED WIDTH. Waiting for ResizeObserver there would wait forever, because the
 * container did not change size; only the meaning of that size did.
 *
 * A null width means "not measured yet, or no ResizeObserver". Callers are expected to resolve that
 * to their most conservative answer, because it is what renders for the first frame.
 */
export function useContainerTier<T>(ref:RefObject<Element|null>,resolve:(width:number|null)=>T):T{
  const [tier,setTier]=useState<T>(()=>resolve(null))
  const lastWidth=useRef<number|null>(null)

  useEffect(()=>{
    const apply=(width:number|null)=>{
      lastWidth.current=width
      const next=resolve(width)
      // The comparison IS the optimisation -- without it every observer callback re-renders.
      setTier((current)=>Object.is(current,next)?current:next)
    }

    /* Re-resolve from what we already measured. On mount that is null (the conservative answer, until
     * the observer reports); on a `resolve` change it is the real width, which is what makes a
     * selection-mode toggle take effect without the container resizing. */
    apply(lastWidth.current)

    const element=ref.current
    // Guarded rather than assumed: jsdom and older browsers have no ResizeObserver, and the caller's
    // null branch is a defined answer, so absence degrades instead of throwing.
    if(!element||typeof ResizeObserver==='undefined')return

    const observer=new ResizeObserver((entries)=>{
      const entry=entries[0]
      if(entry)apply(Math.round(entry.contentRect.width))
    })
    observer.observe(element)
    return()=>observer.disconnect()
  },[ref,resolve])

  return tier
}
