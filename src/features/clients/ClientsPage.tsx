import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Building2,CalendarClock,Plus,Search,TriangleAlert} from 'lucide-react'
import {Link,useNavigate,useSearchParams} from 'react-router'
import {useAuth} from '../../app/AuthProvider'
import {useOrganization} from '../../app/OrganizationProvider'
import {prefetchHandlers,usePrefetchRecord} from '../core/usePrefetchRecord'
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
import {formatMoneyCompact} from '../../shared/lib/format'
import {NOT_RECORDED} from '../../shared/lib/labels'
import {URL_HINT,URL_INPUT_PATTERN} from '../../shared/lib/externalUrl'
import {useToast} from '../../shared/ui/Toast'
import {BdBoard,BdRiskSummary} from './BdBoard'
import {accountHealthFilters,bdStageLabel,bdSummary,filterAccountHealth,type AccountHealthFilter} from './bdPipeline'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {ViewMenu} from '../core/ViewMenu'
import {csvFilename,downloadCsv,toCsv} from '../../shared/lib/csv'
import {Table} from '../../shared/ui/Table'
import {formatDate} from '../../shared/lib/format'
import {useOpenOnNewParam} from '../../shared/lib/useOpenOnNewParam'

export function ClientsPage(){
  const {organization}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const navigate=useNavigate();const toast=useToast()
  const [open,setOpen]=useState(false);const [params,setParams]=useSearchParams()
  const prefetch=usePrefetchRecord()
  const view=params.get('view')==='board'?'board':'list';const query=params.get('q')||'';const industryFilter=params.get('industry')||''
  const healthFilter=(params.get('health') as AccountHealthFilter)||'all'
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
  /* One clock for the whole filter pass, so two rows cannot disagree about whether a follow-up is
   * overdue across a slow render -- the same rule the candidates table follows. */
  const healthNow=new Date()
  const visibleRows=filterAccountHealth((companies.data||[]).filter((company)=>
    (!needle||[company.name,company.industry,industryLabel(company.industry),company.location].some((value)=>value?.toLowerCase().includes(needle)))
    &&(!industryFilter||industryKey(company.industry)===industryFilter)),healthFilter,healthNow)
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
  if(companies.isLoading||contacts.isLoading||team.isLoading||capabilities.isLoading)return <Page title="Clients" eyebrow="Client relationships" className="clients-page"><Panel><TableSkeleton rows={7} columns={7} label="Opening clients…"/></Panel></Page>
  if(companies.error||contacts.error||team.error)return <ErrorState error={companies.error||contacts.error||team.error}/>
  const visible=visibleRows
  const summary=bdSummary(visible,healthNow)
  const pipelineValue=formatMoneyCompact(summary.pipelineValue,organization?.base_currency)
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
  return <Page title="Clients" eyebrow="Client relationships" className="clients-page" actions={<div className="page-scope-actions">
    <div className="segmented-control" aria-label="Client view"><button className={view==='list'?'active':''} onClick={()=>setView('list')}>List</button><button className={view==='board'?'active':''} onClick={()=>setView('board')}>BD board</button></div>
    {capabilities.data?.canWriteClients&&<Button leadingIcon={<Plus size={15}/>} onClick={()=>setOpen(true)}>Add client</Button>}
  </div>}>
    {/* Four figures, not five. "Won" was a fifth tile of equal size for a number that is a subset of
      * the first one -- so the strip spent a fifth of itself restating part of its own opening figure.
      * It is now the caption under "Accounts in play", where the relationship between the two is
      * visible rather than left to the reader.
      *
      * Pipeline value is abbreviated. "IDR 5,580,000,000" is sixteen characters in a ~160px cell: it
      * either wrapped onto two lines or forced the whole strip wider. formatMoneyCompact returns both
      * forms, so the cell reads "IDR 5.6B" and the exact figure is one hover away -- and, because the
      * title is on the value itself rather than the tile, it does not collide with the tile-level
      * `definition` tooltip that explains what the metric counts. */}
    <KpiGrid>
      <KpiTile label="Accounts in play" value={summary.active} icon={<Building2 size={18}/>}
        definition="Accounts at a stage still being worked: lead, qualifying, pitching, negotiating or won."
        caption={`${summary.won} won`}/>
      <KpiTile label="Open jobs" value={summary.openJobs} icon={<Search size={18}/>}/>
      <KpiTile label="Pipeline value" icon={<CalendarClock size={18}/>}
        definition="Expected fee across open jobs at accounts still in play."
        value={<span title={pipelineValue.full}>{pipelineValue.short}</span>}/>
      <KpiTile label="Need attention" value={summary.atRisk} tone={summary.atRisk?'alert':undefined} icon={<TriangleAlert size={18}/>}
        definition="Accounts still being worked that carry at least one open risk."/>
    </KpiGrid>
    <BdRiskSummary rows={visible}/>
    {/* The toolbar (search, industry filter, saved views) applies to both views -- `visible` already
      * feeds the board as well as the table. It used to sit inside a Panel that, in board view, ended
      * right after the toolbar with nothing below it: a hollow box immediately followed by BdBoard's
      * own panel. Paneling it only for the view that actually has table content under it removes that
      * dead box without losing the toolbar in board view. */}
    <Panel>
      <div className="toolbar">
        <ViewMenu resource="clients" baseLabel="All clients" paramKeys={['q','view','industry','health']} params={params}
          onApply={(next)=>setParams(next,{replace:true})} onExport={()=>exportView.mutate()} exporting={exportView.isPending}/>
        <div className="search-box"><Search size={15}/><Input aria-label="Search clients" placeholder="Client, industry, or location" value={query} onChange={(event)=>setQuery(event.target.value)}/></div>
        <Select aria-label="Filter by industry" value={industryFilter} onChange={(event)=>setIndustryFilter(event.target.value)}><option value="">All industries</option>{industryChoices.map((industry)=><option key={industry.key} value={industry.key}>{industry.label}</option>)}</Select>
        {/* Every option here is a question about accountRisks -- see filterAccountHealth -- so it
          * cannot drift from the risk badges on the rows it is filtering. */}
        <Select aria-label="Account health" value={healthFilter} onChange={(event)=>setParam('health',event.target.value==='all'?'':event.target.value)}>{accountHealthFilters.map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select>
        <span className="toolbar-count">{visible.length} {visible.length===1?'client':'clients'}</span>
      </div>
      {visible.length===0&&<EmptyState title={needle||industryFilter||healthFilter!=='all'?'No matching clients':'No clients yet'} description={needle||industryFilter||healthFilter!=='all'?'Try a different search, industry, or health filter.':'Create the first prospect or client account.'} action={!needle&&!industryFilter&&healthFilter==='all'&&capabilities.data?.canWriteClients?<Button onClick={()=>setOpen(true)}>Add first client</Button>:undefined}/>}
      {visible.length>0&&view==='list'&&<Table
        className="clients-table"
        caption="Client accounts"
        /* Five columns, allocated. The previous seven -- Client, BD stage, Owner, Open jobs,
         * Next follow-up, Fee agreement, Account status -- spent a column each on two single values
         * and two badges, and left the relationship owner and the next action, the two facts a
         * consultant opens this page for, sharing space with them at equal weight.
         *
         *   Client                name and industry.
         *   BD stage / owner      where the relationship is, and who is carrying it.
         *   Open jobs / value     the live work and what it is worth, right-aligned and tabular.
         *   Next action           the follow-up date, with overdue visibly distinct.
         *   Agreement / status    the two badges that gate commercial work, in one cell.
         */
        headers={[
          {label:'Client'},
          {label:'BD stage / owner',width:'190px'},
          {label:'Open jobs / value',width:'160px',align:'right'},
          {label:'Next action',width:'170px'},
          {label:'Agreement / status',width:'180px'},
        ]}>
            {visible.map((client)=>{
              const followUp=client.next_follow_up_at?new Date(client.next_follow_up_at):null
              const overdue=Boolean(followUp&&followUp<healthNow)
              const value=formatMoneyCompact(client.expected_open_fee,organization?.base_currency)
              return <tr key={client.id}>
                <td>
                  <Link className="record-link" to={`/app/${organization?.slug}/clients/${client.id}`} {...prefetchHandlers(()=>prefetch('client',client.id))}><strong>{client.name}</strong></Link>
                  <span>{industryLabel(client.industry)||NOT_RECORDED}</span>
                </td>
                {/* Sentence case, from bdStageLabel's own vocabulary -- the raw column is free text, so
                  * an imported "NEGOTIATING" or "negotiating" both resolve through the same map rather
                  * than being printed as stored. */}
                <td><strong>{bdStageLabel(client.business_development_stage)}</strong><span className={client.owner_name?'cell-sub':'cell-sub cell-gap'}>{client.owner_name||'Unassigned'}</span></td>
                <td className="money">
                  <strong>{client.open_jobs}</strong>
                  <span title={value.full}>{client.open_jobs===0?'No open jobs':value.short}</span>
                </td>
                {/* Overdue is the one state here that changes what someone does today, so it is the one
                  * that gets weight and colour. A future date is ordinary text. */}
                <td>{followUp
                  ?<><div className="cell-lead"><strong className={overdue?'cell-strong overdue-text':'cell-strong'}>{formatDate(client.next_follow_up_at)}</strong></div><span className="cell-sub">{overdue?'Follow-up overdue':'Follow-up booked'}</span></>
                  :<span className="cell-gap">No follow-up set</span>}</td>
                <td>
                  <span className="chip-row">
                    {client.terms_status==='active'?<Badge tone="good">Agreement in place</Badge>:client.terms_status==='expired'?<Badge tone="bad">Agreement expired</Badge>:<Badge tone="warn">No agreement</Badge>}
                    <StatusBadge map={accountStatus} value={client.account_status}/>
                  </span>
                </td>
              </tr>
            })}
          </Table>}
    </Panel>
    {visible.length>0&&view==='board'&&<BdBoard rows={visible} canWrite={Boolean(capabilities.data?.canWriteClients)} onCreateJob={(row)=>startJobForAccount(row.id)}/>}
    <Drawer title="Add client" description="Start with the account and, if useful, its primary contact." open={open} onClose={()=>setOpen(false)}><div className="stack"><Field label="Client name"><Input autoFocus value={name} onChange={(event)=>setName(event.target.value)}/></Field>{/* Rendered from the vocabulary map rather than hand-written options: this drawer offered two of the
        four statuses while the edit form offered all four, so "Inactive" was a state you could only
        reach by creating the client wrong first and then editing it. */}
      <Field label="Account status"><Select value={status} onChange={(event)=>setStatus(event.target.value)}>{Object.entries(accountStatus).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</Select></Field><div className="form-grid"><Field label="Industry"><OptionSelect label="Industry" options={industryOptions()} value={industry} onChange={setIndustry} placeholder="Select an industry"/></Field><LocationField value={location} onChange={setLocation}/>{/* company_size existed on the record and in the CSV importer but had no input on the create path at all, so it could only ever be filled by editing the client afterwards. */}<Field label="Company size"><OptionSelect label="Company size" options={companySize.options()} value={size} onChange={setSize} placeholder="Not recorded"/></Field><Field label="Website" hint={URL_HINT}><Input type="text" inputMode="url" pattern={URL_INPUT_PATTERN} title={URL_HINT} value={website} onChange={(event)=>setWebsite(event.target.value)}/></Field><Field label="Owner"><Select value={ownerMemberId} onChange={(event)=>setOwnerMemberId(event.target.value)}><option value="">Unassigned</option>{team.data?.filter((member)=>member.status==='active').map((member)=><option key={member.id} value={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field></div><details className="advanced-fields"><summary>Primary contact (optional)</summary><Field label="Contact name"><Input value={contactName} onChange={(event)=>setContactName(event.target.value)}/></Field><Field label="Contact email"><Input type="email" value={contactEmail} onChange={(event)=>setContactEmail(event.target.value)}/></Field><Field label="Contact phone"><Input value={contactPhone} onChange={(event)=>setContactPhone(event.target.value)}/></Field><Field label="Contact position"><Input value={contactPosition} onChange={(event)=>setContactPosition(event.target.value)}/></Field></details>{create.error&&<p className="form-error" role="alert">{create.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button loading={create.isPending} disabled={name.trim().length<2} onClick={()=>create.mutate()}>Create client</Button></div></div></Drawer>
  </Page>
}
