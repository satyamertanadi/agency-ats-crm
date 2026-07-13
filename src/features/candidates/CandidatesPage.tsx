import { useRef,useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { Download,Plus,Search,Upload } from 'lucide-react'
import type { z } from 'zod'
import { useOrganization } from '../../app/OrganizationProvider'
import { useAuth } from '../../app/AuthProvider'
import { createCandidate,listCandidates } from '../core/repository'
import { candidateSchema } from '../core/schemas'
import { candidatesToCsv,parseCandidateCsv } from '../imports/candidateCsv'
import { Button } from '../../shared/ui/Button'
import { Field,Input } from '../../shared/ui/Field'
import { Modal } from '../../shared/ui/Modal'
import { Badge,Page,Panel } from '../../shared/ui/Page'
import { EmptyState,ErrorState,LoadingState } from '../../shared/ui/States'
import { Table } from '../../shared/ui/Table'
import { formatMoney } from '../../shared/lib/format'

type FormInput=z.input<typeof candidateSchema>
type FormData=z.output<typeof candidateSchema>

export function CandidatesPage(){
  const {organization}=useOrganization();const {user}=useAuth();const client=useQueryClient();const inputRef=useRef<HTMLInputElement>(null)
  const [open,setOpen]=useState(false);const [search,setSearch]=useState('');const [importStatus,setImportStatus]=useState('')
  const query=useQuery({queryKey:['candidates',organization?.id,search],enabled:Boolean(organization),queryFn:()=>listCandidates(organization!.id,search)})
  const form=useForm<FormInput,unknown,FormData>({resolver:zodResolver(candidateSchema),defaultValues:{full_name:'',email:'',phone:'',current_company:'',current_position:'',location:'',source:'',salary_currency:organization?.base_currency||'USD'}})
  const mutation=useMutation({mutationFn:(data:FormData)=>createCandidate(organization!.id,user!.id,data),onSuccess:async()=>{setOpen(false);form.reset();await client.invalidateQueries({queryKey:['candidates',organization?.id]})}})
  const exportCsv=()=>{if(!query.data)return;const blob=new Blob([candidatesToCsv(query.data)],{type:'text/csv;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`candidates-${new Date().toISOString().slice(0,10)}.csv`;link.click();URL.revokeObjectURL(link.href)}
  const importCsv=async(file:File)=>{const rows=parseCandidateCsv(await file.text());let imported=0;const failures:string[]=[];for(const row of rows){if(row.errors.length){failures.push(`Row ${row.row}: ${row.errors.join(', ')}`);continue}try{await createCandidate(organization!.id,user!.id,row.data as FormData);imported++}catch(error){failures.push(`Row ${row.row}: ${error instanceof Error?error.message:'Import failed'}`)}}setImportStatus(`${imported} imported; ${failures.length} failed.${failures.length?` ${failures.slice(0,3).join(' | ')}`:''}`);await client.invalidateQueries({queryKey:['candidates',organization?.id]})}
  return <Page title="Candidates" eyebrow="Talent database" description="Search and manage people before or after a vacancy exists." actions={<><input ref={inputRef} hidden type="file" accept=".csv,text/csv" onChange={(event)=>{const file=event.target.files?.[0];if(file)void importCsv(file);event.target.value=''}}/><Button variant="secondary" onClick={()=>inputRef.current?.click()}><Upload size={15}/>Import CSV</Button><Button variant="secondary" onClick={exportCsv} disabled={!query.data?.length}><Download size={15}/>Export</Button><Button onClick={()=>setOpen(true)}><Plus size={15}/>Add candidate</Button></>}>
    <Panel>{importStatus&&<p className="success-box" role="status">{importStatus}</p>}<div className="toolbar"><div className="search-box"><Search size={15}/><Input aria-label="Search candidates" placeholder="Name, company, or position" value={search} onChange={(event)=>setSearch(event.target.value)}/></div></div>{query.isLoading?<LoadingState/>:query.error?<ErrorState error={query.error}/>:query.data?.length===0?<EmptyState title="No candidates found" description="Add a candidate or change the search."/>:<Table headers={['Candidate','Current role','Location','Contact','Expected salary','Status']}>{query.data?.map((candidate)=>{const privateData=Array.isArray(candidate.candidate_private_details)?candidate.candidate_private_details[0]:candidate.candidate_private_details;return <tr key={candidate.id}><td><strong>{candidate.full_name}</strong><span>{candidate.source||'Source not recorded'}</span></td><td>{candidate.current_position||'—'}<span>{candidate.current_company||''}</span></td><td>{candidate.location||'—'}</td><td>{privateData?.email||'—'}<span>{privateData?.phone||''}</span></td><td>{formatMoney(privateData?.expected_salary,privateData?.salary_currency||organization?.base_currency)}</td><td><Badge tone={candidate.status==='active'?'good':'neutral'}>{candidate.status}</Badge></td></tr>})}</Table>}</Panel>
    <Modal title="Add candidate" open={open} onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={form.handleSubmit((data)=>mutation.mutate(data))}><Field label="Full name" error={form.formState.errors.full_name?.message}><Input {...form.register('full_name')}/></Field><Field label="Email" error={form.formState.errors.email?.message}><Input type="email" {...form.register('email')}/></Field><Field label="Phone"><Input {...form.register('phone')}/></Field><Field label="Current company"><Input {...form.register('current_company')}/></Field><Field label="Current position"><Input {...form.register('current_position')}/></Field><Field label="Location"><Input {...form.register('location')}/></Field><Field label="Source"><Input {...form.register('source')}/></Field><Field label="Expected salary"><Input type="number" {...form.register('expected_salary')}/></Field>{mutation.error&&<p className="form-error full" role="alert">{mutation.error.message}</p>}<div className="form-actions full"><Button type="button" variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={mutation.isPending}>{mutation.isPending?'Saving…':'Create candidate'}</Button></div></form></Modal>
  </Page>
}
