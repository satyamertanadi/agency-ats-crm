import {useMemo,useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Bar,BarChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'
import {useOrganization} from '../../app/OrganizationProvider'
import {getAgencyPerformance,listTeamMembers} from '../core/commercialRepository'
import {Field,Input} from '../../shared/ui/Field'
import {Page,Panel} from '../../shared/ui/Page'
import {ErrorState,TableSkeleton} from '../../shared/ui/States'
import {Table} from '../../shared/ui/Table'
import {ChartCard,chartTooltipStyle} from '../../shared/ui/ChartCard'
import {formatDateTime,formatMoney} from '../../shared/lib/format'
import {buildConsultantRows,buildRecruitmentFunnel,isCompletedPlacement,isOverdueTask,isRecordedPlacement,metricDefinitions,reportDateRange} from './reportMetrics'

const dateValue=(date:Date)=>date.toISOString().slice(0,10)

export function ReportsPage(){
  const {organization}=useOrganization();const now=useMemo(()=>new Date(),[])
  const [from,setFrom]=useState(dateValue(new Date(now.getFullYear(),0,1)));const [to,setTo]=useState(dateValue(now))
  const range=reportDateRange(from,to,organization?.timezone||'UTC')
  const performance=useQuery({queryKey:['agency-performance',organization?.id,from,to],enabled:Boolean(organization&&from&&to),queryFn:()=>getAgencyPerformance(organization!.id,range.fromIso,range.toIso)})
  const team=useQuery({queryKey:['team',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  if(performance.isLoading||team.isLoading)return <Page title="Reports" eyebrow="Agency intelligence" description="Defensible candidate milestones, workload, and commercial outcomes for a selectable period."><Panel><TableSkeleton rows={6} columns={6} label="Preparing agency intelligence…"/></Panel></Page>
  if(performance.error||team.error)return <ErrorState error={performance.error||team.error}/>

  const data=performance.data!;const recordedPlacements=data.placements.filter(isRecordedPlacement);const recordedPlacementCount=new Set(recordedPlacements.map((item)=>item.job_candidate_id)).size
  const funnel=buildRecruitmentFunnel({submissions:data.submissions,interviews:data.interviews,offers:data.offers,placements:data.placements})
  const baseFees=recordedPlacements.filter((item)=>item.currency===organization?.base_currency).reduce((sum,item)=>sum+Number(item.placement_fee),0)
  const overdueTasks=data.tasks.filter((item)=>isOverdueTask(item,now))
  const rows=buildConsultantRows({members:team.data||[],submissions:data.submissions,interviews:data.interviews,offers:data.offers,placements:data.placements,activeJobs:data.activeJobs,overdueTasks,baseCurrency:organization?.base_currency})
  const workload=rows.map((row)=>({name:row.name.split(' ')[0],jobs:row.jobs,submissions:row.submissions,overdue:row.overdue}))

  return <Page title="Reports" eyebrow="Agency intelligence" description="Defensible candidate milestones, workload, and commercial outcomes for a selectable period." actions={<div className="date-range"><Field label="From"><Input type="date" value={from} max={to} onChange={(event)=>setFrom(event.target.value)}/></Field><Field label="To"><Input type="date" value={to} min={from} onChange={(event)=>setTo(event.target.value)}/></Field></div>}>
    <p className="report-context">Workspace timezone: <strong>{organization?.timezone}</strong> · Refreshed <time dateTime={now.toISOString()}>{formatDateTime(now.toISOString())}</time></p>
    <div className="kpi-grid"><article className="kpi"><div><p>Jobs opened</p><strong>{data.jobs.length}</strong></div></article><article className="kpi" title={metricDefinitions.submission}><div><p>Candidates submitted</p><strong>{funnel[0]!.value}</strong></div></article><article className="kpi" title={metricDefinitions.interview}><div><p>Candidates interviewed</p><strong>{funnel[1]!.value}</strong></div></article><article className="kpi" title={metricDefinitions.offer}><div><p>Candidates offered</p><strong>{funnel[2]!.value}</strong></div></article><article className="kpi" title={metricDefinitions.placement}><div><p>Recorded placements</p><strong>{recordedPlacementCount}</strong></div></article><article className="kpi"><div><p>Fees · base currency</p><strong>{formatMoney(baseFees,organization?.base_currency)}</strong></div></article></div>
    <div className="chart-grid">
      <ChartCard title="Recruitment funnel" description="Unique candidate/job milestones within the submitted cohort." summary={<table><caption>Recruitment funnel totals</caption><tbody>{funnel.map((item)=><tr key={item.name}><th>{item.name}</th><td>{item.value}</td></tr>)}</tbody></table>}><ResponsiveContainer width="100%" height="100%"><BarChart data={funnel} margin={{top:8,right:12,left:-18,bottom:4}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line-soft)"/><XAxis dataKey="name" axisLine={false} tickLine={false}/><YAxis allowDecimals={false} axisLine={false} tickLine={false}/><Tooltip {...chartTooltipStyle}/><Bar dataKey="value" fill="var(--color-accent)" radius={[7,7,0,0]} maxBarSize={58}/></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Consultant workload" description="Active vacancies, unique submissions, and overdue actions." summary={<table><caption>Consultant workload totals</caption><tbody>{rows.map((row)=><tr key={row.id}><th>{row.name}</th><td>{row.jobs} jobs, {row.submissions} submissions, {row.overdue} overdue</td></tr>)}</tbody></table>}><ResponsiveContainer width="100%" height="100%"><BarChart data={workload} margin={{top:8,right:12,left:-18,bottom:4}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line-soft)"/><XAxis dataKey="name" axisLine={false} tickLine={false}/><YAxis allowDecimals={false} axisLine={false} tickLine={false}/><Tooltip {...chartTooltipStyle}/><Bar dataKey="jobs" stackId="a" fill="var(--color-accent)"/><Bar dataKey="submissions" stackId="a" fill="var(--color-violet)"/><Bar dataKey="overdue" stackId="a" fill="var(--color-danger)" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></ChartCard>
    </div>
    <div className="two-column"><Panel title="Funnel conversion"><Table caption="Funnel conversion by unique candidate/job milestone" headers={['Milestone','Count','Conversion from submissions']}>{funnel.map((item)=><tr key={item.name}><td>{item.name}</td><td>{item.value}</td><td>{item.conversion==null?'—':`${item.conversion}%`}</td></tr>)}</Table></Panel><Panel title="Workload health"><div className="settings-list"><article className="finance-row"><span>Overdue tasks</span><strong className={overdueTasks.length?'overdue-text':''}>{overdueTasks.length}</strong></article><article className="finance-row"><span>Accepted offers</span><strong>{data.offers.filter((item)=>item.status==='accepted').length}</strong></article><article className="finance-row"><span>Completed placements</span><strong>{data.placements.filter(isCompletedPlacement).length}</strong></article></div></Panel></div>
    <Panel title="Consultant performance"><Table caption="Consultant performance for selected date range" headers={['Consultant','Active jobs','Submissions','Interviews','Offers','Placements',{label:'Fees',align:'right'},'Overdue tasks']}>{rows.map((row)=><tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.jobs}</td><td>{row.submissions}</td><td>{row.interviews}</td><td>{row.offers}</td><td>{row.placements}</td><td className="money">{formatMoney(row.fees,organization?.base_currency)}</td><td className={row.overdue?'overdue-text':''}>{row.overdue}</td></tr>)}</Table></Panel><p className="muted report-note">Counts use the definitions in the product metric contract. Fee totals include only recorded placements already denominated in {organization?.base_currency}; no exchange rate is invented.</p>
  </Page>
}
