import {useCallback,useEffect,useMemo,useRef,type KeyboardEvent as ReactKeyboardEvent} from 'react'
import {isFormField,isTypingTarget} from './useShortcut'

export interface ListNavigationOptions {
  /** The ordered ids the user moves through, in the order they are rendered. */
  ids:readonly string[]
  /** Which id is currently active, or null when nothing is. */
  activeId:string|null
  /** Called with the id the user moved to. The caller owns where that lives (URL, state). */
  onChange:(id:string)=>void
  /** Enter. Omit when the active item is already open, as it is inside a drawer. */
  onOpen?:(id:string)=>void
  enabled?:boolean
  /** Off by default: clamping at the ends is what makes a "3 of 8" counter honest, and Gmail,
   * Linear and every review queue behave the same way -- wrapping past the last item reads as a
   * bug, not a convenience. */
  wrap?:boolean
  /** Bind on `document` (a list page owns the whole screen) versus returning `onKeyDown` for the
   * caller to attach (a dialog, which must not claim keys for the page behind it). */
  global?:boolean
}

/* One keyboard model for every ordered list of candidates -- the pipeline drawer and the talent
 * database both move through an ordered set, and two implementations of j/k would drift.
 *
 * The guard differs by binding, and that difference is the point. A document-level listener uses the
 * full `isTypingTarget`, which refuses to fire inside `[role="dialog"]` -- a page shortcut must never
 * act on a surface hidden behind a modal. A dialog wiring its own `onKeyDown` has already scoped
 * itself by construction (the event can only arrive from inside that dialog), so it needs only the
 * form-field guard: without that distinction the drawer could never have keys at all, since its own
 * events would be rejected for being in a dialog.
 */
export function useListNavigation({ids,activeId,onChange,onOpen,enabled=true,wrap=false,global=false}:ListNavigationOptions){
  const index=useMemo(()=>(activeId?ids.indexOf(activeId):-1),[ids,activeId])
  const count=ids.length
  const hasPrevious=wrap?count>1:index>0
  const hasNext=wrap?count>1:index>=0&&index<count-1

  /* The id this hook last asked for, which is not always the one it has been given back yet.
   *
   * `activeId` is owned by the caller (the board keeps it in the URL), so it only catches up on the
   * next render. Holding `j` down fires key-repeat faster than that round trip, and every one of
   * those handlers would otherwise read the same stale index and resolve to the same neighbour --
   * eight keypresses advancing one place. Measured: seven synchronous presses moved exactly one.
   * Reading the pending id first makes each press continue from the last, so held keys advance
   * smoothly and a settled state still wins (the ref is cleared as soon as props agree). */
  const pending=useRef<string|null>(null)
  /* Cleared in an effect rather than during render: a render-phase ref write is not safe under
   * concurrent rendering, where a render can be started and thrown away. Any change to activeId ends
   * the burst -- either it caught up to what we asked for, or something else (a card click) chose a
   * different candidate and that choice must win. A burst itself fires no renders between presses,
   * so this never clears mid-burst. */
  useEffect(()=>{pending.current=null},[activeId])

  const move=useCallback((delta:number)=>{
    if(!count)return
    const from=pending.current?ids.indexOf(pending.current):index
    // Nothing active yet: the first keypress lands on an end rather than doing nothing, so the
    // keyboard is usable before the mouse has been touched.
    if(from<0){const first=(delta>0?ids[0]:ids[count-1]) as string;pending.current=first;onChange(first);return}
    const raw=from+delta
    const next=wrap?(raw+count)%count:Math.min(Math.max(raw,0),count-1)
    if(next===from)return
    const nextId=ids[next] as string
    pending.current=nextId
    onChange(nextId)
  },[count,index,ids,onChange,wrap])

  const previous=useCallback(()=>move(-1),[move])
  const next=useCallback(()=>move(1),[move])

  const handle=useCallback((event:{key:string;metaKey:boolean;ctrlKey:boolean;altKey:boolean;target:EventTarget|null;preventDefault:()=>void},blocked:(target:EventTarget|null)=>boolean)=>{
    if(!enabled)return
    // Ctrl/Cmd/Alt chords belong to the browser and the OS; claiming one is how an app breaks Find.
    if(event.metaKey||event.ctrlKey||event.altKey)return
    if(blocked(event.target))return
    if(event.key==='j'||event.key==='ArrowDown'){event.preventDefault();next();return}
    if(event.key==='k'||event.key==='ArrowUp'){event.preventDefault();previous();return}
    if(event.key==='Enter'&&onOpen&&activeId){event.preventDefault();onOpen(activeId)}
  },[enabled,next,previous,onOpen,activeId])

  useEffect(()=>{
    if(!global||!enabled)return
    const onKey=(event:globalThis.KeyboardEvent)=>handle(event,isTypingTarget)
    document.addEventListener('keydown',onKey)
    return()=>document.removeEventListener('keydown',onKey)
  },[global,enabled,handle])

  const onKeyDown=useCallback((event:ReactKeyboardEvent)=>handle(event,isFormField),[handle])

  return {index,count,hasPrevious,hasNext,previous,next,onKeyDown}
}
