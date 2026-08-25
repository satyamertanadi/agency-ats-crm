import {useMemo,useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Link} from 'react-router'
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
import {formatDateTime,formatMoney,formatMoneyCompact} from '../../shared/lib/format'
import {buildConsultantRows,buildRecruitmentFunnel,isCompletedPlacement,isOverdueTask,isRecordedPlacement,metricDefinitions,reportDateRange,shortNameLabels,type ConsultantRow} from './reportMetrics'

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

/* Every tile states its own definition. A scorecard whose numbers a consultant cannot interpret is
 * a scorecard they argue with rather than act on. */
const tiles=[
  {key:'submissions',label:'Submissions',definition:metricDefinitions.submission},
  {key:'interviews',label:'Interviews',definition:metricDefinitions.interview},
  {key:'offers',label:'Offers',definition:metricDefinitions.offer},
  {key:'placements',label:'Placements',definition:metricDefinitions.placement},
] as const

const rate=(numerator:number,denominator:number)=>denominator>0?`${Math.round(numerator/denominator*100)}%`:'—'

export function ScorecardPage(){
  const {organization,membership}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities()
  const now=useMemo(()=>new Date(),[])
  const [from,setFrom]=useState(dateValue(new Date(now.getFullYear(),0,1)));const [to,setTo]=useState(dateValue(now))
  const [scope,setScope]=useState<Scope>('mine')
  const range=reportDateRange(from,to,organization?.timezone||'UTC')
  const performance=useQuery({queryKey:['agency-performance',organization?.id,from,to],enabled:Boolean(organization&&from&&to),queryFn:()=>getAgencyPerformance(organization!.id,range.fromIso,range.toIso)})
  const team=useQuery({queryKey:['team',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  const currentMember=membership
  // Losing the capability mid-session (a role change landing in a refetch) must not strand the page
  // on a view the user may no longer see.
  const canViewTeam=Boolean(capabilities.data?.canViewTeamReports)
  const activeScope:Scope=canViewTeam?scope:'mine'

  const title=activeScope==='team'?'Team scorecard':'My scorecard'
  const description=activeScope==='team'
    ?'Agency funnel, workload, and consultant performance for the selected period.'
    :'Your own recruitment activity and outcomes, using the same definitions as the team view.'

  if(performance.isLoading||team.isLoading||capabilities.isLoading)return <Page title={title} eyebrow="Performance" description={description}><Panel><TableSkeleton rows={5} columns={4} label="Preparing the scorecard…"/></Panel></Page>
  if(performance.error||team.error)return <ErrorState error={performance.error||team.error}/>

  const data=performance.data!
  const overdueTasks=data.tasks.filter((item)=>isOverdueTask(item,now))
  const rows=buildConsultantRows({members:team.data||[],submissions:data.submissions,interviews:data.interviews,offers:data.offers,placements:data.placements,activeJobs:data.activeJobs,overdueTasks,baseCurrency:organization?.base_currency})
  const mine:ConsultantRow=rows.find((row)=>row.id===currentMember?.id)??{id:currentMember?.id||'me',name:user?.user_metadata.full_name as string||'You',jobs:0,submissions:0,interviews:0,offers:0,placements:0,fees:0,overdue:0}
  const base=`/app/${organization!.slug}`

  const scopeToggle=canViewTeam?<SegmentedControl label="Report scope" value={scope} onChange={setScope}
    options={[{id:'mine',label:'My scorecard'},{id:'team',label:'Team view'}]}/>:null
  const datePicker=<div className="date-range"><Field label="From"><Input type="date" value={from} max={to} onChange={(event)=>setFrom(event.target.value)}/></Field><Field label="To"><Input type="date" value={to} min={from} onChange={(event)=>setTo(event.target.value)}/></Field></div>
  const actions=<div className="page-scope-actions">{scopeToggle}{datePicker}</div>
  const context=<p className="report-context">Workspace timezone: <strong>{organization?.timezone}</strong> · Refreshed <time dateTime={now.toISOString()}>{formatDateTime(now.toISOString())}</time></p>
  const footnote=<p className="muted report-note">Counts use the definitions in the product metric contract and reconcile across both scopes for the same period. Fee totals include only recorded placements already denominated in {organization?.base_currency}; no exchange rate is invented.</p>

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
        <article className="kpi"><div><p>Jobs opened</p><strong>{data.jobs.length}</strong></div></article>
        <article className="kpi" title={metricDefinitions.submission}><div><p>Candidates submitted</p><strong>{funnel[0]!.value}</strong></div></article>
        <article className="kpi" title={metricDefinitions.interview}><div><p>Candidates interviewed</p><strong>{funnel[1]!.value}</strong></div></article>
        <article className="kpi" title={metricDefinitions.offer}><div><p>Candidates offered</p><strong>{funnel[2]!.value}</strong></div></article>
        <article className="kpi" title={metricDefinitions.recordedPlacement}><div><p>Recorded placements</p><strong>{recordedPlacementCount}</strong><small className="kpi-caption">{funnel[3]!.value} from this period&apos;s submissions</small></div></article>
        <article className="kpi"><div><p>Fees · base currency</p><strong><CompactMoney value={baseFees} currency={organization?.base_currency}/></strong></div></article>
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
      {tiles.map((tile)=><article className="kpi" key={tile.key} title={tile.definition}><div><p>{tile.label}</p><strong>{mine[tile.key]}</strong></div></article>)}
      <article className="kpi"><div><p>Fees · base currency</p><strong><CompactMoney value={mine.fees} currency={organization?.base_currency}/></strong></div></article>
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
    {footnote}
  </Page>
}
