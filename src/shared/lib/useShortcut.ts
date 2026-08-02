import {useEffect} from 'react'

/* True when the keystroke belongs to whatever the user is typing into.
 *
 * Single-letter shortcuts and text entry share the whole alphabet, so this is not a nicety: without
 * it, typing a candidate's name into a search box would toggle detailed stages on the "d". Modals and
 * dialogs are excluded wholesale -- a shortcut that fires behind an open dialog acts on a surface the
 * user cannot see. */
export function isTypingTarget(target:EventTarget|null){
  const element=target as HTMLElement|null
  if(!element?.tagName)return false
  if(element.isContentEditable)return true
  if(['INPUT','TEXTAREA','SELECT'].includes(element.tagName))return true
  return Boolean(element.closest?.('[role="dialog"],[contenteditable="true"]'))
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
