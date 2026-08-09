import {BarChart3,FileSignature,FileUp,Landmark,Settings,UsersRound} from 'lucide-react'
import {useQuery} from '@tanstack/react-query'
import {Link,Navigate} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {getMaintenanceHealth} from '../core/commercialRepository'
import {formatDateTime} from '../../shared/lib/format'
import {Callout} from '../../shared/ui/Callout'
import {LoadingState} from '../../shared/ui/States'
import {Page} from '../../shared/ui/Page'

/* Retention, PII anonymization and expired-draft deletion run on a schedule the client is paying us
 * to keep running. When that schedule stops, the failure is invisible by nature -- nothing errors,
 * data simply stops being deleted. Surfacing it on the page owners already open is the difference
 * between a broken guarantee they find out about and one they don't. */
function MaintenanceHealthBanner({organizationId}:{organizationId:string}){
  const health=useQuery({queryKey:['maintenance-health',organizationId],queryFn:()=>getMaintenanceHealth(organizationId),staleTime:60_000})
  const stale=(health.data||[]).filter((job)=>job.isStale)
  if(!stale.length)return null
  return <>{stale.map((job)=>
    <Callout key={job.jobKey} tone="danger" title="Background data cleanup has stopped">
      {job.lastSuccessfulRunAt
        ?`The ${job.jobKey} job last succeeded on ${formatDateTime(job.lastSuccessfulRunAt)}, more than ${job.staleAfterHours} hours ago. `
        :`The ${job.jobKey} job has never completed a successful run. `}
      Candidate retention, anonymization and expired CV deletion are not being enforced until it runs again.
      {job.lastError&&<> Last error: {job.lastError}</>}
    </Callout>,
  )}</>
}

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
  ].filter(Boolean) as Array<{href:string;title:string;description:string;icon:typeof Settings}>
  return <Page title="Admin" eyebrow="Advanced workspace" description="Controls used occasionally by owners, managers, finance, and administrators.">
    {capabilities.data.canManageOrganization&&<MaintenanceHealthBanner organizationId={organization!.id}/>}
    <div className="admin-grid">{items.map(({href,title,description,icon:Icon})=><Link to={href} key={href}><Icon size={20}/><span><strong>{title}</strong><small>{description}</small></span></Link>)}</div>
  </Page>
}
