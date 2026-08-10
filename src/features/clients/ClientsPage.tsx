import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Building2,CalendarClock,Plus,Search,UsersRound} from 'lucide-react'
import {Link,useNavigate,useSearchParams} from 'react-router'
import {useAuth} from '../../app/AuthProvider'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {createCompany,createContact,listContacts} from '../core/repository'
import {listCompanyPipeline,listTeamMembers} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {Drawer} from '../../shared/ui/Drawer'
import {Field,Input,Select} from '../../shared/ui/Field'
import {LocationField} from '../../shared/ui/LocationField'
import {OptionSelect} from '../../shared/ui/OptionSelect'
import {Badge,Page,Panel,StatusBadge} from '../../shared/ui/Page'
import {KpiGrid,KpiTile} from '../../shared/ui/KpiTile'
import {accountStatus} from '../../shared/lib/status'
import {INDUSTRIES,industryKey,industryLabel,industryOptions} from '../../shared/lib/industries'
import {companySize} from '../../shared/lib/optionSets'
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
  const view=params.get('view')==='board'?'board':'list';const query=params.get('q')||'';const industryFilter=params.get('industry')||''
  const setParam=(key:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);setParams(next,{replace:true})}
  const setView=(next:'list'|'board')=>setParam('view',next==='board'?'board':'')
  const setQuery=(value:string)=>setParam('q',value)
  const setIndustryFilter=(value:string)=>setParam('industry',value)
  const [name,setName]=useState('');const [status,setStatus]=useState('prospect');const [contactName,setContactName]=useState('');const [contactEmail,setContactEmail]=useState('')
  const [industry,setIndustry]=useState('');const [size,setSize]=useState('');const [location,setLocation]=useState('');const [website,setWebsite]=useState('');const [ownerMemberId,setOwnerMemberId]=useState('');const [contactPhone,setContactPhone]=useState('');const [contactPosition,setContactPosition]=useState('')
  useOpenOnNewParam(setOpen)
  // One aggregated query serves both views. The list used to load companies and contacts and count
  // in the browser, which is why it could not show open jobs, follow-ups, or commercial state at all.
  const companies=useQuery({queryKey:['company-pipeline',organization?.id],enabled:Boolean(organization),queryFn:()=>listCompanyPipeline(organization!.id)})
  const contacts=useQuery({queryKey:['contacts',organization?.id],enabled:Boolean(organization),queryFn:()=>listContacts(organization!.id)})
  const team=useQuery({queryKey:['team',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  const create=useMutation({mutationFn:async()=>{const companyId=await createCompany(organization!.id,user!.id,{name,account_status:status,industry:industry||undefined,company_size:size||undefined,location:location||undefined,website:website||undefined,owner_member_id:ownerMemberId||undefined});if(contactName.trim())await createContact(organization!.id,user!.id,{company_id:companyId,full_name:contactName,email:contactEmail||undefined,phone:contactPhone||undefined,position:contactPosition||undefined});return companyId},onSuccess:async(companyId)=>{const created=name.trim();setOpen(false);setName('');setContactName('');setContactEmail('');setIndustry('');setSize('');setLocation('');setWebsite('');setOwnerMemberId('');setContactPhone('');setContactPosition('');await Promise.all([cache.invalidateQueries({queryKey:['company-pipeline',organization?.id]}),cache.invalidateQueries({queryKey:['contacts',organization?.id]})]);navigate(`/app/${organization!.slug}/clients/${companyId}`);toast.success(`${created} was added.`)},onError:(error)=>toast.error(error,'The client was not created.')})
  const needle=query.trim().toLowerCase()
  /* Search matches the label AND the raw column: once industries are stored as keys, typing "food &
   * beverage" has to find a row stored as `food_beverage` (the label side), and a legacy row still
   * typed "F&B" has to stay findable by what someone actually typed (the raw side). Matching only one
   * of the two loses a case that works today. industryKey() on the filter side does the same job in
   * reverse, so that legacy "F&B" row still groups under the option a consultant picks now. */
  const visibleRows=(companies.data||[]).filter((company)=>
    (!needle||[company.name,company.industry,industryLabel(company.industry),company.location].some((value)=>value?.toLowerCase().includes(needle)))
    &&(!industryFilter||industryKey(company.industry)===industryFilter))
  // Declared before the loading/error guards: a hook after an early return changes hook order
  // between renders. It re-derives the filtered rows rather than closing over a later binding.
  const exportView=useMutation({
    mutationFn:async()=>visibleRows,
    onSuccess:(rows)=>{
      downloadCsv(csvFilename('clients'),toCsv(rows.map((row)=>({name:row.name,bd_stage:row.business_development_stage,account_status:row.account_status,owner:row.owner_name||'',industry:industryLabel(row.industry),location:row.location||'',contacts:row.contact_count,open_jobs:row.open_jobs,active_candidates:row.active_candidates,next_follow_up:row.next_follow_up_at||'',last_activity:row.last_activity_at||'',placements:row.placements,fee_agreement:row.terms_status,expected_open_fee:row.expected_open_fee}))))
      toast.success(`Exported ${rows.length} ${rows.length===1?'client':'clients'}.`)
    },
    onError:(error)=>toast.error(error,'Nothing was exported.'),
  })
  if(companies.isLoading||contacts.isLoading||team.isLoading||capabilities.isLoading)return <Page title="Clients" eyebrow="Client relationships" description="Client accounts, decision-makers, jobs, and relationship history in one place." className="clients-page"><Panel><TableSkeleton rows={7} columns={7} label="Opening clients…"/></Panel></Page>
  if(companies.error||contacts.error||team.error)return <ErrorState error={companies.error||contacts.error||team.error}/>
  const visible=visibleRows
  const summary=bdSummary(visible,new Date())
  /* Offer only the industries this workspace actually has -- a filter listing twenty empty buckets
   * teaches people to ignore it. Derived from companies.data and never from visibleRows, or choosing
   * a value would empty the very list it was chosen from. Curated sectors keep their canonical order;
   * anything unrecognised (legacy text, or an "Other" someone typed) is appended alphabetically so it
   * is still reachable. In-memory because list_company_pipeline returns every row -- the day that
   * paginates this silently becomes "filter the current page" and has to move server-side. */
  const presentKeys=new Set((companies.data||[]).map((row)=>industryKey(row.industry)).filter(Boolean))
  const industryChoices=[
    ...INDUSTRIES.filter((industry)=>presentKeys.has(industry.key)),
    ...[...presentKeys].filter((key)=>!INDUSTRIES.some((industry)=>industry.key===key)).sort().map((key)=>({key,label:industryLabel(key)})),
  ]
  // Won accounts arrive at the job form with the client already chosen, so the guided step does not
  // re-ask for something the board already knows.
  const startJobForAccount=(companyId:string)=>navigate(`/app/${organization!.slug}/jobs?new=1&company=${companyId}`)
  return <Page title="Clients" eyebrow="Client relationships" description="Client accounts, decision-makers, jobs, and relationship history in one place." className="clients-page" actions={<div className="page-scope-actions">
    <div className="segmented-control" aria-label="Client view"><button className={view==='list'?'active':''} onClick={()=>setView('list')}>List</button><button className={view==='board'?'active':''} onClick={()=>setView('board')}>BD board</button></div>
    {capabilities.data?.canWriteClients&&<Button leadingIcon={<Plus size={15}/>} onClick={()=>setOpen(true)}>Add client</Button>}
  </div>}>
    <KpiGrid>
      <KpiTile label="Accounts in play" value={summary.active} icon={<Building2 size={18}/>}/>
      <KpiTile label="Won" value={summary.won} icon={<UsersRound size={18}/>}/>
      <KpiTile label="Open jobs" value={summary.openJobs} icon={<Search size={18}/>}/>
      <KpiTile label="Pipeline value" value={formatMoney(summary.pipelineValue,organization?.base_currency)} icon={<CalendarClock size={18}/>} definition="Expected fee across open jobs at accounts still in play."/>
      <KpiTile label="Need attention" value={summary.atRisk} tone={summary.atRisk?'alert':undefined} icon={<Plus size={18}/>}/>
    </KpiGrid>
    <BdRiskSummary rows={visible}/>
    {/* The toolbar (search, industry filter, saved views) applies to both views -- `visible` already
      * feeds the board as well as the table. It used to sit inside a Panel that, in board view, ended
      * right after the toolbar with nothing below it: a hollow box immediately followed by BdBoard's
      * own panel. Paneling it only for the view that actually has table content under it removes that
      * dead box without losing the toolbar in board view. */}
    <Panel>
      <SavedViewBar resource="clients" paramKeys={['q','view','industry']} params={params} onApply={(next)=>setParams(next,{replace:true})} onExport={()=>exportView.mutate()} exporting={exportView.isPending}/>
      <div className="toolbar"><div className="search-box"><Search size={15}/><Input aria-label="Search clients" placeholder="Client, industry, or location" value={query} onChange={(event)=>setQuery(event.target.value)}/></div><Select aria-label="Filter by industry" value={industryFilter} onChange={(event)=>setIndustryFilter(event.target.value)}><option value="">All industries</option>{industryChoices.map((industry)=><option key={industry.key} value={industry.key}>{industry.label}</option>)}</Select><span className="muted">{visible.length} clients</span></div>
      {visible.length===0&&<EmptyState title={needle||industryFilter?'No matching clients':'No clients yet'} description={needle||industryFilter?'Try a different search or industry.':'Create the first prospect or client account.'} action={!needle&&!industryFilter&&capabilities.data?.canWriteClients?<Button onClick={()=>setOpen(true)}>Add first client</Button>:undefined}/>}
      {visible.length>0&&view==='list'&&<Table className="clients-table" caption="Client accounts" headers={['Client','BD stage','Owner','Open jobs','Next follow-up','Fee agreement','Account status']}>
            {visible.map((client)=><tr key={client.id}>
              <td><Link className="record-link" to={`/app/${organization?.slug}/clients/${client.id}`}><strong>{client.name}</strong></Link><span>{industryLabel(client.industry)||'Industry not recorded'}</span></td>
              <td>{bdStageLabel(client.business_development_stage)}</td>
              <td>{client.owner_name||<span className="overdue-text">Unassigned</span>}</td>
              <td><span className="inline-stat"><UsersRound size={14}/>{client.open_jobs}</span></td>
              <td>{client.next_follow_up_at?<span className={new Date(client.next_follow_up_at)<new Date()?'overdue-text':''}><CalendarClock size={13}/> {formatDate(client.next_follow_up_at)}</span>:<span className="muted">None set</span>}</td>
              <td>{client.terms_status==='active'?<Badge tone="good">In place</Badge>:client.terms_status==='expired'?<Badge tone="bad">Expired</Badge>:<Badge tone="warn">None</Badge>}</td>
              <td><StatusBadge map={accountStatus} value={client.account_status}/></td>
            </tr>)}
          </Table>}
    </Panel>
    {visible.length>0&&view==='board'&&<BdBoard rows={visible} canWrite={Boolean(capabilities.data?.canWriteClients)} onCreateJob={(row)=>startJobForAccount(row.id)}/>}
    <Drawer title="Add client" description="Start with the account and, if useful, its primary contact." open={open} onClose={()=>setOpen(false)}><div className="stack"><Field label="Client name"><Input autoFocus value={name} onChange={(event)=>setName(event.target.value)}/></Field>{/* Rendered from the vocabulary map rather than hand-written options: this drawer offered two of the
        four statuses while the edit form offered all four, so "Inactive" was a state you could only
        reach by creating the client wrong first and then editing it. */}
      <Field label="Account status"><Select value={status} onChange={(event)=>setStatus(event.target.value)}>{Object.entries(accountStatus).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</Select></Field><div className="form-grid"><Field label="Industry"><OptionSelect label="Industry" options={industryOptions()} value={industry} onChange={setIndustry} placeholder="Select an industry"/></Field><LocationField value={location} onChange={setLocation}/>{/* company_size existed on the record and in the CSV importer but had no input on the create path at all, so it could only ever be filled by editing the client afterwards. */}<Field label="Company size"><OptionSelect label="Company size" options={companySize.options()} value={size} onChange={setSize} placeholder="Not recorded"/></Field><Field label="Website"><Input type="url" value={website} onChange={(event)=>setWebsite(event.target.value)}/></Field><Field label="Owner"><Select value={ownerMemberId} onChange={(event)=>setOwnerMemberId(event.target.value)}><option value="">Unassigned</option>{team.data?.filter((member)=>member.status==='active').map((member)=><option key={member.id} value={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field></div><div className="progressive-section"><div><Building2 size={16}/><span><strong>Primary contact</strong></span></div><Field label="Contact name"><Input value={contactName} onChange={(event)=>setContactName(event.target.value)}/></Field><Field label="Contact email"><Input type="email" value={contactEmail} onChange={(event)=>setContactEmail(event.target.value)}/></Field><Field label="Contact phone"><Input value={contactPhone} onChange={(event)=>setContactPhone(event.target.value)}/></Field><Field label="Contact position"><Input value={contactPosition} onChange={(event)=>setContactPosition(event.target.value)}/></Field></div>{create.error&&<p className="form-error" role="alert">{create.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button loading={create.isPending} disabled={name.trim().length<2} onClick={()=>create.mutate()}>Create client</Button></div></div></Drawer>
  </Page>
}
