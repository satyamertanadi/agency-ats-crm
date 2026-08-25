import {FileSignature,FileUp,Landmark,Settings,UsersRound} from 'lucide-react'
import {useQuery} from '@tanstack/react-query'
import {Link,Navigate} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {getMaintenanceDiagnostics,getMaintenanceHealth,type MaintenanceFaultStage} from '../core/commercialRepository'
import {formatDateTime} from '../../shared/lib/format'
import {Callout} from '../../shared/ui/Callout'
import {LoadingState} from '../../shared/ui/States'
import {Page} from '../../shared/ui/Page'

/* Retention, PII anonymization and expired-draft deletion run on a schedule the client is paying us
 * to keep running. When that schedule stops, the failure is invisible by nature -- nothing errors,
 * data simply stops being deleted. Surfacing it on the page owners already open is the difference
 * between a broken guarantee they find out about and one they don't. */
/* What to go and look at, per layer. "The job has stopped" was true but not actionable -- five
 * different faults produced that one sentence, and an owner reading it had no way to tell whether
 * the schedule was missing, the credential was being rejected, or the run was dying partway. The
 * stage comes from get_maintenance_health so this wording and the operator runbook stay in step. */
const faultGuidance:Record<MaintenanceFaultStage,string>={
  healthy:'',
  scheduler:'The hourly schedule has not fired at all. The pg_cron job is missing or not running -- re-run the production promotion, which re-registers it, then check back after the next hour.',
  delivery:'The schedule is firing, but the request is not reaching the maintenance worker. That is usually a rejected credential (a rotated service role key that the deployment secret no longer matches) or a transport failure. The diagnostics below carry the HTTP status.',
  execution:'The job starts each hour but never finishes. It is being cut off or is crashing partway, so some cleanup may be running while the rest is not.',
  run_failed:'The job ran to completion and reported a failure. The error it recorded is below.',
}

function MaintenanceHealthBanner({organizationId}:{organizationId:string}){
  const health=useQuery({queryKey:['maintenance-health',organizationId],queryFn:()=>getMaintenanceHealth(organizationId),staleTime:60_000})
  const stale=(health.data||[]).filter((job)=>job.isStale)
  /* Only fetched once something is actually wrong: it reads pg_cron and pg_net catalogs, which a
   * healthy workspace has no reason to touch on every visit to Admin. */
  const diagnostics=useQuery({queryKey:['maintenance-diagnostics',organizationId],queryFn:()=>getMaintenanceDiagnostics(organizationId),enabled:stale.length>0,staleTime:60_000})
  if(!stale.length)return null
  return <>{stale.map((job)=>
    <Callout key={job.jobKey} tone="danger" title="Background data cleanup has stopped">
      {job.lastSuccessfulRunAt
        ?`The ${job.jobKey} job last succeeded on ${formatDateTime(job.lastSuccessfulRunAt)}, more than ${job.staleAfterHours} hours ago. `
        :`The ${job.jobKey} job has never completed a successful run. `}
      Candidate retention, anonymization and expired CV deletion are not being enforced until it runs again.
      {faultGuidance[job.faultStage]&&<> {faultGuidance[job.faultStage]}</>}
      {job.lastError&&<> Last error: {job.lastError}</>}
      <dl className="maintenance-diagnostics">
        <div><dt>Last attempt</dt><dd>{job.lastAttemptAt?formatDateTime(job.lastAttemptAt):'Never'}</dd></div>
        <div><dt>Last start</dt><dd>{job.lastStartedAt?formatDateTime(job.lastStartedAt):'Never'}</dd></div>
        <div><dt>Last finish</dt><dd>{job.lastFinishedAt?formatDateTime(job.lastFinishedAt):'Never'}</dd></div>
        {diagnostics.data&&<>
          <div><dt>Schedule</dt><dd>{diagnostics.data.cronRegistered?diagnostics.data.cronSchedule||'Registered':'Not registered'}</dd></div>
          {diagnostics.data.cronLastRunAt&&<div><dt>Schedule last ran</dt><dd>{formatDateTime(diagnostics.data.cronLastRunAt)}{diagnostics.data.cronLastStatus?` (${diagnostics.data.cronLastStatus})`:''}</dd></div>}
          {diagnostics.data.transportStatusCode!==null&&<div><dt>Worker responded</dt><dd>HTTP {diagnostics.data.transportStatusCode}</dd></div>}
          {diagnostics.data.transportError&&<div><dt>Transport error</dt><dd>{diagnostics.data.transportError}</dd></div>}
          {diagnostics.data.cronLastError&&<div><dt>Schedule error</dt><dd>{diagnostics.data.cronLastError}</dd></div>}
        </>}
      </dl>
    </Callout>,
  )}</>
}

export function AdminCenterPage(){
  const {organization}=useOrganization();const capabilities=useWorkspaceCapabilities()
  if(capabilities.isLoading)return <LoadingState label="Checking access…"/>
  if(!capabilities.data?.canViewAdmin)return <Navigate to={`/app/${organization!.slug}/today`} replace/>
  const base=`/app/${organization!.slug}/admin`
  const items=[
    /* Recording a placement is a recruitment act, not a finance one, and it was reachable only
     * through this finance-gated tile -- so a consultant holding placements.write could convert an
     * accepted offer from the candidate panel but could not see the placement afterwards, and could
     * not record one directly at all. The tile follows placements.write; the revenue splits and
     * invoices inside the page keep their own finance check. */
    capabilities.data.canManagePlacements&&{href:`${base}/finance`,title:'Placements',description:capabilities.data.canManageFinance?'Placements, revenue credits, invoices, and guarantees.':'Placements, starts, and guarantees.',icon:Landmark},
    /* Hidden once the migration is signed off. The page is correct and necessary for the Vincere
     * cutover and stays reachable at its route for correction and re-migration runs -- but its
     * rollback button deletes committed records and anything edited since, which is not a control
     * to leave sitting in a nav for years to serve one week of work. */
    capabilities.data.canImport&&!organization?.migration_complete&&{href:`${base}/imports`,title:'Data imports',description:'Controlled migration, validation, and rollback.',icon:FileUp},
    capabilities.data.canManageTemplates&&{href:`${base}/templates`,title:'Profile templates',description:'Client-facing candidate profile formats.',icon:FileSignature},
    capabilities.data.canManageWorkspace&&{href:`${base}/workspace`,title:'Team & workspace',description:'Access, branding, roles, and organization settings.',icon:UsersRound},
  ].filter(Boolean) as Array<{href:string;title:string;description:string;icon:typeof Settings}>
  return <Page title="Admin" eyebrow="Advanced workspace" description="Controls used occasionally by owners, managers, finance, and administrators.">
    {capabilities.data.canManageOrganization&&<MaintenanceHealthBanner organizationId={organization!.id}/>}
    <div className="admin-grid">{items.map(({href,title,description,icon:Icon})=><Link to={href} key={href}><Icon size={20}/><span><strong>{title}</strong><small>{description}</small></span></Link>)}</div>
  </Page>
}
