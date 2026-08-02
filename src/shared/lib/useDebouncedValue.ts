import {useEffect,useState} from 'react'

/**
 * The value, held back until it has stopped changing for `delay` milliseconds.
 *
 * Used to keep a keystroke from being a network request. The input itself stays controlled by the raw
 * value -- typing must never lag behind the keyboard -- and only the query key reads the debounced one,
 * so the field feels immediate while the server sees one request per pause rather than one per letter.
 *
 * `delay` is a dependency on purpose: a caller that computes it (shorter once results exist, say) gets
 * the new timing on the next keystroke rather than the timing captured on mount.
 */
export function useDebouncedValue<T>(value:T,delay=300){
  const [debounced,setDebounced]=useState(value)
  useEffect(()=>{
    const timer=setTimeout(()=>setDebounced(value),delay)
    // Clearing on every change is what makes this a debounce rather than a throttle: a keystroke
    // inside the window replaces the pending update instead of queueing a second one.
    return()=>clearTimeout(timer)
  },[value,delay])
  return debounced
}
