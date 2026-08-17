import {useEffect} from 'react'

/* True when the keystroke belongs to whatever the user is typing into.
 *
 * Single-letter shortcuts and text entry share the whole alphabet, so this is not a nicety: without
 * it, typing a candidate's name into a search box could trigger a single-key page shortcut. Modals and
 * dialogs are excluded wholesale -- a shortcut that fires behind an open dialog acts on a surface the
 * user cannot see. */
/* Just the "is the user typing into this element" half, with no opinion about dialogs.
 *
 * Split out because a dialog that binds its OWN key handler has already scoped itself -- the event
 * can only have come from inside it -- and must still be allowed to use single-key shortcuts. Judging
 * it by isTypingTarget would reject every key for being in a dialog, which is right for a page
 * shortcut and wrong for the dialog's own. */
export function isFormField(target:EventTarget|null){
  const element=target as HTMLElement|null
  if(!element?.tagName)return false
  if(element.isContentEditable)return true
  return ['INPUT','TEXTAREA','SELECT'].includes(element.tagName)
}

export function isTypingTarget(target:EventTarget|null){
  if(isFormField(target))return true
  const element=target as HTMLElement|null
  return Boolean(element?.closest?.('[role="dialog"],[contenteditable="true"]'))
}

/**
 * Binds a single-key shortcut for as long as the component is mounted.
 *
 * Modifier combinations are deliberately not matched: Ctrl/Cmd/Alt chords belong to the browser and
 * the OS, and quietly claiming one is how an app breaks Find or Save. Shift is allowed through
 * because `?` cannot be typed without it.
 */
export function useShortcut(key:string,handler:()=>void,enabled=true){
  useEffect(()=>{
    if(!enabled)return
    const onKey=(event:KeyboardEvent)=>{
      if(event.metaKey||event.ctrlKey||event.altKey)return
      if(event.key!==key)return
      if(isTypingTarget(event.target))return
      event.preventDefault()
      handler()
    }
    document.addEventListener('keydown',onKey)
    return()=>document.removeEventListener('keydown',onKey)
  },[key,handler,enabled])
}
