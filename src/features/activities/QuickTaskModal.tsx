import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {useSearchParams} from 'react-router-dom'
import {useAuth} from '../../app/AuthProvider'
import {useOrganization} from '../../app/OrganizationProvider'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'
import {createTask} from '../core/repository'
import {listTeamMembers} from '../core/commercialRepository'

const dateValue=(days:number)=>{const date=new Date();date.setDate(date.getDate()+days);date.setHours(days===0?17:9,0,0,0);const local=new Date(date.getTime()-date.getTimezoneOffset()*60_000);return local.toISOString().slice(0,16)}

export function QuickTaskModal(){
  const {organization,memberships}=useOrganization();const {user}=useAuth();const cache=useQueryClient();const [params,setParams]=useSearchParams()
  const [title,setTitle]=useState('');const [description,setDescription]=useState('');const [dueAt,setDueAt]=useState(()=>dateValue(0));const [priority,setPriority]=useState('normal');const [ownerId,setOwnerId]=useState('')
  const open=params.get('task')==='1'&&Boolean(organization&&user);const linkType=params.get('linkType') as 'candidate'|'company'|'contact'|'job'|null;const linkId=params.get('linkId')
  const current=memberships.find((item)=>item.organization_id===organization?.id&&item.user_id===user?.id)
  const team=useQuery({queryKey:['team',organization?.id],enabled:open&&Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  const close=()=>{const next=new URLSearchParams(params);['task','linkType','linkId'].forEach((key)=>next.delete(key));setParams(next,{replace:true})}
  const mutation=useMutation({mutationFn:()=>createTask(organization!.id,user!.id,{title:title.trim(),description:description.trim()||undefined,priority,due_at:dueAt?new Date(dueAt).toISOString():undefined,owner_member_id:ownerId||current?.id,link:linkType&&linkId?{type:linkType,id:linkId}:undefined}),onSuccess:async()=>{setTitle('');setDescription('');setDueAt(dateValue(0));setPriority('normal');setOwnerId('');close();await Promise.all([cache.invalidateQueries({queryKey:['today',organization?.id]}),cache.invalidateQueries({queryKey:['tasks',organization?.id]})])}})
  return <Modal title="Add task" open={open} onClose={close}><form className="stack" onSubmit={(event)=>{event.preventDefault();mutation.mutate()}}>
    <Field label="What needs to happen?"><Input autoFocus value={title} onChange={(event)=>setTitle(event.target.value)} required/></Field>
    <Field label="Context (optional)"><Textarea rows={3} value={description} onChange={(event)=>setDescription(event.target.value)}/></Field>
    <div className="task-date-shortcuts" aria-label="Due date shortcuts">{[['Today',0],['Tomorrow',1],['In 3 days',3],['Next week',7]].map(([label,days])=><Button type="button" size="sm" variant="quiet" key={String(label)} onClick={()=>setDueAt(dateValue(Number(days)))}>{label}</Button>)}</div>
    <div className="form-grid"><Field label="Due"><Input type="datetime-local" value={dueAt} onChange={(event)=>setDueAt(event.target.value)}/></Field><Field label="Owner"><Select value={ownerId||current?.id||''} onChange={(event)=>setOwnerId(event.target.value)}><option value="">Unassigned</option>{team.data?.filter((member)=>member.status==='active').map((member)=><option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><Field label="Priority"><Select value={priority} onChange={(event)=>setPriority(event.target.value)}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></Select></Field></div>
    {linkType&&linkId&&<p className="muted">This task will stay linked to the current {linkType}.</p>}{mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}
    <div className="form-actions"><Button type="button" variant="quiet" onClick={close}>Cancel</Button><Button type="submit" loading={mutation.isPending} disabled={!title.trim()}>Create task</Button></div>
  </form></Modal>
}
