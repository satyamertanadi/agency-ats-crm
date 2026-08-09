import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {useSearchParams} from 'react-router'
import {useAuth} from '../../app/AuthProvider'
import {useOrganization} from '../../app/OrganizationProvider'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'
import {useToast} from '../../shared/ui/Toast'
import {createTask,listJobs} from '../core/repository'
import {listTeamMembers} from '../core/commercialRepository'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'

const dateValue=(days:number)=>{const date=new Date();date.setDate(date.getDate()+days);date.setHours(days===0?17:9,0,0,0);const local=new Date(date.getTime()-date.getTimezoneOffset()*60_000);return local.toISOString().slice(0,16)}

/* One task modal.
 *
 * There were two, with disjoint field sets and no relationship: this one on `?task=1`, reached from
 * the topbar and every record's Task button, carrying description, owner, priority and due shortcuts
 * but taking its record link from the URL; and Today's inline "Add follow-up" on `?action=task`, which
 * had a job picker and nothing else. Which fields a consultant got depended on which button they
 * happened to press, and neither modal could do what the other did.
 *
 * The union lives here. Both URLs open it, and the job picker appears exactly when the URL did not
 * already name a record -- opening this from a candidate's page and then being asked to pick a job
 * would be the merge undoing the context the entry point already had. */
export function QuickTaskModal(){
  const {organization,membership}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast();const [params,setParams]=useSearchParams()
  const [title,setTitle]=useState('');const [description,setDescription]=useState('');const [dueAt,setDueAt]=useState(()=>dateValue(0));const [priority,setPriority]=useState('normal');const [ownerId,setOwnerId]=useState('');const [jobId,setJobId]=useState('')
  const linkType=params.get('linkType') as 'candidate'|'company'|'contact'|'job'|null;const linkId=params.get('linkId')
  const open=(params.get('task')==='1'||params.get('action')==='task')&&Boolean(organization&&user)&&!capabilities.data?.readOnly
  const current=membership
  const team=useQuery({queryKey:['team',organization?.id],enabled:open&&Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  // Only fetched when there is a picker to fill. Opened from a record, the link is already decided.
  const pickJob=!linkType||!linkId
  const jobs=useQuery({queryKey:['jobs',organization?.id],enabled:open&&pickJob&&Boolean(organization),queryFn:()=>listJobs(organization!.id)})
  const close=()=>{const next=new URLSearchParams(params);['task','action','linkType','linkId'].forEach((key)=>next.delete(key));setParams(next,{replace:true})}
  const link=linkType&&linkId?{type:linkType,id:linkId}:jobId?{type:'job' as const,id:jobId}:undefined
  const mutation=useMutation({mutationFn:()=>createTask(organization!.id,user!.id,{title:title.trim(),description:description.trim()||undefined,priority,due_at:dueAt?new Date(dueAt).toISOString():undefined,owner_member_id:ownerId||current?.id,link}),onSuccess:async()=>{const created=title.trim();setTitle('');setDescription('');setDueAt(dateValue(0));setPriority('normal');setOwnerId('');setJobId('');close();await Promise.all([cache.invalidateQueries({queryKey:['today',organization?.id]}),cache.invalidateQueries({queryKey:['tasks',organization?.id]})]);toast.success(`Task added: ${created}`,'It appears in Today as soon as it is due.')},onError:(error)=>toast.error(error,'The task was not created.')})
  return <Modal title="Add task" open={open} onClose={close}><form className="stack" onSubmit={(event)=>{event.preventDefault();mutation.mutate()}}>
    <Field label="What needs to happen?"><Input autoFocus value={title} onChange={(event)=>setTitle(event.target.value)} required/></Field>
    <Field label="Context (optional)"><Textarea rows={3} value={description} onChange={(event)=>setDescription(event.target.value)}/></Field>
    <div className="task-date-shortcuts" aria-label="Due date shortcuts">{[['Today',0],['Tomorrow',1],['In 3 days',3],['Next week',7]].map(([label,days])=><Button type="button" size="sm" variant="quiet" key={String(label)} onClick={()=>setDueAt(dateValue(Number(days)))}>{label}</Button>)}</div>
    <div className="form-grid"><Field label="Due"><Input type="datetime-local" value={dueAt} onChange={(event)=>setDueAt(event.target.value)}/></Field><Field label="Owner"><Select value={ownerId||current?.id||''} onChange={(event)=>setOwnerId(event.target.value)}><option value="">Unassigned</option>{team.data?.filter((member)=>member.status==='active').map((member)=><option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><Field label="Priority"><Select value={priority} onChange={(event)=>setPriority(event.target.value)}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></Select></Field></div>
    {pickJob&&<Field label="Linked job (optional)"><Select value={jobId} onChange={(event)=>setJobId(event.target.value)}><option value="">No linked job</option>{jobs.data?.filter((job)=>job.status==='open').map((job)=><option value={job.id} key={job.id}>{job.title} · {job.companies?.name||'Client'}</option>)}</Select></Field>}
    {linkType&&linkId&&<p className="muted">This task will stay linked to the current {linkType}.</p>}{mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}
    <div className="form-actions"><Button type="button" variant="quiet" onClick={close}>Cancel</Button><Button type="submit" loading={mutation.isPending} disabled={!title.trim()}>Create task</Button></div>
  </form></Modal>
}
