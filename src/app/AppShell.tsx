import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { BarChart3, BriefcaseBusiness, Building2, CalendarRange, CheckSquare, ContactRound, FileText, LayoutDashboard, LogOut, Menu, PanelLeftClose, Search, Send, Settings, UserRoundSearch, WalletCards, X } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { useOrganization } from './OrganizationProvider'
import { env } from '../shared/lib/env'

const links = [
  ['dashboard','Dashboard',LayoutDashboard],['candidates','Candidates',UserRoundSearch],['jobs','Jobs',BriefcaseBusiness],
  ['companies','Companies',Building2],['contacts','Contacts',ContactRound],['submissions','Submissions',Send],
  ['delivery','Interviews & offers',CalendarRange],['placements','Placements',WalletCards],['tasks','Tasks',CheckSquare],['search','Search',Search],['reports','Reports',BarChart3],['templates','Templates',FileText],['settings','Settings',Settings],
] as const

export function AppShell() {
  const { signOut, user } = useAuth()
  const { memberships, organization, setOrganization } = useOrganization()
  const navigate = useNavigate()
  const [mobileOpen,setMobileOpen] = useState(false)
  const [collapsed,setCollapsed] = useState(false)
  const changeOrganization = (id:string) => {
    const membership=memberships.find((item)=>item.organizations.id===id)
    if(membership){setOrganization(membership.organizations);navigate(`/app/${membership.organizations.slug}/dashboard`)}
  }
  return <div className={`app-layout ${collapsed?'sidebar-collapsed':''}`}>
    <aside className={`sidebar ${mobileOpen?'sidebar-open':''}`}>
      <div className="brand"><span className="brand-mark">A</span><div><strong>{env.productName}</strong><small>Recruitment workspace</small></div><button className="icon-button mobile-only" onClick={()=>setMobileOpen(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <label className="workspace-select"><span>Workspace</span><select value={organization?.id||''} onChange={(event)=>changeOrganization(event.target.value)}>{memberships.map((item)=><option value={item.organizations.id} key={item.id}>{item.organizations.name}</option>)}</select></label>
      <nav aria-label="Primary navigation">{links.map(([path,label,Icon])=><NavLink key={path} to={`/app/${organization?.slug||'workspace'}/${path}`} onClick={()=>setMobileOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-footer"><div className="user-chip"><span>{user?.email?.slice(0,1).toUpperCase()}</span><div><strong>{user?.user_metadata.full_name||'Agency user'}</strong><small>{user?.email}</small></div></div><button className="sidebar-action" onClick={()=>void signOut()}><LogOut size={17}/><span>Sign out</span></button><button className="sidebar-action desktop-only" onClick={()=>setCollapsed((value)=>!value)}><PanelLeftClose size={17}/><span>Collapse sidebar</span></button></div>
    </aside>
    {mobileOpen&&<button className="mobile-scrim" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>} 
    <div className="workspace"><header className="topbar"><button className="icon-button mobile-only" onClick={()=>setMobileOpen(true)} aria-label="Open navigation"><Menu size={19}/></button><div><strong>{organization?.name}</strong><span>Agency operations</span></div><NavLink className="global-search" to={`/app/${organization?.slug||'workspace'}/search`}><Search size={16}/>Search workspace <kbd>⌘ K</kbd></NavLink></header><Outlet/></div>
  </div>
}
