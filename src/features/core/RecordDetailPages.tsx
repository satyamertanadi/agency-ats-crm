import {useState,type FormEvent} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Archive,ArrowLeft,MoreHorizontal,RotateCcw} from 'lucide-react'
import {Link,useParams} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {getCompanyDetail,getContactDetail,listTeamMembers,setCompanyBdStage,setRecordArchived,updateCompany,updateContact} from './commercialRepository'
import {listCompanies} from './repository'
import {withCurrentOption} from '../../shared/lib/referenceOptions'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {LocationField} from '../../shared/ui/LocationField'
import {OptionSelect} from '../../shared/ui/OptionSelect'
import {Page,Panel,StatusBadge} from '../../shared/ui/Page'
import {Menu} from '../../shared/ui/Menu'
import {ExternalLink} from '../../shared/ui/ExternalLink'
import {accountStatus,businessDevelopmentStage,contactStatus,jobPriority,jobStatus,lookup} from '../../shared/lib/status'
import {industryKey,industryLabel,industryOptions} from '../../shared/lib/industries'
import {companySize,decisionAuthority} from '../../shared/lib/optionSets'
import {ErrorState,LoadingState} from '../../shared/ui/States'
import {URL_HINT,URL_INPUT_PATTERN} from '../../shared/lib/externalUrl'
import {useToast} from '../../shared/ui/Toast'
import {ActivityFeed} from '../activities/ActivityFeed'
import {TaskButton} from '../activities/TaskButton'
import {CompanyCommercialTerms} from '../clients/CompanyCommercialTerms'

export function CompanyDetailPage(){
  const {companyId=''}=useParams();const {organization}=useOrganization();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast();const [editing,setEditing]=useState(false);const query=useQuery({queryKey:['company-detail',organization?.id,companyId],enabled:Boolean(organization&&companyId),queryFn:()=>getCompanyDetail(organization!.id,companyId)});const refresh=()=>Promise.all([cache.invalidateQueries({queryKey:['company-detail',organization?.id,companyId]}),cache.invalidateQueries({queryKey:['companies',organization?.id]}),cache.invalidateQueries({queryKey:['company-pipeline',organization?.id]})]);const save=useMutation({mutationFn:async(form:HTMLFormElement)=>{const data=new FormData(form);await updateCompany(organization!.id,companyId,{name:data.get('name'),industry:data.get('industry')||null,website:data.get('website')||null,location:data.get('location')||null,company_size:data.get('company_size')||null,account_status:data.get('account_status'),notes_summary:data.get('notes_summary')||null});
    /* BD stage goes through the RPC rather than riding along in the update above. The RPC is what
     * validates the vocabulary and writes the activity-feed entry that makes stage history auditable
     * -- this form bypassed both, which is how it could write 'proposal' when the board and the RPC
     * only ever understood 'pitching'. Only sent when it actually changed, so saving a typo fix does
     * not post "moved to Lead" into the client's history. */
    const stage=String(data.get('business_development_stage')||'');if(stage&&stage!==String(query.data?.business_development_stage||''))await setCompanyBdStage(organization!.id,companyId,stage)},onSuccess:async()=>{toast.success('Client saved.');setEditing(false);await refresh()},onError:(error)=>toast.error(error,'The client was not saved.')});const archive=useMutation({mutationFn:(value:boolean)=>setRecordArchived('companies',organization!.id,companyId,value),onSuccess:async(_result,archived)=>{toast.success(archived?'Client archived.':'Client restored.',archived?'It stays searchable and can be restored.':undefined);await refresh()},onError:(error,archived)=>toast.error(error,archived?'The client was not archived.':'The client was not restored.')});if(query.isLoading||capabilities.isLoading)return <LoadingState/>;if(query.error||!query.data)return <ErrorState error={query.error}/>;const company=query.data;const contacts=(company.contacts||[]) as Array<Record<string,unknown>>;const jobs=(company.jobs||[]) as Array<Record<string,unknown>>;return <Page title={String(company.name)} breadcrumbs={<Back to={`/app/${organization?.slug}/clients`}>Clients</Back>} metadata={<div className="record-metadata"><StatusBadge map={accountStatus} value={String(company.account_status)}/>{Boolean(company.location)&&<span>{String(company.location)}</span>}</div>} actions={<>{capabilities.data?.canWriteClients&&<>
      {/* Archive moved behind the overflow. It sat beside Edit at the same weight, so the two things
        * offered on a client record were "change it" and "take it out of circulation" -- one of which
        * is done constantly and one perhaps once in an account's life. It keeps its caution tone
        * inside the menu, so it is still visibly the consequential item. */}
      <Menu label="More client actions" items={[{id:'archive',
        label:company.deleted_at?'Restore client':'Archive client',
        icon:company.deleted_at?<RotateCcw size={15}/>:<Archive size={15}/>,
        tone:company.deleted_at?'default':'danger',
        onSelect:()=>archive.mutate(!company.deleted_at)}]} trigger={(props)=>
        <Button {...props} type="button" variant="secondary" iconOnlyLabel="More client actions" leadingIcon={<MoreHorizontal size={16}/>}/>}/>
      <Button onClick={()=>setEditing((value)=>!value)}>{editing?'Cancel edit':'Edit client'}</Button>
    </>}</>}>{editing?<form key={String(company.updated_at)} onSubmit={(event)=>submit(event,save.mutate)} className="stack"><Panel title="Edit client"><div className="form-grid"><Field label="Name"><Input name="name" defaultValue={String(company.name||'')} required/></Field><Field label="Industry"><OptionSelect name="industry" label="Industry" placeholder="Not recorded" defaultValue={industryKey(company.industry as string|null)} options={industryOptions(company.industry as string|null)}/></Field>{/* pattern rather than type="url" alone: a native url input rejects "acme.co.id" (no scheme), which
        is how most people write a website, and accepts anything with a colon in it -- including
        javascript:. The pattern mirrors externalUrl.ts, so what the form accepts is what the detail
        page will link. An EXISTING bad value is not blocked from being corrected: the field shows it,
        flags it, and only refuses on submit. */}
      <Field label="Website" hint={URL_HINT}><Input type="text" inputMode="url" name="website" pattern={URL_INPUT_PATTERN} title={URL_HINT} defaultValue={String(company.website||'')}/></Field><LocationFormField defaultValue={String(company.location||'')}/><Field label="Company size"><OptionSelect name="company_size" label="Company size" placeholder="Not recorded" defaultValue={companySize.key(company.company_size as string|null)} options={companySize.options(company.company_size as string|null)}/></Field><Field label="Account status"><Select name="account_status" defaultValue={String(company.account_status)}><option value="prospect">Prospect</option><option value="active_client">Active client</option><option value="inactive">Inactive</option><option value="do_not_contact">Do not contact</option></Select></Field><Field label="Business development stage"><Select name="business_development_stage" defaultValue={String(company.business_development_stage)}>{Object.entries(businessDevelopmentStage).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</Select></Field><Field label="Account notes"><Textarea name="notes_summary" defaultValue={String(company.notes_summary||'')}/></Field></div></Panel>{save.error&&<p className="form-error">{save.error.message}</p>}<div className="form-actions"><Button loading={save.isPending}>Save client</Button></div></form>:<Panel title="Client overview"><dl className="record-summary"><div><dt>Industry</dt><dd>{industryLabel(company.industry as string|null)||'Not recorded'}</dd></div><div><dt>Location</dt><dd>{String(company.location||'Not recorded')}</dd></div><div><dt>Business development</dt><dd><StatusBadge map={businessDevelopmentStage} value={String(company.business_development_stage||'lead')}/></dd></div><div><dt>Website</dt><dd><ExternalLink value={company.website as string|null}/></dd></div><div className="full"><dt>Account notes</dt><dd>{String(company.notes_summary||'No account notes yet.')}</dd></div></dl>
      {/* Commercial terms folded in as a second section rather than its own Panel -- both are facts
        * about this one account, not two separate records. */}
      <div className="panel-section-divider"/>
      <CompanyCommercialTerms organizationId={organization!.id} companyId={companyId} baseCurrency={organization!.base_currency} canEdit={Boolean(capabilities.data?.canManageCommercialTerms)}/>
    </Panel>}<div className="two-column"><Panel title="Contacts" action={capabilities.data?.canWriteClients&&<Link className="button button-secondary button-sm" to={`/app/${organization?.slug}/clients?new=1`}>Add contact</Link>}><div className="list">{contacts.map((contact)=><Link className="list-row" key={String(contact.id)} to={`/app/${organization?.slug}/clients/${companyId}/contacts/${contact.id}`}><div><strong>{String(contact.full_name)}</strong><span>{String(contact.position||contact.email||'')}</span></div><StatusBadge map={contactStatus} value={String(contact.contact_status)}/></Link>)}{contacts.length===0&&<p className="muted">No contacts yet.</p>}</div></Panel><Panel title="Jobs" action={capabilities.data?.canWriteJobs&&<Link className="button button-secondary button-sm" to={`/app/${organization?.slug}/jobs?new=1`}>Create job</Link>}><div className="list">{jobs.map((job)=><Link className="list-row" key={String(job.id)} to={`/app/${organization?.slug}/jobs/${job.id}`}><div><strong>{String(job.title)}</strong><span>{lookup(jobPriority,String(job.priority)).label} priority</span></div><StatusBadge map={jobStatus} value={String(job.status)}/></Link>)}{jobs.length===0&&<p className="muted">No jobs for this client.</p>}</div></Panel></div>
    {/* Add task moved into the panel header. As a direct child of the page grid it rendered as a
      * full-width bar between the two-column section and the history, which read as an empty section
      * whose only content was one button. */}
    <ActivityFeed links={[{company_id:companyId}]} title="Relationship history" subtitle="Calls, meetings, and client updates across this account." readOnly={!capabilities.data?.canWriteClients}
      headerAction={capabilities.data?.canWriteClients&&<TaskButton linkType="company" linkId={companyId}/>}/></Page>
}

export function ContactDetailPage(){
  const {contactId=''}=useParams();const {organization}=useOrganization();const cache=useQueryClient();const toast=useToast();const query=useQuery({queryKey:['contact-detail',organization?.id,contactId],enabled:Boolean(organization&&contactId),queryFn:()=>getContactDetail(organization!.id,contactId)});const companies=useQuery({queryKey:['companies',organization?.id],enabled:Boolean(organization),queryFn:()=>listCompanies(organization!.id)});const members=useQuery({queryKey:['members',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)});const refresh=()=>Promise.all([cache.invalidateQueries({queryKey:['contact-detail',organization?.id,contactId]}),cache.invalidateQueries({queryKey:['contacts',organization?.id]})]);const save=useMutation({mutationFn:(form:HTMLFormElement)=>{const data=new FormData(form);return updateContact(organization!.id,contactId,{company_id:data.get('company_id'),full_name:data.get('full_name'),position:data.get('position')||null,email:data.get('email')||null,phone:data.get('phone')||null,linkedin_url:data.get('linkedin_url')||null,contact_status:data.get('contact_status'),decision_authority:data.get('decision_authority')||null,relationship_owner_id:data.get('relationship_owner_id')||null})},onSuccess:async()=>{toast.success('Contact saved.');await refresh()},onError:(error)=>toast.error(error,'The contact was not saved.')});const archive=useMutation({mutationFn:(value:boolean)=>setRecordArchived('contacts',organization!.id,contactId,value),onSuccess:async(_result,archived)=>{toast.success(archived?'Contact archived.':'Contact restored.');await refresh()},onError:(error,archived)=>toast.error(error,archived?'The contact was not archived.':'The contact was not restored.')});if(query.isLoading||companies.isLoading||members.isLoading)return <LoadingState/>;if(query.error||companies.error||members.error||!query.data)return <ErrorState error={query.error||companies.error||members.error}/>;const contact=query.data;
  /* listCompanies is capped at 1,000 rows, so a contact whose client sits outside that page had NO
   * matching <option> -- and a select with no match silently selects the first one, so saving moved
   * the contact to a different client and said "Contact saved." The record already embeds its own
   * companies(id,name), so the true value is in hand without another query. */
  const clientOptions=withCurrentOption(companies.data,contact.companies as {id?:string|null;name?:string|null}|null);
  return <Page title={String(contact.full_name)} breadcrumbs={<Back to={`/app/${organization?.slug}/clients/${String(contact.company_id)}`}>Client</Back>} description={`Relationship at ${String((contact.companies as {name?:string}|null)?.name||'client')}.`} actions={<><Button variant={contact.deleted_at?'secondary':'caution'} onClick={()=>archive.mutate(!contact.deleted_at)}>{contact.deleted_at?<><RotateCcw size={14}/>Restore</>:<><Archive size={14}/>Archive</>}</Button></>}><form key={String(contact.updated_at)} onSubmit={(event)=>submit(event,save.mutate)} className="stack"><Panel title="Contact details"><div className="form-grid"><Field label="Full name"><Input name="full_name" defaultValue={String(contact.full_name)} required/></Field><Field label="Client"><Select name="company_id" defaultValue={String(contact.company_id)}>{clientOptions.map((company)=><option value={company.id} key={company.id}>{company.name}</option>)}</Select></Field><Field label="Position"><Input name="position" defaultValue={String(contact.position||'')}/></Field><Field label="Email"><Input type="email" name="email" defaultValue={String(contact.email||'')}/></Field><Field label="Phone"><Input name="phone" defaultValue={String(contact.phone||'')}/></Field><Field label="LinkedIn" hint={URL_HINT}><Input type="text" inputMode="url" name="linkedin_url" pattern={URL_INPUT_PATTERN} title={URL_HINT} defaultValue={String(contact.linkedin_url||'')}/></Field><Field label="Status"><Select name="contact_status" defaultValue={String(contact.contact_status)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="do_not_contact">Do not contact</option></Select></Field><Field label="Decision authority"><OptionSelect name="decision_authority" label="Decision authority" placeholder="Not recorded" defaultValue={decisionAuthority.key(contact.decision_authority as string|null)} options={decisionAuthority.options(contact.decision_authority as string|null)}/></Field><Field label="Relationship owner"><Select name="relationship_owner_id" defaultValue={String(contact.relationship_owner_id||'')}><option value="">Unassigned</option>{members.data?.filter((member)=>member.status==='active').map((member)=><option key={member.id} value={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field></div></Panel>{save.error&&<p className="form-error">{save.error.message}</p>}<div className="form-actions"><Button loading={save.isPending}>Save contact</Button></div></form>
    <TaskButton linkType="contact" linkId={contactId} label="Add follow-up"/><ActivityFeed links={[{contact_id:contactId}]} subtitle="Business development history for this contact. Records the reason behind the next follow-up."/></Page>
}

/* This form is a plain uncontrolled <form>, read via FormData on submit (see the save mutation
 * above) -- every other field gets that for free from its `name` attribute, but Combobox's input
 * carries no `name`, so LocationField's picked or typed value needs a controlled home of its own,
 * mirrored back into a hidden input FormData can still see. Its own `defaultValue`-shaped prop
 * means it re-initializes correctly both when this form remounts after a save (`key={updated_at}`
 * above) and when "Edit client" is toggled back on with newer data. */
function LocationFormField({defaultValue}:{defaultValue:string}){
  const [location,setLocation]=useState(defaultValue)
  return <>
    <LocationField value={location} onChange={setLocation}/>
    <input type="hidden" name="location" value={location}/>
  </>
}

function Back({to,children}:{to:string;children:React.ReactNode}){return <Link className="button button-quiet" to={to}><ArrowLeft size={14}/>{children}</Link>}
function submit(event:FormEvent<HTMLFormElement>,save:(form:HTMLFormElement)=>void){event.preventDefault();save(event.currentTarget)}
