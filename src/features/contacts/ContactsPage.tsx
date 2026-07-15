import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {useForm} from 'react-hook-form'
import {zodResolver} from '@hookform/resolvers/zod'
import {Plus} from 'lucide-react'
import type {z} from 'zod'
import {Link} from 'react-router-dom'
import {useOrganization} from '../../app/OrganizationProvider'
import {useAuth} from '../../app/AuthProvider'
import {contactSchema} from '../core/schemas'
import {createContact,listCompanies,listContacts} from '../core/repository'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select} from '../../shared/ui/Field'
import {Drawer} from '../../shared/ui/Drawer'
import {Badge,Page,Panel} from '../../shared/ui/Page'
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/States'
import {Table} from '../../shared/ui/Table'
import {formatDate} from '../../shared/lib/format'

type FormData=z.infer<typeof contactSchema>

export function ContactsPage(){
  const {organization}=useOrganization();const {user}=useAuth();const cache=useQueryClient();const [open,setOpen]=useState(false)
  const contacts=useQuery({queryKey:['contacts',organization?.id],enabled:Boolean(organization),queryFn:()=>listContacts(organization!.id)})
  const companies=useQuery({queryKey:['companies',organization?.id],enabled:Boolean(organization),queryFn:()=>listCompanies(organization!.id)})
  const form=useForm<FormData>({resolver:zodResolver(contactSchema),defaultValues:{company_id:'',full_name:'',position:'',email:'',phone:''}})
  const mutation=useMutation({mutationFn:(data:FormData)=>createContact(organization!.id,user!.id,data),onSuccess:async()=>{setOpen(false);form.reset();await cache.invalidateQueries({queryKey:['contacts',organization?.id]})}})
  return <Page title="Contacts" eyebrow="Relationships" description="Hiring managers, decision-makers, and business-development relationships." actions={<Button leadingIcon={<Plus size={15}/>} onClick={()=>setOpen(true)} disabled={!companies.data?.length}>Add contact</Button>}>
    <Panel>{contacts.isLoading?<LoadingState/>:contacts.error?<ErrorState error={contacts.error}/>:contacts.data?.length===0?<EmptyState title="No contacts" description="Add a company first, then its hiring contacts." action={companies.data?.length?<Button onClick={()=>setOpen(true)}>Add first contact</Button>:undefined}/>:<Table caption="Client contacts and follow-up status" headers={['Contact','Company','Position','Email','Status','Next follow-up']}>{contacts.data?.map((contact)=><tr key={contact.id}><td><Link className="record-link" to={`/app/${organization?.slug}/contacts/${contact.id}`}><strong>{contact.full_name}</strong></Link><span>{contact.phone||'No phone'}</span></td><td>{contact.companies?.name||'—'}</td><td>{contact.position||'—'}</td><td>{contact.email||'—'}</td><td><Badge>{contact.contact_status}</Badge></td><td>{formatDate(contact.next_follow_up_at)}</td></tr>)}</Table>}</Panel>
    <Drawer title="Add client contact" description="Capture a decision-maker or relationship against an existing client company." open={open} onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={form.handleSubmit((data)=>mutation.mutate(data))}><Field label="Company" error={form.formState.errors.company_id?.message}><Select autoFocus {...form.register('company_id')}><option value="">Select company</option>{companies.data?.map((company)=><option key={company.id} value={company.id}>{company.name}</option>)}</Select></Field><Field label="Full name" error={form.formState.errors.full_name?.message}><Input {...form.register('full_name')}/></Field><Field label="Position"><Input {...form.register('position')}/></Field><Field label="Email" error={form.formState.errors.email?.message}><Input type="email" {...form.register('email')}/></Field><Field label="Phone"><Input {...form.register('phone')}/></Field>{mutation.error&&<p className="form-error full" role="alert">{mutation.error.message}</p>}<div className="form-actions full"><Button type="button" variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button loading={mutation.isPending}>Create contact</Button></div></form></Drawer>
  </Page>
}
