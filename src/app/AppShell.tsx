import { useEffect,useMemo,useRef,useState } from 'react'
import { NavLink, Outlet, useLocation,useNavigate,useParams } from 'react-router'
import { BarChart3,BriefcaseBusiness,Building2,CheckSquare,ChevronDown,LayoutDashboard,LogOut,Menu,MonitorSmartphone,Moon,PanelLeftClose,Plus,Search,Settings,SlidersHorizontal,Sun,UserPlus,UserRoundSearch,X } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { useOrganization } from './OrganizationProvider'
import { env } from '../shared/lib/env'
import { DEFAULT_ACCENT, isHexColor } from '../shared/lib/branding'
import { workspaceSubtitle } from '../shared/lib/labels'
import { Avatar } from '../shared/ui/Avatar'
import { Button } from '../shared/ui/Button'
import { CommandPalette } from './CommandPalette'
import {useWorkspaceCapabilities} from './useWorkspaceCapabilities'
import {useRealtimeSync,type RealtimeStatus} from '../features/core/useRealtimeSync'
import {applyTheme,readPreference,writePreference,type ThemePreference} from '../shared/lib/theme'
import {recordWorkflowEvent} from '../shared/lib/productAnalytics'
import {QuickTaskModal} from '../features/activities/QuickTaskModal'
import {useShortcut} from '../shared/lib/useShortcut'
import {Modal} from '../shared/ui/Modal'

// `?new=1` is consumed by each destination page (see useOpenOnNewParam), so quick add starts the
// action rather than dropping the user on a list to find the create button themselves.
const quickAddItems=[
  ['candidates?new=1','Candidate',UserRoundSearch],
  ['candidates?addToJob=1','Candidate to job',BriefcaseBusiness],
  ['clients?new=1','Client',Building2],
  ['jobs?new=1','Job',BriefcaseBusiness],
  ['today?task=1','Task',CheckSquare],
] as const

const navItems=[['today','Today',LayoutDashboard],['jobs','Jobs',BriefcaseBusiness],['candidates','Candidates',UserRoundSearch],['clients','Clients',Building2],['scorecard','My scorecard',BarChart3]] as const

const destinationFor=(pathname:string)=>{const parts=pathname.split('/').filter(Boolean);const section=parts[2]||'home';return section==='admin'?`admin:${parts[3]||'home'}`:section}

export function AppShell() {
  const { signOut, user } = useAuth();const { memberships, organization, setOrganization } = useOrganization();const navigate = useNavigate();const location=useLocation();const {organizationSlug}=useParams()
  const capabilities=useWorkspaceCapabilities()
  // Mounted once for the whole workspace rather than per page: a subscription per screen would open
  // and tear down a socket on every navigation, and the queries it refreshes are shared anyway.
  const realtime=useRealtimeSync(organization?.id)
  const [theme,setTheme]=useState<ThemePreference>(readPreference);const [mobileOpen,setMobileOpen]=useState(false);const [manualCollapsed,setManualCollapsed]=useState<boolean|null>(null);const [commandOpen,setCommandOpen]=useState(false);const [userMenuOpen,setUserMenuOpen]=useState(false);const [quickAddOpen,setQuickAddOpen]=useState(false);const [shortcutsOpen,setShortcutsOpen]=useState(false)
  /* `/` for search and `?` for help are the two conventions a user arrives already knowing, so they
   * cost nothing to learn and their absence is felt. Ctrl+K keeps working; `/` is the same door. */
  useShortcut('/',()=>setCommandOpen(true))
  useShortcut('?',()=>setShortcutsOpen((value)=>!value))
  // A job's pipeline board wants every stage column visible without horizontal scroll, which the
  // 268px sidebar leaves no room for at typical laptop widths -- so it defaults to the icon rail on
  // that route only. A manual toggle (either direction) overrides the route default for the rest of
  // the session rather than snapping back on the next navigation, which would fight the user.
  const pathSegments=location.pathname.split('/').filter(Boolean)
  const isJobWorkspace=pathSegments[2]==='jobs'&&Boolean(pathSegments[3])
  const collapsed=manualCollapsed??isJobWorkspace
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
  useEffect(()=>{if(organization)recordWorkflowEvent({organizationId:organization.id,eventName:'navigation_changed',surface:'consultant_first',destination:destinationFor(location.pathname)})},[location.pathname,organization])
  const changeOrganization=(id:string)=>{const membership=memberships.find((item)=>item.organizations.id===id);if(membership){setOrganization(membership.organizations);navigate(`/app/${membership.organizations.slug}/today`)}}
  const initials=useMemo(()=>organization?.name.split(/\s+/).slice(0,2).map((part)=>part[0]).join('').toUpperCase()||'A',[organization?.name])
  const root=`/app/${organization?.slug||'workspace'}`;const logoUrl=organization?.logo_url
  /* Only override when the agency has actually chosen a colour of its own. An inline value wins over
   * every stylesheet, including the dark theme's deliberately lifted accent, so injecting one
   * unconditionally paints the light-theme hex in dark mode -- the exact contrast failure tokens.css
   * warns about. primary_color is NOT NULL and defaults to DEFAULT_ACCENT, so "unset" reaches us as
   * that literal rather than as null; treating it as unset is what lets the theme-aware tokens work. */
  const custom=isHexColor(organization?.primary_color)&&organization.primary_color.toLowerCase()!==DEFAULT_ACCENT
  const style=custom?{"--color-accent":organization!.primary_color} as React.CSSProperties:undefined
  return <div className={`app-layout ${collapsed?'sidebar-collapsed':''}`} style={style}>
    <aside className={`sidebar ${mobileOpen?'sidebar-open':''}`}>
      <div className="brand"><span className="brand-mark">{logoUrl?<img src={logoUrl} alt=""/>:initials}</span><div><strong>{organization?.name||env.productName}</strong><small>{workspaceSubtitle({})}</small></div><button className="icon-button mobile-only" onClick={()=>setMobileOpen(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <label className="workspace-select"><span>Workspace</span><span className="select-wrap"><select value={organization?.id||''} onChange={(event)=>changeOrganization(event.target.value)}>{memberships.map((item)=><option value={item.organizations.id} key={item.id}>{item.organizations.name}</option>)}</select><ChevronDown className="select-chevron" size={14} aria-hidden="true"/></span></label>
      <nav aria-label="Primary navigation"><div className="nav-section nav-section-primary">{navItems.map(([path,label,Icon])=><NavLink data-label={label} key={path} to={`${root}/${path}`} onClick={()=>setMobileOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}{capabilities.data?.canWriteCandidates&&<NavLink data-label="Referrals" to={`${root}/referrals`} onClick={()=>setMobileOpen(false)}><UserPlus size={18}/><span>Referrals</span></NavLink>}</div>{capabilities.data?.canViewAdmin&&<div className="nav-section nav-section-admin"><span className="nav-section-label">Advanced</span><NavLink data-label="Admin" to={`${root}/admin`} onClick={()=>setMobileOpen(false)}><SlidersHorizontal size={18}/><span>Admin</span></NavLink></div>}</nav>
      <div className="sidebar-footer"><div className="user-chip"><Avatar name={user?.user_metadata.full_name||user?.email||'Agency user'} size="sm"/><div><strong>{user?.user_metadata.full_name||'Agency user'}</strong><small>{user?.email}</small></div></div><button className="sidebar-action" onClick={()=>void signOut()}><LogOut size={17}/><span>Sign out</span></button><button className="sidebar-action desktop-only" onClick={()=>setManualCollapsed(!collapsed)}><PanelLeftClose size={17}/><span>{collapsed?'Expand sidebar':'Collapse sidebar'}</span></button></div>
    </aside>
    {mobileOpen&&<button className="mobile-scrim" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>} 
    <div className="workspace"><header className="topbar"><button className="icon-button mobile-only" onClick={()=>setMobileOpen(true)} aria-label="Open navigation"><Menu size={19}/></button><div className="topbar-identity"><strong>{organization?.name}</strong><span>{workspaceSubtitle({readOnly:capabilities.data?.readOnly})}</span></div><RealtimeIndicator status={realtime}/><div className="topbar-actions"><button className="global-search" onClick={()=>setCommandOpen(true)}><Search size={16}/><span>Search candidates, jobs, or clients</span><kbd>Ctrl K</kbd></button><div className="topbar-menus" ref={topbarMenus}>{!capabilities.data?.readOnly&&<div className="quick-add"><Button size="sm" leadingIcon={<Plus size={13}/>} aria-expanded={quickAddOpen} aria-haspopup="menu" onClick={()=>{setQuickAddOpen((value)=>!value);setUserMenuOpen(false)}}>Add</Button>{quickAddOpen&&<div className="quick-add-popover" role="menu" aria-label="Create">{quickAddItems.filter(([path])=>path.startsWith('candidates')?capabilities.data?.canWriteCandidates:path.startsWith('clients')?capabilities.data?.canWriteClients:path.startsWith('jobs')?capabilities.data?.canWriteJobs:true).map(([path,label,Icon])=><button key={path} role="menuitem" onClick={()=>{setQuickAddOpen(false);navigate(`${root}/${path}`)}}><Icon size={15}/>{label}</button>)}</div>}</div>}<div className="user-menu"><button className="topbar-avatar" onClick={()=>{setUserMenuOpen((value)=>!value);setQuickAddOpen(false)}} aria-expanded={userMenuOpen} aria-label="Open user menu"><Avatar name={user?.user_metadata.full_name||user?.email||'Agency user'} size="sm"/><ChevronDown size={14}/></button>{userMenuOpen&&<div className="user-menu-popover"><strong>{user?.user_metadata.full_name||'Agency user'}</strong><span>{user?.email}</span><NavLink to={`${root}/admin/personal`} onClick={()=>setUserMenuOpen(false)}><Settings size={15}/>My settings</NavLink>{capabilities.data?.canViewAdmin&&<NavLink to={`${root}/admin`} onClick={()=>setUserMenuOpen(false)}><SlidersHorizontal size={15}/>Admin</NavLink>}<button onClick={()=>{const next:ThemePreference=theme==='system'?'dark':theme==='dark'?'light':'system';setTheme(next);writePreference(next);applyTheme(next)}}>{theme==='dark'?<Moon size={15}/>:theme==='light'?<Sun size={15}/>:<MonitorSmartphone size={15}/>}Theme: {theme==='system'?'System':theme==='dark'?'Dark':'Light'}</button><button onClick={()=>void signOut()}><LogOut size={15}/>Sign out</button></div>}</div></div></div></header><Outlet/></div>
    {organization&&<CommandPalette open={commandOpen} onClose={()=>setCommandOpen(false)} organizationId={organization.id} organizationSlug={organization.slug}/>}
    {organization&&<QuickTaskModal/>}
    <ShortcutSheet open={shortcutsOpen} onClose={()=>setShortcutsOpen(false)}/>
  </div>
}

/* Deliberately quiet, and deliberately silent when everything is fine.
 *
 * The workspace degrades to exactly its pre-realtime behaviour when the socket drops -- data still
 * refreshes on navigation and refetch -- so a red banner would overstate the problem. What the
 * consultant actually needs is the answer to "am I looking at what my colleague just did", and only
 * when the answer is no. So 'live' renders a dot with no words, and losing the connection is the only
 * state that spends any of the topbar's attention.
 *
 * `aria-live="polite"` rather than an alert: it is a status change, not something to interrupt for. */
function RealtimeIndicator({status}:{status:RealtimeStatus}){
  if(status==='off')return null
  const live=status==='live'
  return <span className={`realtime-indicator ${live?'realtime-indicator-live':'realtime-indicator-waiting'}`} aria-live="polite">
    <span className="realtime-dot" aria-hidden="true"/>
    <span className={live?'sr-only':undefined}>{live?'Live updates connected':'Reconnecting…'}</span>
  </span>
}

/* The shortcut sheet, on `?`.
 *
 * Grouped by where each key works rather than alphabetically, because "does this do anything on the
 * screen I am looking at" is the only question a reader has. Keys that are global are named as such;
 * the board's two are listed under it so nobody tries `d` on the candidate list and concludes the
 * shortcuts are broken. */
const shortcutGroups=[
  {title:'Anywhere',keys:[['/','Search candidates, jobs, clients, and actions'],['Ctrl K','The same search'],['?','Show or hide this list'],['Esc','Close whatever is open']]},
  {title:'Pipeline board',keys:[['a','Add candidates to this job'],['d','Show or hide detailed stages'],['Space','Pick up the focused candidate card'],['← →','Move a picked-up card between phases']]},
] as const

function ShortcutSheet({open,onClose}:{open:boolean;onClose:()=>void}){
  return <Modal title="Keyboard shortcuts" open={open} onClose={onClose}>
    <div className="stack">
      {shortcutGroups.map((group)=><section key={group.title}>
        <p className="command-section-label">{group.title}</p>
        <dl className="shortcut-list">{group.keys.map(([key,description])=><div key={key}><dt><kbd>{key}</kbd></dt><dd>{description}</dd></div>)}</dl>
      </section>)}
      <p className="muted">Shortcuts stay out of the way while you are typing in a field or working in a dialog.</p>
    </div>
  </Modal>
}
