import { useCallback, useEffect, useRef, useState } from 'react'

/* The behaviour every modal dialog in the app owes its user, in one place: initial focus, Escape to
 * close, body-scroll lock, focus restored to whatever opened it, a Tab loop that cannot escape into
 * the inert page behind, and a guard so a half-filled form is never discarded by a stray click.
 *
 * Modal.tsx and Drawer.tsx each grew their own copy of the first four. They agreed, but only because
 * someone kept them in sync by hand -- and neither had the last two. Sharing the hook is what makes
 * "Tab stays inside" and "dirty forms confirm before closing" true of both at once, and true of any
 * dialog added later without its author having to know the list.
 *
 * `onClose` is deliberately read through a ref rather than listed as an effect dependency. Callers
 * pass a fresh inline arrow every render, and a controlled input inside the dialog re-renders its
 * parent on every keystroke -- so depending on the prop directly retriggered the effect and stole
 * focus back to the dialog shell mid-keystroke. Drawer.test.tsx reproduces that exact bug. */

const FOCUSABLE='a[href],area[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),iframe,object,embed,[tabindex]:not([tabindex="-1"]),[contenteditable]'

/* Deliberately attribute-based rather than layout-based. The obvious check is `offsetParent !== null`,
 * but that reports every element as hidden under jsdom (which performs no layout), so the trap's own
 * tests could never exercise it -- an untestable guard on the accessibility behaviour of every dialog
 * in the app is worse than a slightly narrower one.
 *
 * These three cover what actually hides a control inside a dialog here: a collapsed CollapsibleSection
 * (the CV review form is built from them), and anything explicitly marked away from assistive tech. */
const isTabbable=(element:HTMLElement)=>!element.closest('[hidden]')&&!element.closest('[aria-hidden="true"]')&&!element.closest('details:not([open])')

export interface DialogShellOptions {
  open: boolean
  onClose: () => void
  /* When true, Escape and backdrop clicks ask before discarding. The dialog itself decides what
   * "dirty" means -- a form's isDirty, an unsaved draft, a started upload. */
  dirty?: boolean
  /* Shown in the discard confirmation. Dialogs whose content is expensive to rebuild (a reviewed CV,
   * a composed shortlist) should say so here rather than relying on the generic sentence. */
  discardMessage?: string
}

export function useDialogShell<T extends HTMLElement>({open,onClose,dirty=false,discardMessage='Your changes have not been saved.'}:DialogShellOptions){
  const ref=useRef<T|null>(null)
  const previousFocus=useRef<HTMLElement|null>(null)
  const [confirmingDiscard,setConfirmingDiscard]=useState(false)
  // Both props are read through refs inside the effect below so the listener never needs them as
  // dependencies -- see the header comment for why that matters to focus.
  const onCloseRef=useRef(onClose);useEffect(()=>{onCloseRef.current=onClose})
  const dirtyRef=useRef(dirty);useEffect(()=>{dirtyRef.current=dirty})

  /* Call instead of onClose from anything the user dismisses with: the ✕ button, Cancel, the
   * backdrop. `onClose` itself stays the unguarded path, for a dialog closing itself after a save. */
  const requestClose=useCallback(()=>{if(dirtyRef.current){setConfirmingDiscard(true);return}onCloseRef.current()},[])
  const confirmDiscard=useCallback(()=>{setConfirmingDiscard(false);onCloseRef.current()},[])
  const cancelDiscard=useCallback(()=>setConfirmingDiscard(false),[])

  useEffect(()=>{
    if(!open)return
    setConfirmingDiscard(false)
    previousFocus.current=document.activeElement as HTMLElement
    const previousOverflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    const handleKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){if(dirtyRef.current){setConfirmingDiscard(true);return}onCloseRef.current();return}
      if(event.key!=='Tab')return
      const container=ref.current
      if(!container)return
      /* Recomputed per keypress, not cached on open: dialogs reveal and disable controls as the user
       * works (a submit button enabling, a section expanding), and a stale list would send Tab to an
       * element that is no longer there. */
      const focusable=[...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isTabbable)
      const first=focusable[0];const last=focusable[focusable.length-1]
      if(!first||!last){event.preventDefault();container.focus();return}
      /* The container itself holds focus on open (tabIndex -1), so the first Tab has to be steered
       * into the content explicitly -- otherwise the browser walks out to the page behind. Testing
       * `activeElement === container` separately matters: Node.contains() counts a node as containing
       * itself, so the container-focused case would otherwise fall through to the edge checks below,
       * match neither, and let the browser move focus out of the dialog. */
      if(document.activeElement===container||!container.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();return}
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
    document.addEventListener('keydown',handleKey)
    requestAnimationFrame(()=>ref.current?.focus())
    return()=>{document.removeEventListener('keydown',handleKey);document.body.style.overflow=previousOverflow;previousFocus.current?.focus()}
  },[open])

  return {ref,requestClose,confirmingDiscard,confirmDiscard,cancelDiscard,discardMessage}
}
