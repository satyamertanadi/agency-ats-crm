import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight,Plus } from 'lucide-react'
import type { z } from 'zod'
import { useOrganization } from '../../app/OrganizationProvider'
import { jobSchema } from '../core/schemas'
import { createJob,listCompanies,listJobs } from '../core/repository'
import { Button } from '../../shared/ui/Button'
import { Field,Input,Select } from '../../shared/ui/Field'
import { Modal } from '../../shared/ui/Modal'
import { Badge,Page,Panel } from '../../shared/ui/Page'
import { EmptyState,ErrorState,LoadingState } from '../../shared/ui/States'
import { Table } from '../../shared/ui/Table'

type FormData=z.infer<typeof jobSchema>
export function JobsPage(){const {organization}=useOrganization();const cache=useQueryClient();const [open,setOpen]=useState(false);const jobs=useQuery({queryKey:['jobs',organization?.id],enabled:Boolean(organization),queryFn:()=>listJobs(organization!.id)});const companies=useQuery({queryKey:['companies',organization?.id],enabled:Boolean(organization),queryFn:()=>listCompanies(organization!.id)});const form=useForm<FormData>({resolver:zodResolver(jobSchema),defaultValues:{company_id:'',title:''}});const mutation=useMutation({mutationFn:(data:FormData)=>createJob(organization!.id,data),onSuccess:async()=>{setOpen(false);form.reset();await cache.invalidateQueries({queryKey:['jobs',organization?.id]})}});return <Page title="Jobs" eyebrow="Vacancy delivery" description="Client vacancies with their own team, commercial context, and configurable pipeline." actions={<Button onClick={()=>setOpen(true)} disabled={!companies.data?.length}><Plus size={15}/>Create vacancy</Button>}><Panel>{jobs.isLoading?<LoadingState/>:jobs.error?<ErrorState error={jobs.error}/>:jobs.data?.length===0?<EmptyState title="No active vacancies" description="Create a client company, then open its first vacancy."/>:<Table headers={['Vacancy','Client','Location','Priority','Status','Pipeline']}>{jobs.data?.map((job)=><tr key={job.id}><td><strong>{job.title}</strong><span>Opened {job.opened_at?new Date(job.opened_at).toLocaleDateString():'—'}</span></td><td>{job.companies?.name||'—'}</td><td>{job.location||'—'}</td><td><Badge tone={job.priority==='urgent'?'bad':job.priority==='high'?'warn':'neutral'}>{job.priority}</Badge></td><td><Badge tone={job.status==='open'?'good':'neutral'}>{job.status}</Badge></td><td><Link className="button button-secondary" to={`/app/${organization?.slug}/jobs/${job.id}/pipeline`}>Open pipeline <ArrowRight size={14}/></Link></td></tr>)}</Table>}</Panel><Modal title="Create vacancy" open={open} onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={form.handleSubmit((data)=>mutation.mutate(data))}><Field label="Client company" error={form.formState.errors.company_id?.message}><Select {...form.register('company_id')}><option value="">Select company</option>{companies.data?.map((company)=><option value={company.id} key={company.id}>{company.name}</option>)}</Select></Field><Field label="Job title" error={form.formState.errors.title?.message}><Input {...form.register('title')}/></Field>{mutation.error&&<p className="form-error full" role="alert">{mutation.error.message}</p>}<div className="form-actions full"><Button type="button" variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={mutation.isPending}>Create with default pipeline</Button></div></form></Modal></Page>}
