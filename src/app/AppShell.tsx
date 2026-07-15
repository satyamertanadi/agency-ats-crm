import { useEffect,useMemo,useState } from 'react'
import { NavLink, Outlet, useNavigate,useParams } from 'react-router-dom'
import { BarChart3, BriefcaseBusiness, Building2, CalendarRange, CheckSquare, ChevronDown, ContactRound, FileUp, LayoutDashboard, LogOut, Menu, PanelLeftClose, Plus, Search, Send, Settings, UserRoundSearch, WalletCards, X } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { useOrganization } from './OrganizationProvider'
import { env } from '../shared/lib/env'
import { Avatar } from '../shared/ui/Avatar'
import { Button } from '../shared/ui/Button'
import { CommandPalette } from './CommandPalette'

const navGroups=[
  {label:'Overview',items:[['dashboard','Dashboard',LayoutDashboard]]},
  {label:'Recruitment',items:[['candidates','Candidates',UserRoundSearch],['jobs','Jobs',BriefcaseBusiness],['submissions','Submissions',Send],['delivery','Interviews & offers',CalendarRange]]},
  {label:'Client CRM',items:[['companies','Companies',Building2],['contacts','Contacts',ContactRound]]},
  {label:'Operations',items:[['placements','Placements',WalletCards],['tasks','Tasks',CheckSquare]]},
  {label:'Insights',items:[['search','Search',Search],['reports','Reports',BarChart3]]},
  {label:'Administration',items:[['imports','Data imports',FileUp],['settings','Settings',Settings]]},
] as const

const validAccent=(value:string|undefined)=>value&&/^#[0-9a-f]{6}$/i.test(value)?value:'#196f52'

export function AppShell() {
  const { signOut, user } = useAuth();const { memberships, organization, setOrganization } = useOrganization();const navigate = useNavigate();const {organizationSlug}=useParams()
  const [mobileOpen,setMobileOpen]=useState(false);const [collapsed,setCollapsed]=useState(false);const [commandOpen,setCommandOpen]=useState(false);const [userMenuOpen,setUserMenuOpen]=useState(false)
  useEffect(()=>{if(!organizationSlug)return;const membership=memberships.find((item)=>item.organizations.slug===organizationSlug);if(membership&&membership.organizations.id!==organization?.id)setOrganization(membership.organizations)},[memberships,organization?.id,organizationSlug,setOrganization])
  useEffect(()=>{const handleKey=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setCommandOpen(true)}};document.addEventListener('keydown',handleKey);return()=>document.removeEventListener('keydown',handleKey)},[])
  const changeOrganization=(id:string)=>{const membership=memberships.find((item)=>item.organizations.id===id);if(membership){setOrganization(membership.organizations);navigate(`/app/${membership.organizations.slug}/dashboard`)}}
  const initials=useMemo(()=>organization?.name.split(/\s+/).slice(0,2).map((part)=>part[0]).join('').toUpperCase()||'A',[organization?.name])
  const root=`/app/${organization?.slug||'workspace'}`;const logoUrl=organization?.logo_url
  const style={"--color-accent":validAccent(organization?.primary_color)} as React.CSSProperties
  return <div className={`app-layout ${collapsed?'sidebar-collapsed':''}`} style={style}>
    <aside className={`sidebar ${mobileOpen?'sidebar-open':''}`}>
      <div className="brand"><span className="brand-mark">{logoUrl?<img src={logoUrl} alt=""/>:initials}</span><div><strong>{organization?.name||env.productName}</strong><small>{env.productName} · Executive workspace</small></div><button className="icon-button mobile-only" onClick={()=>setMobileOpen(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <label className="workspace-select"><span>Workspace</span><select value={organization?.id||''} onChange={(event)=>changeOrganization(event.target.value)}>{memberships.map((item)=><option value={item.organizations.id} key={item.id}>{item.organizations.name}</option>)}</select></label>
      <nav aria-label="Primary navigation">{navGroups.map((group)=><div className="nav-section" key={group.label}><span className="nav-section-label">{group.label}</span>{group.items.map(([path,label,Icon])=><NavLink data-label={label} key={path} to={`${root}/${path}`} onClick={()=>setMobileOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</div>)}</nav>
      <div className="sidebar-footer"><div className="user-chip"><Avatar name={user?.user_metadata.full_name||user?.email||'Agency user'} size="sm"/><div><strong>{user?.user_metadata.full_name||'Agency user'}</strong><small>{user?.email}</small></div></div><button className="sidebar-action" onClick={()=>void signOut()}><LogOut size={17}/><span>Sign out</span></button><button className="sidebar-action desktop-only" onClick={()=>setCollapsed((value)=>!value)}><PanelLeftClose size={17}/><span>{collapsed?'Expand sidebar':'Collapse sidebar'}</span></button></div>
    </aside>
    {mobileOpen&&<button className="mobile-scrim" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>} 
    <div className="workspace"><header className="topbar"><button className="icon-button mobile-only" onClick={()=>setMobileOpen(true)} aria-label="Open navigation"><Menu size={19}/></button><div className="topbar-identity"><strong>{organization?.name}</strong><span>Agency operations · {organization?.timezone}</span></div><div className="topbar-actions"><button className="global-search" onClick={()=>setCommandOpen(true)}><Search size={16}/><span>Search workspace</span><kbd>Ctrl K</kbd></button><Button size="sm" variant="bronze" leadingIcon={<Plus size={15}/>} onClick={()=>navigate(`${root}/candidates`)}>Quick add</Button><div className="user-menu"><button className="topbar-avatar" onClick={()=>setUserMenuOpen((value)=>!value)} aria-expanded={userMenuOpen} aria-label="Open user menu"><Avatar name={user?.user_metadata.full_name||user?.email||'Agency user'} size="sm"/><ChevronDown size={14}/></button>{userMenuOpen&&<div className="user-menu-popover"><strong>{user?.user_metadata.full_name||'Agency user'}</strong><span>{user?.email}</span><NavLink to={`${root}/settings`} onClick={()=>setUserMenuOpen(false)}><Settings size={15}/>Settings</NavLink><button onClick={()=>void signOut()}><LogOut size={15}/>Sign out</button></div>}</div></div></header><Outlet/></div>
    {organization&&<CommandPalette open={commandOpen} onClose={()=>setCommandOpen(false)} organizationId={organization.id} organizationSlug={organization.slug}/>}
  </div>
}
