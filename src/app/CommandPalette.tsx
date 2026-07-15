import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BriefcaseBusiness, Building2, ContactRound, FileSearch, LayoutDashboard, ListTodo, Plus, Search, Settings, UserRoundSearch, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { searchWorkspace } from '../features/core/repository'
import { Input } from '../shared/ui/Field'

interface CommandPaletteProps {open:boolean;onClose:()=>void;organizationId:string;organizationSlug:string}
const routeItems=[
  {path:'dashboard',label:'Open dashboard',hint:'Agency overview',icon:LayoutDashboard},
  {path:'candidates',label:'Open candidates',hint:'Talent database',icon:UserRoundSearch},
  {path:'jobs',label:'Open jobs',hint:'Vacancies and pipeline',icon:BriefcaseBusiness},
  {path:'companies',label:'Open companies',hint:'Client accounts',icon:Building2},
  {path:'contacts',label:'Open contacts',hint:'Client relationships',icon:ContactRound},
  {path:'search',label:'Advanced search',hint:'Full workspace search',icon:FileSearch},
  {path:'settings',label:'Open settings',hint:'Team and integrations',icon:Settings},
] as const

// `?new=1` asks the destination page to open its create form on arrival, so the palette can start
// an action rather than only pointing at the page where the action lives.
const actionItems=[
  {path:'candidates?new=1',label:'Add candidate',hint:'Upload a CV or enter manually',icon:Plus},
  {path:'companies?new=1',label:'Add company',hint:'New client account',icon:Plus},
  {path:'contacts?new=1',label:'Add contact',hint:'New hiring contact',icon:Plus},
  {path:'jobs?new=1',label:'Create vacancy',hint:'Opens with a default pipeline',icon:Plus},
  {path:'tasks?new=1',label:'Create task',hint:'Assign follow-up work',icon:ListTodo},
] as const

export function CommandPalette({open,onClose,organizationId,organizationSlug}:CommandPaletteProps){
  const [query,setQuery]=useState('');const [activeIndex,setActiveIndex]=useState(0)
  const inputRef=useRef<HTMLInputElement>(null);const listRef=useRef<HTMLDivElement>(null);const navigate=useNavigate()
  useEffect(()=>{if(!open)return;setQuery('');setActiveIndex(0);requestAnimationFrame(()=>inputRef.current?.focus());const handleKey=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape')onClose()};document.addEventListener('keydown',handleKey);return()=>document.removeEventListener('keydown',handleKey)},[open,onClose])
  const results=useQuery({queryKey:['command-search',organizationId,query],enabled:open&&query.trim().length>=2,queryFn:()=>searchWorkspace(organizationId,query.trim())})
  const needle=query.trim().toLowerCase()
  const routes=useMemo(()=>needle?routeItems.filter((item)=>`${item.label} ${item.hint}`.toLowerCase().includes(needle)):routeItems.slice(0,5),[needle])
  const actions=useMemo(()=>needle?actionItems.filter((item)=>`${item.label} ${item.hint}`.toLowerCase().includes(needle)):actionItems.slice(0,3),[needle])

  const resultPath=(type:string,id:string)=>`${type==='candidate'?'candidates':type==='company'?'companies':type==='contact'?'contacts':'jobs'}/${id}`
  // One flat list in render order, so arrow keys traverse exactly what the eye sees.
  const items=useMemo(()=>[
    ...(results.data??[]).map((result)=>({key:`${result.entity_type}-${result.entity_id}`,path:resultPath(result.entity_type,result.entity_id)})),
    ...actions.map((item)=>({key:`action-${item.path}`,path:item.path})),
    ...routes.map((item)=>({key:`route-${item.path}`,path:item.path})),
  ],[results.data,actions,routes])

  // Results arrive asynchronously and filters shrink the list; without this the highlight can point
  // past the end and Enter would navigate nowhere.
  useEffect(()=>{setActiveIndex((current)=>current>=items.length?0:current)},[items.length])
  useEffect(()=>{listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'})},[activeIndex,items.length])

  if(!open)return null
  const go=(path:string)=>{navigate(`/app/${organizationSlug}/${path}`);onClose()}
  const onKeyDown=(event:KeyboardEvent<HTMLInputElement>)=>{
    if(event.key==='ArrowDown'){event.preventDefault();setActiveIndex((current)=>items.length?(current+1)%items.length:0)}
    else if(event.key==='ArrowUp'){event.preventDefault();setActiveIndex((current)=>items.length?(current-1+items.length)%items.length:0)}
    else if(event.key==='Home'){event.preventDefault();setActiveIndex(0)}
    else if(event.key==='End'){event.preventDefault();setActiveIndex(Math.max(items.length-1,0))}
    else if(event.key==='Enter'){const item=items[activeIndex];if(item){event.preventDefault();go(item.path)}}
  }
  const optionId=(index:number)=>`command-option-${index}`
  const searching=query.trim().length>=2
  // Each section's options continue the flat index, matching the order `items` was built in.
  const actionOffset=results.data?.length??0
  const routeOffset=actionOffset+actions.length

  return <div className="command-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Search workspace and commands">
      <header><Search size={19}/>
        <Input ref={inputRef} value={query} onChange={(event)=>{setQuery(event.target.value);setActiveIndex(0)}} onKeyDown={onKeyDown}
          role="combobox" aria-expanded aria-controls="command-results" aria-autocomplete="list"
          aria-activedescendant={items.length?optionId(activeIndex):undefined}
          placeholder="Search candidates, clients, jobs, or actions…" aria-label="Search workspace"/>
        <kbd>Esc</kbd><button className="icon-button" onClick={onClose} aria-label="Close command palette"><X size={18}/></button></header>
      <div className="command-results" id="command-results" role="listbox" aria-label="Results and commands" ref={listRef}>
        <p className="command-section-label">{searching?'Workspace results':'Quick navigation'}</p>
        {searching&&results.isLoading&&<p className="command-status">Searching secure workspace…</p>}
        {results.data?.map((result,offset)=><button key={`${result.entity_type}-${result.entity_id}`} id={optionId(offset)} role="option" aria-selected={offset===activeIndex}
          onMouseMove={()=>setActiveIndex(offset)} onClick={()=>go(resultPath(result.entity_type,result.entity_id))}>
          <span className="command-icon"><Search size={16}/></span><span><strong>{result.title}</strong><small>{result.subtitle||result.entity_type}</small></span><em>{result.entity_type}</em></button>)}
        {actions.length>0&&<p className="command-section-label">Actions</p>}
        {actions.map(({path,label,hint,icon:Icon},offset)=><button key={`action-${path}`} id={optionId(actionOffset+offset)} role="option" aria-selected={actionOffset+offset===activeIndex}
          onMouseMove={()=>setActiveIndex(actionOffset+offset)} onClick={()=>go(path)}>
          <span className="command-icon"><Icon size={16}/></span><span><strong>{label}</strong><small>{hint}</small></span></button>)}
        {routes.map(({path,label,hint,icon:Icon},offset)=><button key={`route-${path}`} id={optionId(routeOffset+offset)} role="option" aria-selected={routeOffset+offset===activeIndex}
          onMouseMove={()=>setActiveIndex(routeOffset+offset)} onClick={()=>go(path)}>
          <span className="command-icon"><Icon size={16}/></span><span><strong>{label}</strong><small>{hint}</small></span></button>)}
        {searching&&!results.isLoading&&!items.length&&<p className="command-status">No matching records or actions.</p>}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> Browse</span><span><kbd>Enter</kbd> Open</span><span>Results respect your agency permissions</span></footer>
    </section>
  </div>
}
