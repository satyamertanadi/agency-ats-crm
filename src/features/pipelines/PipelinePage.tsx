import { useState,type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { DndContext,KeyboardSensor,PointerSensor,useDraggable,useDroppable,useSensor,useSensors,type DragEndEvent } from '@dnd-kit/core'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useOrganization } from '../../app/OrganizationProvider'
import { useAuth } from '../../app/AuthProvider'
import { addCandidateToJob,getPipeline,listCandidates,listJobs,moveCandidate } from '../core/repository'
import type { JobCandidate,PipelineStage } from '../../shared/types/domain'
import { Button } from '../../shared/ui/Button'
import { Field,Select } from '../../shared/ui/Field'
import { Modal } from '../../shared/ui/Modal'
import { Page,Panel } from '../../shared/ui/Page'
import { ErrorState,LoadingState } from '../../shared/ui/States'

function StageColumn({stage,count,children}:{stage:PipelineStage;count:number;children:ReactNode}){const {setNodeRef,isOver}=useDroppable({id:stage.id});return <section ref={setNodeRef} className={`kanban-column ${isOver?'kanban-over':''}`}><header><strong>{stage.name}</strong><span>{count}</span></header>{children}</section>}
function CandidateCard({item,stages,onMove}:{item:JobCandidate;stages:PipelineStage[];onMove:(stageId:string)=>void}){const {attributes,listeners,setNodeRef,transform,isDragging}=useDraggable({id:item.id});const style={transform:transform?`translate3d(${transform.x}px,${transform.y}px,0)`:undefined,opacity:isDragging?.55:1};return <article ref={setNodeRef} style={style} className="candidate-card" {...listeners} {...attributes}><strong>{item.candidates?.full_name}</strong><span>{item.candidates?.current_position||'Role not recorded'}</span><Field label="Move stage"><Select aria-label={`Move ${item.candidates?.full_name}`} value={item.current_stage_id} onPointerDown={(event)=>event.stopPropagation()} onChange={(event)=>onMove(event.target.value)}>{stages.map((option)=><option key={option.id} value={option.id}>{option.name}</option>)}</Select></Field></article>}

export function PipelinePage(){
  const {jobId}=useParams();const {organization}=useOrganization();const {user}=useAuth();const cache=useQueryClient();const [open,setOpen]=useState(false);const [candidateId,setCandidateId]=useState('')
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:5}}),useSensor(KeyboardSensor))
  const jobs=useQuery({queryKey:['jobs',organization?.id],enabled:Boolean(organization),queryFn:()=>listJobs(organization!.id)});const job=jobs.data?.find((item)=>item.id===jobId)
  const pipeline=useQuery({queryKey:['pipeline',jobId],enabled:Boolean(job),queryFn:()=>getPipeline(job!)});const candidates=useQuery({queryKey:['candidates',organization?.id,''],enabled:Boolean(organization),queryFn:()=>listCandidates(organization!.id)})
  const move=useMutation({mutationFn:({itemId,stageId}:{itemId:string;stageId:string})=>moveCandidate(itemId,stageId),onSuccess:()=>cache.invalidateQueries({queryKey:['pipeline',jobId]})})
  const add=useMutation({mutationFn:()=>addCandidateToJob(organization!.id,user!.id,job!,candidateId),onSuccess:async()=>{setOpen(false);setCandidateId('');await cache.invalidateQueries({queryKey:['pipeline',jobId]})}})
  const onDragEnd=(event:DragEndEvent)=>{const itemId=String(event.active.id);const stageId=event.over?.id?String(event.over.id):'';const current=pipeline.data?.items.find((item)=>item.id===itemId);if(stageId&&current?.current_stage_id!==stageId&&pipeline.data?.stages.some((stage)=>stage.id===stageId))move.mutate({itemId,stageId})}
  if(jobs.isLoading||pipeline.isLoading)return <LoadingState label="Loading vacancy pipeline…"/>;if(jobs.error||pipeline.error||!job)return <ErrorState error={jobs.error||pipeline.error||new Error('Vacancy not found')}/>
  return <Page title={job.title} eyebrow={job.companies?.name||'Vacancy pipeline'} description="Drag candidates or use the stage selector. Every movement is recorded in immutable stage history." actions={<Button onClick={()=>setOpen(true)}><Plus size={15}/>Add candidate</Button>}><Panel><DndContext sensors={sensors} onDragEnd={onDragEnd}><div className="kanban">{pipeline.data?.stages.map((stage)=>{const items=pipeline.data.items.filter((item)=>item.current_stage_id===stage.id);return <StageColumn stage={stage} count={items.length} key={stage.id}>{items.map((item)=><CandidateCard item={item} stages={pipeline.data.stages} key={item.id} onMove={(stageId)=>move.mutate({itemId:item.id,stageId})}/>)}</StageColumn>})}</div></DndContext></Panel><Modal title="Add candidate to vacancy" open={open} onClose={()=>setOpen(false)}><div className="stack"><Field label="Candidate"><Select value={candidateId} onChange={(event)=>setCandidateId(event.target.value)}><option value="">Select candidate</option>{candidates.data?.filter((candidate)=>!pipeline.data?.items.some((item)=>item.candidate_id===candidate.id)).map((candidate)=><option value={candidate.id} key={candidate.id}>{candidate.full_name}</option>)}</Select></Field>{add.error&&<p className="form-error" role="alert">{add.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={!candidateId||add.isPending} onClick={()=>add.mutate()}>Add to first stage</Button></div></div></Modal></Page>
}
