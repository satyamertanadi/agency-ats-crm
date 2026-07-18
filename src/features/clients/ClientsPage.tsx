import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Building2,CalendarClock,Plus,Search,UsersRound} from 'lucide-react'
import {Link,useNavigate,useSearchParams} from 'react-router-dom'
import {useAuth} from '../../app/AuthProvider'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {createCompany,createContact,listContacts} from '../core/repository'
import {listCompanyPipeline} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {Drawer} from '../../shared/ui/Drawer'
import {Field,Input,Select} from '../../shared/ui/Field'
import {Badge,Page,Panel,StatusBadge} from '../../shared/ui/Page'
import {accountStatus} from '../../shared/lib/status'
import {formatMoney} from '../../shared/lib/format'
import {useToast} from '../../shared/ui/Toast'
import {BdBoard,BdRiskSummary} from './BdBoard'
import {bdStageLabel,bdSummary} from './bdPipeline'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {SavedViewBar} from '../core/SavedViewBar'
import {csvFilename,downloadCsv,toCsv} from '../../shared/lib/csv'
import {Table} from '../../shared/ui/Table'
import {formatDate} from '../../shared/lib/format'
import {useOpenOnNewParam} from '../../shared/lib/useOpenOnNewParam'

export function ClientsPage(){
  const {organization}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const navigate=useNavigate();const toast=useToast()
  const [open,setOpen]=useState(false);const [params,setParams]=useSearchParams()
  const view=params.get('view')==='board'?'board':'list';const query=params.get('q')||''
  const setParam=(key:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);setParams(next,{replace:true})}
  const setView=(next:'list'|'board')=>setParam('view',next==='board'?'board':'')
  const setQuery=(value:string)=>setParam('q',value)
  const [name,setName]=useState('');const [status,setStatus]=useState('prospect');const [contactName,setContactName]=useState('');const [contactEmail,setContactEmail]=useState('')
  useOpenOnNewParam(setOpen)
  // One aggregated query serves both views. The list used to load companies and contacts and count
  // in the browser, which is why it could not show open jobs, follow-ups, or commercial state at all.
  const companies=useQuery({queryKey:['company-pipeline',organization?.id],enabled:Boolean(organization),queryFn:()=>listCompanyPipeline(organization!.id)})
  const contacts=useQuery({queryKey:['contacts',organization?.id],enabled:Boolean(organization),queryFn:()=>listContacts(organization!.id)})
  const create=useMutation({mutationFn:async()=>{const companyId=await createCompany(organization!.id,user!.id,{name,account_status:status});if(contactName.trim())await createContact(organization!.id,user!.id,{company_id:companyId,full_name:contactName,email:contactEmail||undefined});return companyId},onSuccess:async(companyId)=>{const created=name.trim();setOpen(false);setName('');setContactName('');setContactEmail('');await Promise.all([cache.invalidateQueries({queryKey:['company-pipeline',organization?.id]}),cache.invalidateQueries({queryKey:['contacts',organization?.id]})]);navigate(`/app/${organization!.slug}/clients/${companyId}`);toast.success(`${created} was added.`)},onError:(error)=>toast.error(error,'The client was not created.')}) 
  const needle=query.trim().toLowerCase()
  const visibleRows=(companies.data||[]).filter((company)=>!needle||[company.name,company.industry,company.location].some((value)=>value?.toLowerCase().includes(needle)))
  // Declared before the loading/error guards: a hook after an early return changes hook order
  // between renders. It re-derives the filtered rows rather than closing over a later binding.
  const exportView=useMutation({
    mutationFn:async()=>visibleRows,
    onSuccess:(rows)=>{
      downloadCsv(csvFilename('clients'),toCsv(rows.map((row)=>({name:row.name,bd_stage:row.business_development_stage,account_status:row.account_status,owner:row.owner_name||'',industry:row.industry||'',location:row.location||'',contacts:row.contact_count,open_jobs:row.open_jobs,active_candidates:row.active_candidates,next_follow_up:row.next_follow_up_at||'',last_activity:row.last_activity_at||'',placements:row.placements,fee_agreement:row.terms_status,expected_open_fee:row.expected_open_fee}))))
      toast.success(`Exported ${rows.length} ${rows.length===1?'client':'clients'}.`)
    },
    onError:(error)=>toast.error(error,'Nothing was exported.'),
  })
  if(companies.isLoading||contacts.isLoading||capabilities.isLoading)return <TableSkeleton rows={7} columns={5} label="Opening clients…"/>
  if(companies.error||contacts.error)return <ErrorState error={companies.error||contacts.error}/>
  const visible=visibleRows
  const summary=bdSummary(visible,new Date())
  // Won accounts arrive at the job form with the client already chosen, so the guided step does not
  // re-ask for something the board already knows.
  const startJobForAccount=(companyId:string)=>navigate(`/app/${organization!.slug}/jobs?new=1&company=${companyId}`)
  return <Page title="Clients" eyebrow="Client relationships" description="Client accounts, decision-makers, jobs, and relationship history in one place." className="clients-page" actions={<div className="page-scope-actions">
    <div className="segmented-control" aria-label="Client view"><button className={view==='list'?'active':''} onClick={()=>setView('list')}>List</button><button className={view==='board'?'active':''} onClick={()=>setView('board')}>BD board</button></div>
    {capabilities.data?.canWriteClients&&<Button leadingIcon={<Plus size={15}/>} onClick={()=>setOpen(true)}>Add client</Button>}
  </div>}>
    <div className="kpi-grid bd-kpis">
      <article className="kpi"><div><p>Accounts in play</p><strong>{summary.active}</strong></div></article>
      <article className="kpi"><div><p>Won</p><strong>{summary.won}</strong></div></article>
      <article className="kpi"><div><p>Open jobs</p><strong>{summary.openJobs}</strong></div></article>
      <article className="kpi" title="Expected fee across open jobs at accounts still in play."><div><p>Pipeline value</p><strong>{formatMoney(summary.pipelineValue,organization?.base_currency)}</strong></div></article>
      <article className="kpi"><div><p>Need attention</p><strong className={summary.atRisk?'overdue-text':''}>{summary.atRisk}</strong></div></article>
    </div>
    <BdRiskSummary rows={visible}/>
    <Panel>
      <SavedViewBar resource="clients" paramKeys={['q','view']} params={params} onApply={(next)=>setParams(next,{replace:true})} onExport={()=>exportView.mutate()} exporting={exportView.isPending}/>
      <div className="toolbar"><div className="search-box"><Search size={15}/><Input aria-label="Search clients" placeholder="Client, industry, or location" value={query} onChange={(event)=>setQuery(event.target.value)}/></div><span className="muted">{visible.length} clients</span></div>
      {visible.length===0
        ?<EmptyState title={needle?'No matching clients':'No clients yet'} description={needle?'Try a different search.':'Create the first prospect or client account.'} action={!needle&&capabilities.data?.canWriteClients?<Button onClick={()=>setOpen(true)}>Add first client</Button>:undefined}/>
        :view==='list'
          ?<Table caption="Client accounts" headers={['Client','BD stage','Owner','Open jobs','Next follow-up','Fee agreement','Account status']}>
            {visible.map((client)=><tr key={client.id}>
              <td><Link className="record-link" to={`/app/${organization?.slug}/clients/${client.id}`}><strong>{client.name}</strong></Link><span>{client.industry||'Industry not recorded'}</span></td>
              <td>{bdStageLabel(client.business_development_stage)}</td>
              <td>{client.owner_name||<span className="overdue-text">Unassigned</span>}</td>
              <td><span className="inline-stat"><UsersRound size={14}/>{client.open_jobs}</span></td>
              <td>{client.next_follow_up_at?<span className={new Date(client.next_follow_up_at)<new Date()?'overdue-text':''}><CalendarClock size={13}/> {formatDate(client.next_follow_up_at)}</span>:<span className="muted">None set</span>}</td>
              <td>{client.terms_status==='active'?<Badge tone="good">In place</Badge>:client.terms_status==='expired'?<Badge tone="bad">Expired</Badge>:<Badge tone="warn">None</Badge>}</td>
              <td><StatusBadge map={accountStatus} value={client.account_status}/></td>
            </tr>)}
          </Table>
          :null}
    </Panel>
    {visible.length>0&&view==='board'&&<BdBoard rows={visible} canWrite={Boolean(capabilities.data?.canWriteClients)} onCreateJob={(row)=>startJobForAccount(row.id)}/>}
    <Drawer title="Add client" description="Start with the account and, if useful, its primary contact." open={open} onClose={()=>setOpen(false)}><div className="stack"><Field label="Client name"><Input autoFocus value={name} onChange={(event)=>setName(event.target.value)}/></Field><Field label="Account status"><Select value={status} onChange={(event)=>setStatus(event.target.value)}><option value="prospect">Prospect</option><option value="active_client">Active client</option></Select></Field><div className="progressive-section"><div><Building2 size={16}/><span><strong>Primary contact</strong><small>Optional — this can be added later.</small></span></div><Field label="Contact name"><Input value={contactName} onChange={(event)=>setContactName(event.target.value)}/></Field><Field label="Contact email"><Input type="email" value={contactEmail} onChange={(event)=>setContactEmail(event.target.value)}/></Field></div>{create.error&&<p className="form-error" role="alert">{create.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button loading={create.isPending} disabled={name.trim().length<2} onClick={()=>create.mutate()}>Create client</Button></div></div></Drawer>
  </Page>
}
