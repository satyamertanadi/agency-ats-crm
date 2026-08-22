import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {act,renderHook} from '@testing-library/react'
import {useContainerTier} from './useContainerTier'

/* A ResizeObserver stand-in that hands the callback back, so a test can decide exactly when -- and
 * whether -- a measurement arrives. jsdom has no ResizeObserver of its own. */
let fire:((width:number)=>void)|null=null
let disconnects=0

class FakeResizeObserver{
  constructor(private callback:ResizeObserverCallback){
    fire=(width:number)=>this.callback([{contentRect:{width}} as ResizeObserverEntry],this as never)
  }
  observe(){/* the test drives the callback directly */}
  unobserve(){/* never needed */}
  disconnect(){disconnects+=1}
}

const ref={current:document.createElement('div')}
// Anything over 100 is 'wide', to keep the test about the hook rather than about real thresholds.
const resolveFor=(offset:number)=>(width:number|null)=>width===null?'unknown':width-offset>=100?'wide':'narrow'

beforeEach(()=>{fire=null;disconnects=0;vi.stubGlobal('ResizeObserver',FakeResizeObserver)})
afterEach(()=>{vi.unstubAllGlobals()})

describe('useContainerTier',()=>{
  it('starts at the caller\'s unknown-width answer, before anything is measured',()=>{
    const {result}=renderHook(()=>useContainerTier(ref,resolveFor(0)))
    expect(result.current).toBe('unknown')
  })

  it('adopts the tier once a measurement arrives',()=>{
    const {result}=renderHook(()=>useContainerTier(ref,resolveFor(0)))
    act(()=>fire?.(150))
    expect(result.current).toBe('wide')
    act(()=>fire?.(50))
    expect(result.current).toBe('narrow')
  })

  /* The optimisation that justifies the hook existing. Ten measurements that all mean 'wide' must
   * produce one render, not ten -- otherwise a window drag re-renders every row for nothing. */
  it('does not re-render while the tier is unchanged',()=>{
    let renders=0
    renderHook(()=>{renders+=1;return useContainerTier(ref,resolveFor(0))})
    act(()=>fire?.(150))
    const afterFirst=renders
    act(()=>{for(let width=151;width<161;width+=1)fire?.(width)})
    expect(renders).toBe(afterFirst)
  })

  /* The case ResizeObserver structurally cannot catch: the container is the same size, but the space
   * available for information shrank (selection mode taking its checkbox column). Without
   * re-resolving against the last measured width, the tier would stay stale until the user happened
   * to resize the window. */
  it('re-resolves when the budget changes but the container does not',()=>{
    const {result,rerender}=renderHook(({offset}:{offset:number})=>useContainerTier(ref,resolveFor(offset)),
      {initialProps:{offset:0}})
    act(()=>fire?.(150))
    expect(result.current).toBe('wide')

    // No further measurement -- only the caller's notion of usable width changes.
    rerender({offset:60})
    expect(result.current).toBe('narrow')
  })

  it('tears the observer down on unmount',()=>{
    const {unmount}=renderHook(()=>useContainerTier(ref,resolveFor(0)))
    unmount()
    expect(disconnects).toBeGreaterThan(0)
  })

  // Older browsers and jsdom. The caller's null branch is a real answer, so absence degrades.
  it('survives an environment with no ResizeObserver',()=>{
    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver',undefined)
    const {result}=renderHook(()=>useContainerTier(ref,resolveFor(0)))
    expect(result.current).toBe('unknown')
  })
})
