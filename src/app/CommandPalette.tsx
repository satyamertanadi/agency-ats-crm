import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BriefcaseBusiness, Building2, ContactRound, FileSearch, LayoutDashboard, Search, Settings, UserRoundSearch, X } from 'lucide-react'
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

export function CommandPalette({open,onClose,organizationId,organizationSlug}:CommandPaletteProps){
  const [query,setQuery]=useState('');const inputRef=useRef<HTMLInputElement>(null);const navigate=useNavigate()
  useEffect(()=>{if(!open)return;setQuery('');requestAnimationFrame(()=>inputRef.current?.focus());const handleKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};document.addEventListener('keydown',handleKey);return()=>document.removeEventListener('keydown',handleKey)},[open,onClose])
  const results=useQuery({queryKey:['command-search',organizationId,query],enabled:open&&query.trim().length>=2,queryFn:()=>searchWorkspace(organizationId,query.trim())})
  const routes=useMemo(()=>{const needle=query.trim().toLowerCase();return needle?routeItems.filter((item)=>`${item.label} ${item.hint}`.toLowerCase().includes(needle)):routeItems.slice(0,5)},[query])
  if(!open)return null
  const go=(path:string)=>{navigate(`/app/${organizationSlug}/${path}`);onClose()}
  const resultPath=(type:string,id:string)=>`${type==='candidate'?'candidates':type==='company'?'companies':type==='contact'?'contacts':'jobs'}/${id}`
  return <div className="command-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Search workspace and commands"><header><Search size={19}/><Input ref={inputRef} value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search candidates, clients, jobs, or actions…" aria-label="Search workspace"/><kbd>Esc</kbd><button className="icon-button" onClick={onClose} aria-label="Close command palette"><X size={18}/></button></header><div className="command-results"><p className="command-section-label">{query.trim().length>=2?'Workspace results':'Quick navigation'}</p>{query.trim().length>=2&&results.isLoading&&<p className="command-status">Searching secure workspace…</p>}{results.data?.map((result)=><button key={`${result.entity_type}-${result.entity_id}`} onClick={()=>go(resultPath(result.entity_type,result.entity_id))}><span className="command-icon"><Search size={16}/></span><span><strong>{result.title}</strong><small>{result.subtitle||result.entity_type}</small></span><em>{result.entity_type}</em></button>)}{routes.map(({path,label,hint,icon:Icon})=><button key={path} onClick={()=>go(path)}><span className="command-icon"><Icon size={16}/></span><span><strong>{label}</strong><small>{hint}</small></span></button>)}{query.trim().length>=2&&!results.isLoading&&!results.data?.length&&!routes.length&&<p className="command-status">No matching records or actions.</p>}</div><footer><span><kbd>Tab</kbd> Browse</span><span><kbd>Enter</kbd> Open</span><span>Results respect your agency permissions</span></footer></section></div>
}
