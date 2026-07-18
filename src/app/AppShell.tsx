import { useEffect,useMemo,useRef,useState } from 'react'
import { NavLink, Outlet, useLocation,useNavigate,useParams } from 'react-router-dom'
import { BarChart3,BriefcaseBusiness,Building2,CalendarRange,CheckSquare,ChevronDown,ContactRound,FileUp,LayoutDashboard,LogOut,Menu,PanelLeftClose,Plus,Search,Send,Settings,SlidersHorizontal,UserPlus,UserRoundSearch,WalletCards,X } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { useOrganization } from './OrganizationProvider'
import { env } from '../shared/lib/env'
import { resolveAccent } from '../shared/lib/branding'
import { workspaceSubtitle } from '../shared/lib/labels'
import { Avatar } from '../shared/ui/Avatar'
import { Button } from '../shared/ui/Button'
import { CommandPalette } from './CommandPalette'
import {useWorkspaceCapabilities} from './useWorkspaceCapabilities'
import {recordWorkflowEvent} from '../shared/lib/productAnalytics'

// `?new=1` is consumed by each destination page (see useOpenOnNewParam), so quick add starts the
// action rather than dropping the user on a list to find the create button themselves.
const quickAddItems=[
  ['candidates?new=1','Candidate',UserRoundSearch],
  ['clients?new=1','Client',Building2],
  ['jobs?new=1','Job',BriefcaseBusiness],
] as const

const legacyQuickAddItems=[
  ['candidates?new=1','Candidate',UserRoundSearch],['companies?new=1','Company',Building2],['contacts?new=1','Contact',ContactRound],['jobs?new=1','Job',BriefcaseBusiness],['tasks?new=1','Task',CheckSquare],
] as const

const navItems=[['today','Today',LayoutDashboard],['jobs','Jobs',BriefcaseBusiness],['candidates','Candidates',UserRoundSearch],['clients','Clients',Building2]] as const
const legacyNavGroups=[
  {label:'Overview',items:[['dashboard','Dashboard',LayoutDashboard]]},
  {label:'Recruitment',items:[['candidates','Candidates',UserRoundSearch],['referrals','Referrals',UserPlus],['jobs','Jobs',BriefcaseBusiness],['submissions','Submissions',Send],['delivery','Interviews & offers',CalendarRange]]},
  {label:'Client CRM',items:[['companies','Companies',Building2],['contacts','Contacts',ContactRound]]},
  {label:'Operations',items:[['placements','Placements',WalletCards],['tasks','Tasks',CheckSquare]]},
  {label:'Insights',items:[['search','Search',Search],['reports','Reports',BarChart3]]},
  {label:'Administration',items:[['imports','Data imports',FileUp],['settings','Settings',Settings]]},
] as const

const destinationFor=(pathname:string)=>{const parts=pathname.split('/').filter(Boolean);const section=parts[2]||'home';return section==='admin'?`admin:${parts[3]||'home'}`:section}

export function AppShell() {
  const { signOut, user } = useAuth();const { memberships, organization, setOrganization } = useOrganization();const navigate = useNavigate();const location=useLocation();const {organizationSlug}=useParams()
  const capabilities=useWorkspaceCapabilities()
  const simplified=organization?.consultant_first_enabled!==false
  const [mobileOpen,setMobileOpen]=useState(false);const [collapsed,setCollapsed]=useState(false);const [commandOpen,setCommandOpen]=useState(false);const [userMenuOpen,setUserMenuOpen]=useState(false);const [quickAddOpen,setQuickAddOpen]=useState(false)
  const topbarMenus=useRef<HTMLDivElement>(null)
  // Both topbar popovers dismiss on Escape or a click elsewhere, which a bare toggle does not do.
  useEffect(()=>{
    if(!userMenuOpen&&!quickAddOpen)return
    const close=()=>{setUserMenuOpen(false);setQuickAddOpen(false)}
    const onPointer=(event:MouseEvent)=>{if(!topbarMenus.current?.contains(event.target as Node))close()}
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')close()}
    document.addEventListener('mousedown',onPointer);document.addEventListener('keydown',onKey)
    return()=>{document.removeEventListener('mousedown',onPointer);document.removeEventListener('keydown',onKey)}
  },[userMenuOpen,quickAddOpen])
  useEffect(()=>{if(!organizationSlug)return;const membership=memberships.find((item)=>item.organizations.slug===organizationSlug);if(membership&&membership.organizations.id!==organization?.id)setOrganization(membership.organizations)},[memberships,organization?.id,organizationSlug,setOrganization])
  useEffect(()=>{const handleKey=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setCommandOpen(true)}};document.addEventListener('keydown',handleKey);return()=>document.removeEventListener('keydown',handleKey)},[])
  useEffect(()=>{if(organization)recordWorkflowEvent({organizationId:organization.id,eventName:'navigation_changed',surface:simplified?'consultant_first':'legacy',destination:destinationFor(location.pathname)})},[location.pathname,organization,simplified])
  const changeOrganization=(id:string)=>{const membership=memberships.find((item)=>item.organizations.id===id);if(membership){setOrganization(membership.organizations);navigate(`/app/${membership.organizations.slug}/${membership.organizations.consultant_first_enabled===false?'dashboard':'today'}`)}}
  const initials=useMemo(()=>organization?.name.split(/\s+/).slice(0,2).map((part)=>part[0]).join('').toUpperCase()||'A',[organization?.name])
  const root=`/app/${organization?.slug||'workspace'}`;const logoUrl=organization?.logo_url
  const style={"--color-accent":resolveAccent(organization?.primary_color)} as React.CSSProperties
  return <div className={`app-layout ${collapsed?'sidebar-collapsed':''}`} style={style}>
    <aside className={`sidebar ${mobileOpen?'sidebar-open':''}`}>
      <div className="brand"><span className="brand-mark">{logoUrl?<img src={logoUrl} alt=""/>:initials}</span><div><strong>{organization?.name||env.productName}</strong><small>{workspaceSubtitle({simplified})}</small></div><button className="icon-button mobile-only" onClick={()=>setMobileOpen(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <label className="workspace-select"><span>Workspace</span><select value={organization?.id||''} onChange={(event)=>changeOrganization(event.target.value)}>{memberships.map((item)=><option value={item.organizations.id} key={item.id}>{item.organizations.name}</option>)}</select></label>
      <nav aria-label="Primary navigation">{simplified?<><div className="nav-section nav-section-primary">{navItems.map(([path,label,Icon])=><NavLink data-label={label} key={path} to={`${root}/${path}`} onClick={()=>setMobileOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}{capabilities.data?.canWriteCandidates&&<NavLink data-label="Referrals" to={`${root}/referrals`} onClick={()=>setMobileOpen(false)}><UserPlus size={18}/><span>Referrals</span></NavLink>}</div>{capabilities.data?.canViewAdmin&&<div className="nav-section nav-section-admin"><span className="nav-section-label">Advanced</span><NavLink data-label="Admin" to={`${root}/admin`} onClick={()=>setMobileOpen(false)}><SlidersHorizontal size={18}/><span>Admin</span></NavLink></div>}</>:legacyNavGroups.map((group)=><div className="nav-section" key={group.label}><span className="nav-section-label">{group.label}</span>{group.items.map(([path,label,Icon])=><NavLink data-label={label} key={path} to={`${root}/${path}`} onClick={()=>setMobileOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</div>)}</nav>
      <div className="sidebar-footer"><div className="user-chip"><Avatar name={user?.user_metadata.full_name||user?.email||'Agency user'} size="sm"/><div><strong>{user?.user_metadata.full_name||'Agency user'}</strong><small>{user?.email}</small></div></div><button className="sidebar-action" onClick={()=>void signOut()}><LogOut size={17}/><span>Sign out</span></button><button className="sidebar-action desktop-only" onClick={()=>setCollapsed((value)=>!value)}><PanelLeftClose size={17}/><span>{collapsed?'Expand sidebar':'Collapse sidebar'}</span></button></div>
    </aside>
    {mobileOpen&&<button className="mobile-scrim" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>} 
    <div className="workspace"><header className="topbar"><button className="icon-button mobile-only" onClick={()=>setMobileOpen(true)} aria-label="Open navigation"><Menu size={19}/></button><div className="topbar-identity"><strong>{organization?.name}</strong><span>{workspaceSubtitle({simplified,readOnly:capabilities.data?.readOnly})}</span></div><div className="topbar-actions"><button className="global-search" onClick={()=>setCommandOpen(true)}><Search size={16}/><span>{simplified?'Search candidates, jobs, or clients':'Search workspace'}</span><kbd>Ctrl K</kbd></button><div className="topbar-menus" ref={topbarMenus}>{!capabilities.data?.readOnly&&<div className="quick-add"><Button size="sm" variant="bronze" leadingIcon={<Plus size={13}/>} aria-expanded={quickAddOpen} aria-haspopup="menu" onClick={()=>{setQuickAddOpen((value)=>!value);setUserMenuOpen(false)}}>{simplified?'Add':'Quick add'}</Button>{quickAddOpen&&<div className="quick-add-popover" role="menu" aria-label="Create">{(simplified?quickAddItems:legacyQuickAddItems).filter(([path])=>path.startsWith('candidates')?capabilities.data?.canWriteCandidates:path.startsWith('clients')||path.startsWith('companies')||path.startsWith('contacts')?capabilities.data?.canWriteClients:path.startsWith('jobs')?capabilities.data?.canWriteJobs:true).map(([path,label,Icon])=><button key={path} role="menuitem" onClick={()=>{setQuickAddOpen(false);navigate(`${root}/${path}`)}}><Icon size={15}/>{label}</button>)}</div>}</div>}<div className="user-menu"><button className="topbar-avatar" onClick={()=>{setUserMenuOpen((value)=>!value);setQuickAddOpen(false)}} aria-expanded={userMenuOpen} aria-label="Open user menu"><Avatar name={user?.user_metadata.full_name||user?.email||'Agency user'} size="sm"/><ChevronDown size={14}/></button>{userMenuOpen&&<div className="user-menu-popover"><strong>{user?.user_metadata.full_name||'Agency user'}</strong><span>{user?.email}</span><NavLink to={`${root}/${simplified?'admin/personal':'settings'}`} onClick={()=>setUserMenuOpen(false)}><Settings size={15}/>{simplified?'My settings':'Settings'}</NavLink>{simplified&&capabilities.data?.canViewAdmin&&<NavLink to={`${root}/admin`} onClick={()=>setUserMenuOpen(false)}><SlidersHorizontal size={15}/>Admin</NavLink>}<button onClick={()=>void signOut()}><LogOut size={15}/>Sign out</button></div>}</div></div></div></header><Outlet/></div>
    {organization&&<CommandPalette open={commandOpen} onClose={()=>setCommandOpen(false)} organizationId={organization.id} organizationSlug={organization.slug}/>}
  </div>
}
