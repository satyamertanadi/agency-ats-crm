import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ArrowRight,BriefcaseBusiness,CalendarClock,CircleDollarSign,ListTodo,Plus,Send,Users} from 'lucide-react'
import {Link} from 'react-router-dom'
import {useOrganization} from '../../app/OrganizationProvider'
import {useAuth} from '../../app/AuthProvider'
import {dashboardSummary,dismissSetupChecklist} from '../core/repository'
import {listTeamMembers} from '../core/commercialRepository'
import {ErrorState,LoadingState} from '../../shared/ui/States'
import {Page,Panel} from '../../shared/ui/Page'
import {formatDate,formatMoney} from '../../shared/lib/format'
import {SetupChecklist,buildSetupSteps} from './SetupChecklist'

export function DashboardPage(){
  const {organization}=useOrganization();const {user}=useAuth();const cache=useQueryClient()
  const query=useQuery({queryKey:['dashboard',organization?.id],enabled:Boolean(organization),queryFn:()=>dashboardSummary(organization!.id)})
  const steps=query.data?buildSetupSteps(query.data,`/app/${organization!.slug}`):[]
  const setupComplete=steps.length>0&&steps.every((step)=>step.done)
  const showSetup=Boolean(query.data)&&!setupComplete&&!query.data!.setupDismissedAt
  // Only fetched while the checklist is on screen, so a set-up workspace pays nothing for it.
  const team=useQuery({queryKey:['team',organization?.id],enabled:showSetup&&Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  const canDismiss=team.data?.find((member)=>member.user_id===user?.id)?.member_roles?.some((item)=>['owner','admin'].includes(item.roles?.role_key||''))??false
  const dismiss=useMutation({mutationFn:()=>dismissSetupChecklist(organization!.id),onSuccess:()=>cache.invalidateQueries({queryKey:['dashboard',organization?.id]})})
  if(query.isLoading)return <LoadingState label="Preparing today’s agency priorities…"/>
  if(query.error||!query.data)return <ErrorState error={query.error} retry={()=>void query.refetch()}/>
  const data=query.data;const base=`/app/${organization!.slug}`;const name=(user?.user_metadata.full_name as string|undefined)?.split(' ')[0]
  const feeByCurrency=data.placements.reduce<Record<string,number>>((sum,row)=>{const item=row as {placement_fee:number;currency:string};sum[item.currency]=(sum[item.currency]??0)+Number(item.placement_fee);return sum},{})
  return <Page title={name?`Good to see you, ${name}`:'Agency overview'} eyebrow={organization?.name} description="A focused view of delivery momentum, client commitments, and work requiring attention." className="dashboard-page">
    {/* An empty workspace has nothing to be on track about; claiming otherwise is the first thing a new owner reads. */}
    <section className={`dashboard-hero ${setupComplete?'':'dashboard-hero-setup'}`.trim()}><div><p className="eyebrow">{setupComplete?'Today’s operating brief':'Getting started'}</p>
      <h2>{!setupComplete?'Let’s get your agency set up':data.overdueTasks.length?`${data.overdueTasks.length} action${data.overdueTasks.length===1?' needs':'s need'} attention`:'Your agency is on track'}</h2>
      <p>{setupComplete?`${data.activeJobs} active vacancies · ${data.interviews} interviews in the next seven days · ${data.offers} offers in progress`:'Add a client, open a vacancy, and bring in your first candidates. Your numbers below fill in as you go.'}</p></div>
      <div className="dashboard-hero-actions">{setupComplete
        ?<><Link className="button button-bronze button-md" to={`${base}/candidates`}><Plus size={15}/>Add candidate</Link><Link className="button button-secondary button-md" to={`${base}/tasks`}>Review actions <ArrowRight size={14}/></Link></>
        :<Link className="button button-bronze button-md" to={`${base}/companies`}><Plus size={15}/>Add first client</Link>}</div></section>
    {showSetup&&<SetupChecklist steps={steps} onDismiss={canDismiss?()=>dismiss.mutate():undefined} dismissing={dismiss.isPending}/>}
    <div className={`kpi-grid ${setupComplete?'':'kpi-grid-muted'}`.trim()}><Kpi href={`${base}/jobs`} icon={<BriefcaseBusiness/>} label="Active vacancies" value={data.activeJobs}/><Kpi href={`${base}/candidates`} icon={<Users/>} label="Candidates" value={data.candidates}/><Kpi href={`${base}/tasks`} icon={<ListTodo/>} label="Overdue actions" value={data.overdueTasks.length} alert={data.overdueTasks.length>0}/><Kpi href={`${base}/delivery`} icon={<CalendarClock/>} label="Interviews / 7d" value={data.interviews}/><Kpi href={`${base}/delivery`} icon={<Send/>} label="Offers in progress" value={data.offers}/><Kpi href={`${base}/placements`} icon={<CircleDollarSign/>} label="Placement fees / YTD" value={Object.entries(feeByCurrency).map(([currency,value])=>formatMoney(value,currency)).join(' / ')||'—'}/></div>
    <div className="dashboard-grid"><Panel title="Priority actions" subtitle="Owned work now outside its due window." action={<Link className="record-link" to={`${base}/tasks`}>View all</Link>} elevation="raised"><div className="list">{data.overdueTasks.length===0?<div className="dashboard-clear"><span>✓</span><div><strong>Nothing overdue</strong><p>Consultant follow-ups are currently under control.</p></div></div>:data.overdueTasks.map((task)=><Link className="list-row clickable-row" to={`${base}/tasks`} key={task.id}><div><strong>{task.title}</strong><span>{task.priority} priority</span></div><time>{formatDate(task.due_at)}</time></Link>)}</div></Panel><Panel title="Recent activity" subtitle="Latest movement across recruitment and client work." elevation="raised"><div className="list">{data.activities.length===0?<div className="dashboard-clear"><span>·</span><div><strong>No recent activity</strong><p>Updates will appear here as the team works.</p></div></div>:data.activities.map((activity)=><article className="list-row" key={activity.id}><div><strong>{activity.subject||activity.activity_type}</strong><span>{activity.summary}</span></div><time>{formatDate(activity.occurred_at)}</time></article>)}</div></Panel></div>
  </Page>
}

function Kpi({icon,label,value,alert=false,href}:{icon:React.ReactNode;label:string;value:React.ReactNode;alert?:boolean;href:string}){return <Link to={href} className={`kpi clickable-row ${alert?'kpi-alert':''}`}><span>{icon}</span><div><p>{label}</p><strong>{value}</strong></div></Link>}
