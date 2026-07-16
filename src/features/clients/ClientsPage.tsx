import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Building2,Plus,Search,UsersRound} from 'lucide-react'
import {Link,useNavigate} from 'react-router-dom'
import {useAuth} from '../../app/AuthProvider'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {createCompany,createContact,listCompanies,listContacts} from '../core/repository'
import {Button} from '../../shared/ui/Button'
import {Drawer} from '../../shared/ui/Drawer'
import {Field,Input,Select} from '../../shared/ui/Field'
import {Page,Panel,StatusBadge} from '../../shared/ui/Page'
import {accountStatus} from '../../shared/lib/status'
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/States'
import {Table} from '../../shared/ui/Table'
import {formatDate} from '../../shared/lib/format'
import {useOpenOnNewParam} from '../../shared/lib/useOpenOnNewParam'

export function ClientsPage(){
  const {organization}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const navigate=useNavigate()
  const [open,setOpen]=useState(false);const [query,setQuery]=useState('');const [name,setName]=useState('');const [status,setStatus]=useState('prospect');const [contactName,setContactName]=useState('');const [contactEmail,setContactEmail]=useState('')
  useOpenOnNewParam(setOpen)
  const companies=useQuery({queryKey:['companies',organization?.id],enabled:Boolean(organization),queryFn:()=>listCompanies(organization!.id)})
  const contacts=useQuery({queryKey:['contacts',organization?.id],enabled:Boolean(organization),queryFn:()=>listContacts(organization!.id)})
  const create=useMutation({mutationFn:async()=>{const companyId=await createCompany(organization!.id,user!.id,{name,account_status:status});if(contactName.trim())await createContact(organization!.id,user!.id,{company_id:companyId,full_name:contactName,email:contactEmail||undefined});return companyId},onSuccess:async(companyId)=>{setOpen(false);setName('');setContactName('');setContactEmail('');await Promise.all([cache.invalidateQueries({queryKey:['companies',organization?.id]}),cache.invalidateQueries({queryKey:['contacts',organization?.id]})]);navigate(`/app/${organization!.slug}/clients/${companyId}`)}})
  if(companies.isLoading||contacts.isLoading||capabilities.isLoading)return <LoadingState label="Opening clients…"/>
  if(companies.error||contacts.error)return <ErrorState error={companies.error||contacts.error}/>
  const needle=query.trim().toLowerCase();const visible=(companies.data||[]).filter((company)=>!needle||[company.name,company.industry,company.location].some((value)=>value?.toLowerCase().includes(needle)))
  const counts=new Map<string,number>();for(const contact of contacts.data||[])counts.set(contact.company_id,(counts.get(contact.company_id)||0)+1)
  return <Page title="Clients" eyebrow="Client relationships" description="Client accounts, decision-makers, jobs, and relationship history in one place." actions={capabilities.data?.canWriteClients?<Button leadingIcon={<Plus size={15}/>} onClick={()=>setOpen(true)}>Add client</Button>:undefined}>
    <Panel><div className="toolbar"><div className="search-box"><Search size={15}/><Input aria-label="Search clients" placeholder="Client, industry, or location" value={query} onChange={(event)=>setQuery(event.target.value)}/></div><span className="muted">{visible.length} clients</span></div>
      {visible.length===0?<EmptyState title={needle?'No matching clients':'No clients yet'} description={needle?'Try a different search.':'Create the first prospect or client account.'} action={!needle&&capabilities.data?.canWriteClients?<Button onClick={()=>setOpen(true)}>Add first client</Button>:undefined}/>:<Table caption="Client accounts" headers={['Client','Location','Contacts','Account status','Updated']}>
        {visible.map((client)=><tr key={client.id}><td><Link className="record-link" to={`/app/${organization?.slug}/clients/${client.id}`}><strong>{client.name}</strong></Link><span>{client.industry||'Industry not recorded'}</span></td><td>{client.location||'—'}</td><td><span className="inline-stat"><UsersRound size={14}/>{counts.get(client.id)||0}</span></td><td><StatusBadge map={accountStatus} value={client.account_status}/></td><td>{formatDate(client.updated_at)}</td></tr>)}
      </Table>}
    </Panel>
    <Drawer title="Add client" description="Start with the account and, if useful, its primary contact." open={open} onClose={()=>setOpen(false)}><div className="stack"><Field label="Client name"><Input autoFocus value={name} onChange={(event)=>setName(event.target.value)}/></Field><Field label="Account status"><Select value={status} onChange={(event)=>setStatus(event.target.value)}><option value="prospect">Prospect</option><option value="active_client">Active client</option></Select></Field><div className="progressive-section"><div><Building2 size={16}/><span><strong>Primary contact</strong><small>Optional — this can be added later.</small></span></div><Field label="Contact name"><Input value={contactName} onChange={(event)=>setContactName(event.target.value)}/></Field><Field label="Contact email"><Input type="email" value={contactEmail} onChange={(event)=>setContactEmail(event.target.value)}/></Field></div>{create.error&&<p className="form-error" role="alert">{create.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button loading={create.isPending} disabled={name.trim().length<2} onClick={()=>create.mutate()}>Create client</Button></div></div></Drawer>
  </Page>
}
