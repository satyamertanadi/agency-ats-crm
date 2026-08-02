import {BarChart3,FileSignature,FileUp,Landmark,Settings,SlidersHorizontal,UsersRound} from 'lucide-react'
import {Link,Navigate} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {LoadingState} from '../../shared/ui/States'
import {Page} from '../../shared/ui/Page'

export function AdminCenterPage(){
  const {organization}=useOrganization();const capabilities=useWorkspaceCapabilities()
  if(capabilities.isLoading)return <LoadingState label="Checking access…"/>
  if(!capabilities.data?.canViewAdmin)return <Navigate to={`/app/${organization!.slug}/today`} replace/>
  const base=`/app/${organization!.slug}/admin`
  const items=[
    capabilities.data.canViewTeamReports&&{href:`${base}/reports`,title:'Reports',description:'Agency funnel, workload, and consultant performance.',icon:BarChart3},
    /* Recording a placement is a recruitment act, not a finance one, and it was reachable only
     * through this finance-gated tile -- so a consultant holding placements.write could convert an
     * accepted offer from the candidate panel but could not see the placement afterwards, and could
     * not record one directly at all. The tile follows placements.write; the revenue splits and
     * invoices inside the page keep their own finance check. */
    capabilities.data.canManagePlacements&&{href:`${base}/finance`,title:'Placements',description:capabilities.data.canManageFinance?'Placements, revenue credits, invoices, and guarantees.':'Placements, starts, and guarantees.',icon:Landmark},
    capabilities.data.canImport&&{href:`${base}/imports`,title:'Data imports',description:'Controlled migration, validation, and rollback.',icon:FileUp},
    capabilities.data.canManageTemplates&&{href:`${base}/templates`,title:'Profile templates',description:'Client-facing candidate profile formats.',icon:FileSignature},
    capabilities.data.canManageWorkspace&&{href:`${base}/workspace`,title:'Team & workspace',description:'Access, branding, roles, and organization settings.',icon:UsersRound},
    capabilities.data.canManageWorkspace&&{href:`${base}/pipeline`,title:'Pipeline configuration',description:'Map detailed stages into the consultant view.',icon:SlidersHorizontal},
  ].filter(Boolean) as Array<{href:string;title:string;description:string;icon:typeof Settings}>
  return <Page title="Admin" eyebrow="Advanced workspace" description="Controls used occasionally by owners, managers, finance, and administrators."><div className="admin-grid">{items.map(({href,title,description,icon:Icon})=><Link to={href} key={href}><Icon size={20}/><span><strong>{title}</strong><small>{description}</small></span></Link>)}</div></Page>
}
