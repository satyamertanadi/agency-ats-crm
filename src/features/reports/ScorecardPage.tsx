import {useMemo,useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Link} from 'react-router'
import {ArrowRight} from 'lucide-react'
import {useAuth} from '../../app/AuthProvider'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {getAgencyPerformance,listTeamMembers} from '../core/commercialRepository'
import {Field,Input} from '../../shared/ui/Field'
import {Page,Panel} from '../../shared/ui/Page'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {Table} from '../../shared/ui/Table'
import {formatDateTime,formatMoney} from '../../shared/lib/format'
import {buildConsultantRows,isOverdueTask,metricDefinitions,reportDateRange,type ConsultantRow} from './reportMetrics'

const dateValue=(date:Date)=>date.toISOString().slice(0,10)

/* Every tile states its own definition. A scorecard whose numbers a consultant cannot interpret is
 * a scorecard they argue with rather than act on, and these are the same definitions the team report
 * renders from -- there is one contract, not a personal dialect. */
const tiles=[
  {key:'submissions',label:'Submissions',definition:metricDefinitions.submission},
  {key:'interviews',label:'Interviews',definition:metricDefinitions.interview},
  {key:'offers',label:'Offers',definition:metricDefinitions.offer},
  {key:'placements',label:'Placements',definition:metricDefinitions.placement},
] as const

const rate=(numerator:number,denominator:number)=>denominator>0?`${Math.round(numerator/denominator*100)}%`:'—'

export function ScorecardPage(){
  const {organization,memberships}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities()
  const now=useMemo(()=>new Date(),[])
  const [from,setFrom]=useState(dateValue(new Date(now.getFullYear(),0,1)));const [to,setTo]=useState(dateValue(now))
  const range=reportDateRange(from,to,organization?.timezone||'UTC')
  const performance=useQuery({queryKey:['agency-performance',organization?.id,from,to],enabled:Boolean(organization&&from&&to),queryFn:()=>getAgencyPerformance(organization!.id,range.fromIso,range.toIso)})
  const team=useQuery({queryKey:['team',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  const currentMember=memberships.find((item)=>item.organization_id===organization?.id&&item.user_id===user?.id)

  if(performance.isLoading||team.isLoading||capabilities.isLoading)return <Page title="My scorecard" eyebrow="Personal performance" description="Your own recruitment activity and outcomes, using the same definitions as the team report."><Panel><TableSkeleton rows={5} columns={4} label="Preparing your scorecard…"/></Panel></Page>
  if(performance.error||team.error)return <ErrorState error={performance.error||team.error}/>

  const data=performance.data!
  const overdueTasks=data.tasks.filter((item)=>isOverdueTask(item,now))
  /* Built from the same builder the team report uses, then filtered to this member. Recomputing a
   * personal variant is how a consultant's own total comes to disagree with the one their manager
   * is looking at in the same meeting. */
  const rows=buildConsultantRows({members:team.data||[],submissions:data.submissions,interviews:data.interviews,offers:data.offers,placements:data.placements,activeJobs:data.activeJobs,overdueTasks,baseCurrency:organization?.base_currency})
  const mine:ConsultantRow=rows.find((row)=>row.id===currentMember?.id)??{id:currentMember?.id||'me',name:user?.user_metadata.full_name as string||'You',jobs:0,submissions:0,interviews:0,offers:0,placements:0,fees:0,overdue:0}
  const base=`/app/${organization!.slug}`
  /* Every other number on this page is the consultant's own; this one counted every accepted offer in
   * the organization, and counted offers that had already become placements. On a page titled "What
   * needs you now", both halves were wrong in the same direction -- it reported work that was not
   * theirs, and work that was already done.
   *
   * Attributed by `created_by`, which is how buildConsultantRows attributes the offers and placements
   * rendered directly above it. Scoping this one tile by job ownership instead would make it disagree
   * with the conversion rates it sits under, on the same screen. */
  const placedCandidates=new Set(data.placements.filter((placement)=>placement.status!=='cancelled').map((placement)=>placement.job_candidate_id))
  const awaitingPlacement=data.offers.filter((offer)=>offer.status==='accepted'&&offer.created_by===user?.id&&!placedCandidates.has(offer.job_candidate_id))

  return <Page title="My scorecard" eyebrow="Personal performance" description="Your own recruitment activity and outcomes, using the same definitions as the team report."
    actions={<div className="date-range"><Field label="From"><Input type="date" value={from} max={to} onChange={(event)=>setFrom(event.target.value)}/></Field><Field label="To"><Input type="date" value={to} min={from} onChange={(event)=>setTo(event.target.value)}/></Field></div>}>
    <p className="report-context">Workspace timezone: <strong>{organization?.timezone}</strong> · Refreshed <time dateTime={now.toISOString()}>{formatDateTime(now.toISOString())}</time></p>
    {!currentMember&&<EmptyState title="No membership found" description="Your user is not an active member of this workspace, so there is no activity to attribute."/>}
    <div className="kpi-grid">
      {tiles.map((tile)=><article className="kpi" key={tile.key} title={tile.definition}><div><p>{tile.label}</p><strong>{mine[tile.key]}</strong></div></article>)}
      <article className="kpi"><div><p>Fees · base currency</p><strong>{formatMoney(mine.fees,organization?.base_currency)}</strong></div></article>
      <article className="kpi"><div><p>Jobs owned</p><strong>{mine.jobs}</strong></div></article>
    </div>
    <div className="two-column">
      <Panel title="Conversion" subtitle="Your own progression rates for the selected period.">
        <Table caption="Personal conversion rates" headers={['Step','Rate']}>
          <tr><td>Submission → interview</td><td>{rate(mine.interviews,mine.submissions)}</td></tr>
          <tr><td>Interview → offer</td><td>{rate(mine.offers,mine.interviews)}</td></tr>
          <tr><td>Offer → placement</td><td>{rate(mine.placements,mine.offers)}</td></tr>
          <tr><td>Submission → placement</td><td>{rate(mine.placements,mine.submissions)}</td></tr>
        </Table>
      </Panel>
      <Panel title="What needs you now" subtitle="Signals worth acting on rather than a ranking.">
        <div className="settings-list">
          {/* Each number links to the surface that resolves it. A tile on a page called "What needs you
            * now" that cannot be clicked is a report, not a prompt. */}
          <article className="finance-row"><span>Overdue tasks</span><Link className="record-link" to={`${base}/today`}><strong className={mine.overdue?'overdue-text':''}>{mine.overdue}</strong></Link></article>
          <article className="finance-row"><span>Jobs you own</span><Link className="record-link" to={`${base}/jobs`}><strong>{mine.jobs}</strong></Link></article>
          <article className="finance-row"><span>Accepted offers awaiting placement</span><Link className="record-link" to={`${base}/today`}><strong>{awaitingPlacement.length}</strong></Link></article>
        </div>
        <div className="panel-footer-action"><Link className="record-link" to={`${base}/today`}>Go to Today <ArrowRight size={13}/></Link></div>
      </Panel>
    </div>
    {/* Managers get one click to the comparison view; consultants never see a colleague's numbers
      * here, because the route itself is capability-gated rather than the link merely hidden. */}
    {capabilities.data?.canViewTeamReports&&<p className="muted report-note">Comparing the team? <Link className="record-link" to={`${base}/admin/reports`}>Open the team report <ArrowRight size={13}/></Link></p>}
    <p className="muted report-note">Counts use the definitions in the product metric contract and reconcile with the team report for the same period. Fee totals include only recorded placements already denominated in {organization?.base_currency}; no exchange rate is invented.</p>
  </Page>
}
