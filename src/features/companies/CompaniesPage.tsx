import { useState } from 'react'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import type { z } from 'zod'
import { useOrganization } from '../../app/OrganizationProvider'
import { useAuth } from '../../app/AuthProvider'
import { companySchema } from '../core/schemas'
import { createCompany,listCompanies } from '../core/repository'
import { Button } from '../../shared/ui/Button'
import { Field,Input,Select } from '../../shared/ui/Field'
import { Modal } from '../../shared/ui/Modal'
import { Badge,Page,Panel } from '../../shared/ui/Page'
import { EmptyState,ErrorState,LoadingState } from '../../shared/ui/States'
import { Table } from '../../shared/ui/Table'

type FormData=z.infer<typeof companySchema>
export function CompaniesPage(){const {organization}=useOrganization();const {user}=useAuth();const cache=useQueryClient();const [open,setOpen]=useState(false);const query=useQuery({queryKey:['companies',organization?.id],enabled:Boolean(organization),queryFn:()=>listCompanies(organization!.id)});const form=useForm<FormData>({resolver:zodResolver(companySchema),defaultValues:{name:'',industry:'',location:'',website:'',account_status:'prospect'}});const mutation=useMutation({mutationFn:(data:FormData)=>createCompany(organization!.id,user!.id,data),onSuccess:async()=>{setOpen(false);form.reset();await cache.invalidateQueries({queryKey:['companies',organization?.id]})}});return <Page title="Companies" eyebrow="Client CRM" description="Prospects, active clients, commercial relationships, and delivery history." actions={<Button onClick={()=>setOpen(true)}><Plus size={15}/>Add company</Button>}><Panel>{query.isLoading?<LoadingState/>:query.error?<ErrorState error={query.error}/>:query.data?.length===0?<EmptyState title="No client companies" description="Create the first prospect or client account."/>:<Table headers={['Company','Industry','Location','BD stage','Account status','Last updated']}>{query.data?.map((company)=><tr key={company.id}><td><strong>{company.name}</strong><span>{company.website||'No website'}</span></td><td>{company.industry||'—'}</td><td>{company.location||'—'}</td><td>{company.business_development_stage}</td><td><Badge tone={company.account_status==='active_client'?'good':'neutral'}>{company.account_status.replace('_',' ')}</Badge></td><td>{new Date(company.updated_at).toLocaleDateString()}</td></tr>)}</Table>}</Panel><Modal title="Add client company" open={open} onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={form.handleSubmit((data)=>mutation.mutate(data))}><Field label="Company name" error={form.formState.errors.name?.message}><Input {...form.register('name')}/></Field><Field label="Industry"><Input {...form.register('industry')}/></Field><Field label="Location"><Input {...form.register('location')}/></Field><Field label="Website" error={form.formState.errors.website?.message}><Input type="url" {...form.register('website')}/></Field><Field label="Account status"><Select {...form.register('account_status')}><option value="prospect">Prospect</option><option value="active_client">Active client</option><option value="inactive">Inactive</option><option value="do_not_contact">Do not contact</option></Select></Field>{mutation.error&&<p className="form-error full" role="alert">{mutation.error.message}</p>}<div className="form-actions full"><Button type="button" variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={mutation.isPending}>Create company</Button></div></form></Modal></Page>}
