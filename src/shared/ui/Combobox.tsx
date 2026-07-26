import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/* Autocomplete over a known list, for the places the app currently asks a consultant to type a value
 * blind and match it exactly.
 *
 * The candidate filters are the motivating case: tag, skill, location and source are free-text `ilike`
 * inputs against normalized tables, so searching "reactjs" finds nothing when the tag is "React", and
 * nothing tells you which is which. Same shape is needed for picking a client contact, a job, or a
 * candidate.
 *
 * Keyboard model is copied deliberately from CommandPalette, which is the best-instrumented widget in
 * the app: one flat option list in render order so arrows traverse exactly what the eye sees,
 * aria-activedescendant rather than moving real focus (focus must stay in the input so typing
 * continues to work), and an index that clamps when an async list shrinks under it.
 *
 * `allowFreeText` decides what pressing Enter on an unmatched value means. A filter should accept it
 * (the user may know a value the suggestion list has not loaded); a picker that must resolve to a real
 * row should not. */
export function Combobox({value,onChange,options,label,placeholder,allowFreeText=true,loading=false,emptyMessage='No matches',id,className=''}:{
  value:string
  onChange:(value:string)=>void
  /* Already-filtered suggestions. Filtering lives with the caller because half the uses filter
   * server-side (a debounced query) and half filter a list already in memory. */
  options:readonly {id:string;label:string;detail?:string}[]
  label:string
  placeholder?:string
  allowFreeText?:boolean
  loading?:boolean
  emptyMessage?:string
  id?:string
  className?:string
}){
  const generated=useId().replace(/:/g,'')
  const baseId=id??generated
  const [open,setOpen]=useState(false)
  const [activeIndex,setActiveIndex]=useState(-1)
  const wrap=useRef<HTMLDivElement>(null)
  const listRef=useRef<HTMLUListElement>(null)

  // Clamp when an async list shrinks beneath the highlight, otherwise Enter commits an option that is
  // no longer rendered.
  useEffect(()=>{setActiveIndex((current)=>current>=options.length?options.length-1:current)},[options.length])
  useEffect(()=>{if(activeIndex>=0)listRef.current?.querySelector<HTMLElement>(`#${baseId}-option-${activeIndex}`)?.scrollIntoView({block:'nearest'})},[activeIndex,baseId])
  useEffect(()=>{
    if(!open)return
    const onPointer=(event:MouseEvent)=>{if(!wrap.current?.contains(event.target as Node))setOpen(false)}
    document.addEventListener('mousedown',onPointer)
    return()=>document.removeEventListener('mousedown',onPointer)
  },[open])

  const commit=(index:number)=>{const option=options[index];if(!option)return;onChange(option.label);setOpen(false);setActiveIndex(-1)}

  return <div ref={wrap} className={['combobox',className].filter(Boolean).join(' ')}>
    <span className="select-wrap">
      <input className="input" role="combobox" aria-expanded={open} aria-controls={`${baseId}-list`} aria-autocomplete="list"
        aria-activedescendant={open&&activeIndex>=0?`${baseId}-option-${activeIndex}`:undefined}
        aria-label={label} placeholder={placeholder} value={value} autoComplete="off"
        onChange={(event)=>{onChange(event.target.value);setOpen(true);setActiveIndex(-1)}}
        onFocus={()=>setOpen(true)}
        onKeyDown={(event)=>{
          if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);setActiveIndex((current)=>options.length===0?-1:(current+1)%options.length)}
          else if(event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActiveIndex((current)=>options.length===0?-1:(current-1+options.length)%options.length)}
          else if(event.key==='Enter'){
            if(activeIndex>=0){event.preventDefault();commit(activeIndex)}
            else if(!allowFreeText){event.preventDefault()}
            else setOpen(false)
          }
          else if(event.key==='Escape'){if(open){event.preventDefault();setOpen(false);setActiveIndex(-1)}}
          else if(event.key==='Tab')setOpen(false)
        }}/>
      <ChevronDown className="select-chevron" size={14} aria-hidden="true"/>
    </span>
    {open&&<ul ref={listRef} id={`${baseId}-list`} role="listbox" aria-label={label} className="combobox-list">
      {loading&&<li className="combobox-empty" role="presentation">Searching…</li>}
      {!loading&&options.length===0&&<li className="combobox-empty" role="presentation">{emptyMessage}</li>}
      {options.map((option,index)=><li key={option.id} id={`${baseId}-option-${index}`} role="option" aria-selected={index===activeIndex}
        className={index===activeIndex?'combobox-option active':'combobox-option'}
        /* mousedown, not click: the input's blur would close the list before a click landed. */
        onMouseDown={(event)=>{event.preventDefault();commit(index)}}
        onMouseMove={()=>setActiveIndex(index)}>
        <span>{option.label}</span>{option.detail&&<small>{option.detail}</small>}
      </li>)}
    </ul>}
  </div>
}
