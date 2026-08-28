import {useMemo,useState,type ReactNode} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Link,useSearchParams} from 'react-router'
import {ArrowRight} from 'lucide-react'
import {Bar,BarChart,CartesianGrid,Legend,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'
import {useAuth} from '../../app/AuthProvider'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {getAgencyPerformance,listTeamMembers} from '../core/commercialRepository'
import {Field,Input} from '../../shared/ui/Field'
import {Page,Panel} from '../../shared/ui/Page'
import {SegmentedControl} from '../../shared/ui/SegmentedControl'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {Table} from '../../shared/ui/Table'
import {ChartCard,chartTooltipStyle} from '../../shared/ui/ChartCard'
import {formatDateRange,formatDateTime,formatMoney,formatMoneyCompact} from '../../shared/lib/format'
import {buildConsultantRows,buildRecruitmentFunnel,isCompletedPlacement,isOverdueTask,isRecordedPlacement,metricDefinitions,reportDateRange,shortNameLabels,type ConsultantRow} from './reportMetrics'
import {parseMetric,type DrilldownContext,type DrilldownInput} from './scorecardDrilldown'
import {InterviewQualityPanel} from '../interview-intelligence/InterviewQualityPanel'
import {ScorecardDrilldownDrawer} from './ScorecardDrilldownDrawer'

/* A money figure sized for a KPI cell: abbreviated on screen, exact on hover and to a screen reader.
 *
 * "IDR 124,000,000" does not fit a ~160px tile at any type size the rest of the strip uses, so it
 * either wrapped mid-number or pushed the strip wider than the page. The exact figure is never lost:
 * `title` carries it for a pointer, and the sr-only span carries it for assistive technology, which a
 * title attribute alone does not reliably do. */
function CompactMoney({value,currency}:{value:number|null|undefined;currency?:string|null}){
  const {short,full}=formatMoneyCompact(value,currency)
  return <span title={full}>{short}<span className="sr-only"> ({full})</span></span>
}

/* One hue for the two neutral series, red reserved for the one that is a problem.
 *
 * Jobs and submissions were accent-blue and violet -- two unrelated brand colours for two facts that
 * are both just "work in progress", which asks the reader to learn a key before the chart says
 * anything. A light/dark pair of the same hue reads as two parts of one quantity, which is what a
 * stack IS, and leaves red meaning only "overdue" -- the sole series here that anyone needs to act on.
 * Matches the pipeline bar's ramp on the jobs list, so the two charts in the product use one system. */
const workloadSeries=[
  {key:'jobs',label:'Active jobs',fill:'color-mix(in srgb, var(--color-accent) 45%, var(--color-surface))'},
  {key:'submissions',label:'Submissions',fill:'var(--color-accent)'},
  {key:'overdue',label:'Overdue actions',fill:'var(--color-danger)'},
] as const

const dateValue=(date:Date)=>date.toISOString().slice(0,10)

/* One reporting page with a scope toggle, replacing a personal scorecard and a separate team report
 * that called the same getAgencyPerformance, built rows with the same buildConsultantRows, carried
 * their own date picker each, and cross-linked to one another. Same 'mine' | 'team' pattern Today
 * already uses, gated the same way -- on reports.team via canViewTeamReports.
 *
 * Both scopes read one query and one set of definitions, which is the point: a consultant's own
 * total can no longer disagree with the one their manager is looking at in the same meeting. */
type Scope='mine'|'team'

/* The second view the plan asks for on the existing Scorecard route, rather than a new page.
 *
 * Interview quality belongs beside the commercial numbers because it is read in the same
 * conversation -- a one-to-one about a consultant's month covers both -- and a separate route would
 * make the two halves of that conversation two destinations with two date pickers that can disagree.
 */
type View='performance'|'quality'

/* Every tile states its own definition. A scorecard whose numbers a consultant cannot interpret is
 * a scorecard they argue with rather than act on.
 *
 * The interview and offer definitions changed here, and the NUMBERS did not. These tiles are built by
 * buildConsultantRows, which applies no cohort constraint -- so they were labelled with the team
 * funnel's cohort sentences while counting something slightly wider. A consultant reconciling the
 * tile against the sentence under their cursor would have found a discrepancy that does not exist.
 *
 * `placements` likewise carries the RECORDED definition, because that is what buildConsultantRows
 * counts. The cohort placement figure still exists, in the funnel, where it is labelled as such. */
const tiles=[
  {key:'submissions',label:'Submissions',definition:metricDefinitions.submission,metric:'submissions'},
  {key:'interviews',label:'Interviews',definition:metricDefinitions.consultantInterview,metric:'interviews'},
  {key:'offers',label:'Offers',definition:metricDefinitions.consultantOffer,metric:'offers'},
  {key:'placements',label:'Placements',definition:metricDefinitions.recordedPlacement,metric:'recordedPlacements'},
] as const

/* A KPI tile that may or may not be openable.
 *
 * `metric` is what decides, and it is absent far more often than it is present. A tile becomes a
 * button only when a drilldown can show exactly the records it counted -- see scorecardDrilldown --
 * and the ones left inert are inert deliberately: "Jobs opened" has no destination that means the
 * same thing, and a fee total is an amount rather than a population, so there is no list whose length
 * is the number on the tile.
 *
 * The openable ones become a real <button> rather than a clickable <article>, so they are reachable
 * by keyboard and announced as actionable. Keeping the same .kpi class means the two kinds sit in one
 * grid without the openable ones shouting; .kpi-actionable adds the hover and focus affordance only. */
function MetricTile({label,value,definition,caption,metric,onOpen}:{
  label:string
  value:ReactNode
  definition?:string
  caption?:ReactNode
  metric?:string
  onOpen?:(metric:string)=>void
}){
  const body=<div><p>{label}</p><strong>{value}</strong>{caption&&<small className="kpi-caption">{caption}</small>}</div>
  if(!metric||!onOpen)return <article className="kpi" title={definition}>{body}</article>
  return <button type="button" className="kpi kpi-actionable" title={definition}
    aria-label={`${label}: show the records behind this number`} onClick={()=>onOpen(metric)}>{body}</button>
}

const rate=(numerator:number,denominator:number)=>denominator>0?`${Math.round(numerator/denominator*100)}%`:'—'

export function ScorecardPage(){
  const {organization,membership}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities()
  const now=useMemo(()=>new Date(),[])
  const [from,setFrom]=useState(dateValue(new Date(now.getFullYear(),0,1)));const [to,setTo]=useState(dateValue(now))
  const [scope,setScope]=useState<Scope>('mine')
  const [view,setView]=useState<View>('performance')
  /* The open drilldown lives in the URL so it survives a reload and can be linked to in a message
   * that says "look at these fourteen". The date range does not, which is a pre-existing asymmetry
   * and out of scope here -- a shared link therefore opens the drawer over whatever range the
   * recipient's page defaults to, and the drawer's count is always the count of the tile beside it
   * rather than of the range the sender was reading. */
  const [params,setParams]=useSearchParams()
  const range=reportDateRange(from,to,organization?.timezone||'UTC')
  const showingQuality=view==='quality'
  const performance=useQuery({queryKey:['agency-performance',organization?.id,from,to],enabled:Boolean(organization&&from&&to)&&!showingQuality,queryFn:()=>getAgencyPerformance(organization!.id,range.fromIso,range.toIso)})
  const team=useQuery({queryKey:['team',organization?.id],enabled:Boolean(organization)&&!showingQuality,queryFn:()=>listTeamMembers(organization!.id)})
  const currentMember=membership
  // Losing the capability mid-session (a role change landing in a refetch) must not strand the page
  // on a view the user may no longer see.
  const canViewTeam=Boolean(capabilities.data?.canViewTeamReports)
  /* Interview quality has its own team permission. Reviewing a colleague's interview technique is a
   * different grant from reading the desk's commercial numbers, so the toggle's team option is gated
   * on whichever permission the current view actually needs. */
  const canReviewQuality=Boolean(capabilities.data?.canReviewTeamInterviewQuality)
  const canSeeQuality=Boolean(capabilities.data?.canViewOwnInterviewQuality)||canReviewQuality
  const canViewTeamHere=showingQuality?canReviewQuality:canViewTeam
  const activeScope:Scope=canViewTeamHere?scope:'mine'

  const title=activeScope==='team'?'Team scorecard':'My scorecard'
  const description=showingQuality
    ?(activeScope==='team'
      ?'How interviews are being conducted across the desk. Patterns and training themes, never a ranking of consultants.'
      :'How your own interviews are being conducted, compared only against your own previous period.')
    :(activeScope==='team'
      ?'Agency funnel, workload, and consultant performance for the selected period.'
      :'Your own recruitment activity and outcomes, using the same definitions as the team view.')

  if((!showingQuality&&(performance.isLoading||team.isLoading))||capabilities.isLoading)return <Page title={title} eyebrow="Performance" description={description}><Panel><TableSkeleton rows={5} columns={4} label="Preparing the scorecard…"/></Panel></Page>
  if(!showingQuality&&(performance.error||team.error))return <ErrorState error={performance.error||team.error}/>

  const data=performance.data!
  const overdueTasks=data.tasks.filter((item)=>isOverdueTask(item,now))
  const rows=buildConsultantRows({members:team.data||[],submissions:data.submissions,interviews:data.interviews,offers:data.offers,placements:data.placements,activeJobs:data.activeJobs,overdueTasks,baseCurrency:organization?.base_currency})
  const mine:ConsultantRow=rows.find((row)=>row.id===currentMember?.id)??{id:currentMember?.id||'me',name:user?.user_metadata.full_name as string||'You',jobs:0,submissions:0,interviews:0,offers:0,placements:0,fees:0,overdue:0}
  const base=`/app/${organization!.slug}`

  /* Built from the records the page already loaded. No request per tile, and no second definition of
   * any of these numbers on the server -- the id set IS the tile's population, computed by the same
   * predicates a few lines above. */
  const drilldownInput:DrilldownInput={submissions:data.submissions,interviews:data.interviews,offers:data.offers,placements:data.placements}
  const drilldownContext:DrilldownContext={scope:activeScope,userId:user?.id}
  const metric=parseMetric(params.get('metric'))
  const openMetric=(id:string)=>{const next=new URLSearchParams(params);next.set('metric',id);setParams(next,{replace:true})}
  const closeMetric=()=>{const next=new URLSearchParams(params);next.delete('metric');setParams(next,{replace:true})}
  const drilldown=metric
    ?<ScorecardDrilldownDrawer metric={metric} definition={metric.definition(drilldownContext)}
      ids={metric.select(drilldownInput,drilldownContext)} onClose={closeMetric}/>
    :null

  const scopeToggle=canViewTeamHere?<SegmentedControl label="Report scope" value={scope} onChange={setScope}
    options={[{id:'mine',label:'My scorecard'},{id:'team',label:'Team view'}]}/>:null
  const viewToggle=canSeeQuality?<SegmentedControl label="Report view" value={view} onChange={setView}
    options={[{id:'performance',label:'Performance'},{id:'quality',label:'Interview quality'}]}/>:null
  const datePicker=<div className="date-range"><Field label="From"><Input type="date" value={from} max={to} onChange={(event)=>setFrom(event.target.value)}/></Field><Field label="To"><Input type="date" value={to} min={from} onChange={(event)=>setTo(event.target.value)}/></Field></div>
  const actions=<div className="page-scope-actions">{viewToggle}{scopeToggle}{datePicker}</div>
  /* The two <input type="date"> above render in the viewer's browser locale, from shadow DOM that
   * cannot be reformatted -- so an en-US machine shows "12/31/2025" and, worse, "08/09/2026" for a
   * date that half the world reads as 8 September and half as 9 August. Echoing the resolved range
   * with the month as a word removes the second reading without replacing a native control (and
   * losing its calendar, keyboard handling, mobile picker and min/max enforcement) to get there. */
  const context=<p className="report-context">Showing <strong>{formatDateRange(from,to)}</strong> · Workspace timezone: <strong>{organization?.timezone}</strong> · Refreshed <time dateTime={now.toISOString()}>{formatDateTime(now.toISOString())}</time></p>
  const footnote=<p className="muted report-note">Counts use the definitions in the product metric contract and reconcile across both scopes for the same period. Fee totals include only recorded placements already denominated in {organization?.base_currency}; no exchange rate is invented.</p>

  if(showingQuality){
    return <Page title={title} eyebrow="Performance" description={description} actions={actions}>
      {context}
      <InterviewQualityPanel scope={activeScope} fromIso={range.fromIso} toIso={range.toIso}/>
      {/* Deliberately not the commercial footnote: none of the definitions it describes apply here,
        * and a note about fee currency under a coverage table is noise that trains people to skip
        * footnotes on the page where one of them matters. */}
      <p className="muted report-note">
        Interview quality is assessed independently of how the candidate performed, and no figure here
        is a grade. Averages are withheld until a dimension has enough analysed interviews behind it.
      </p>
    </Page>
  }

  if(activeScope==='team'){
    const recordedPlacements=data.placements.filter(isRecordedPlacement)
    const recordedPlacementCount=new Set(recordedPlacements.map((item)=>item.job_candidate_id)).size
    const funnel=buildRecruitmentFunnel({submissions:data.submissions,interviews:data.interviews,offers:data.offers,placements:data.placements})
    const baseFees=recordedPlacements.filter((item)=>item.currency===organization?.base_currency).reduce((sum,item)=>sum+Number(item.placement_fee),0)
    /* Labels come from shortNameLabels rather than `name.split(' ')[0]`, which rendered two
     * colleagues called Satya as two bars both labelled "Satya" -- and Recharts keys categories by
     * that string, so they could collapse into one bar entirely. */
    const workloadLabels=shortNameLabels(rows.map((row)=>row.name))
    const workload=rows.map((row,index)=>({name:workloadLabels[index]!,jobs:row.jobs,submissions:row.submissions,overdue:row.overdue}))
    return <Page title={title} eyebrow="Performance" description={description} actions={actions}>
      {context}
      {/* "Recorded placements" carried metricDefinitions.placement, which is the COHORT definition --
        * so the tile's own tooltip described a different number from the one printed above it, and a
        * reader comparing it against the funnel's fourth bar found two placement totals that would not
        * reconcile and no explanation anywhere. It now states its own definition, and its caption names
        * the funnel figure beside it so the difference is visible rather than discovered. */}
      <div className="kpi-grid">
        {/* Jobs opened is not openable: the jobs list has no "created in this range" filter, so every
          * destination it could point at would show a different set of jobs from the one counted
          * here. A tile that opens the wrong list is worse than one that does nothing. */}
        <MetricTile label="Jobs opened" value={data.jobs.length}/>
        <MetricTile label="Candidates submitted" value={funnel[0]!.value} definition={metricDefinitions.submission} metric="submissions" onOpen={openMetric}/>
        <MetricTile label="Candidates interviewed" value={funnel[1]!.value} definition={metricDefinitions.interview} metric="interviews" onOpen={openMetric}/>
        <MetricTile label="Candidates offered" value={funnel[2]!.value} definition={metricDefinitions.offer} metric="offers" onOpen={openMetric}/>
        <MetricTile label="Recorded placements" value={recordedPlacementCount} definition={metricDefinitions.recordedPlacement}
          caption={`${funnel[3]!.value} from this period's submissions`} metric="recordedPlacements" onOpen={openMetric}/>
        {/* A fee total is an amount, not a population. There is no list whose LENGTH is this number,
          * so the one promise a drilldown makes -- that it contains exactly what the tile counted --
          * cannot be kept here. */}
        <MetricTile label="Fees · base currency" value={<CompactMoney value={baseFees} currency={organization?.base_currency}/>}/>
      </div>
      <div className="chart-grid">
        {/* One series, so no legend: the axis already names every bar, and a legend reading "value"
          * would explain nothing. */}
        <ChartCard title="Recruitment funnel" description="Unique candidate/job milestones within the cohort submitted during this period." summary={<table><caption>Recruitment funnel totals</caption><tbody>{funnel.map((item)=><tr key={item.name}><th>{item.name}</th><td>{item.value}</td></tr>)}</tbody></table>}><ResponsiveContainer width="100%" height="100%"><BarChart data={funnel} margin={{top:8,right:12,left:-18,bottom:4}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line-soft)"/><XAxis dataKey="name" axisLine={false} tickLine={false}/><YAxis allowDecimals={false} axisLine={false} tickLine={false}/><Tooltip {...chartTooltipStyle}/><Bar name="Candidates" dataKey="value" fill="var(--color-accent)" radius={[7,7,0,0]} maxBarSize={58}/></BarChart></ResponsiveContainer></ChartCard>
        {/* Three stacked series with no legend at all: the colours were the only thing distinguishing
          * them and nothing on the chart said what they meant. */}
        <ChartCard title="Consultant workload" description="Active vacancies, unique submissions, and overdue actions." summary={<table><caption>Consultant workload totals</caption><tbody>{rows.map((row)=><tr key={row.id}><th>{row.name}</th><td>{row.jobs} jobs, {row.submissions} submissions, {row.overdue} overdue</td></tr>)}</tbody></table>}><ResponsiveContainer width="100%" height="100%"><BarChart data={workload} margin={{top:8,right:12,left:-18,bottom:4}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line-soft)"/><XAxis dataKey="name" axisLine={false} tickLine={false}/><YAxis allowDecimals={false} axisLine={false} tickLine={false}/><Tooltip {...chartTooltipStyle}/><Legend verticalAlign="bottom" height={26} iconType="square" iconSize={9} wrapperStyle={{fontSize:'var(--text-xs)'}}/>{workloadSeries.map((series,index)=><Bar key={series.key} name={series.label} dataKey={series.key} stackId="a" fill={series.fill} radius={index===workloadSeries.length-1?[6,6,0,0]:undefined}/>)}</BarChart></ResponsiveContainer></ChartCard>
      </div>
      <div className="two-column"><Panel title="Funnel conversion" subtitle="Within the cohort submitted during this period, so it will not match the recorded-placement total above."><Table caption="Funnel conversion by unique candidate/job milestone" headers={['Milestone','Count','Conversion from submissions']}>{funnel.map((item)=><tr key={item.name}><td>{item.name}</td><td>{item.value}</td><td>{item.conversion==null?'—':`${item.conversion}%`}</td></tr>)}</Table></Panel><Panel title="Workload health"><div className="settings-list"><article className="finance-row"><span>Overdue tasks</span><strong className={overdueTasks.length?'overdue-text':''}>{overdueTasks.length}</strong></article><article className="finance-row"><span>Accepted offers</span><strong>{data.offers.filter((item)=>item.status==='accepted').length}</strong></article><article className="finance-row"><span>Completed placements</span><strong>{data.placements.filter(isCompletedPlacement).length}</strong></article></div></Panel></div>
      <Panel title="Consultant performance"><Table caption="Consultant performance for selected date range" headers={['Consultant','Active jobs','Submissions','Interviews','Offers','Placements',{label:'Fees',align:'right'},'Overdue tasks']}>{rows.map((row)=><tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.jobs}</td><td>{row.submissions}</td><td>{row.interviews}</td><td>{row.offers}</td><td>{row.placements}</td><td className="money">{formatMoney(row.fees,organization?.base_currency)}</td><td className={row.overdue?'overdue-text':''}>{row.overdue}</td></tr>)}</Table></Panel>
      {footnote}
      {drilldown}
    </Page>
  }

  /* Every other number in this scope is the consultant's own; this one used to count every accepted
   * offer in the organization, including offers that had already become placements. Attributed by
   * `created_by`, which is how buildConsultantRows attributes the offers and placements rendered
   * above it -- scoping by job ownership instead would make it disagree with the conversion rates it
   * sits under, on the same screen. */
  const placedCandidates=new Set(data.placements.filter((placement)=>placement.status!=='cancelled').map((placement)=>placement.job_candidate_id))
  const awaitingPlacement=data.offers.filter((offer)=>offer.status==='accepted'&&offer.created_by===user?.id&&!placedCandidates.has(offer.job_candidate_id))

  return <Page title={title} eyebrow="Performance" description={description} actions={actions}>
    {context}
    {!currentMember&&<EmptyState title="No membership found" description="Your user is not an active member of this workspace, so there is no activity to attribute."/>}
    <div className="kpi-grid">
      {tiles.map((tile)=><MetricTile key={tile.key} label={tile.label} value={mine[tile.key]}
        definition={tile.definition} metric={tile.metric} onOpen={openMetric}/>)}
      <MetricTile label="Fees · base currency" value={<CompactMoney value={mine.fees} currency={organization?.base_currency}/>}/>
      {/* Jobs owned counts open jobs, which the jobs list can show -- but only filtered by owner, and
        * the link below already goes there. A drawer repeating it would be a second answer to a
        * question one surface already owns. */}
      <MetricTile label="Jobs owned" value={mine.jobs}/>
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
    {footnote}
    {drilldown}
  </Page>
}
