import {useState} from 'react'
import {useMutation,useQueryClient} from '@tanstack/react-query'
import {DndContext,PointerSensor,useDraggable,useDroppable,useSensor,useSensors,type DragEndEvent} from '@dnd-kit/core'
import {AlertTriangle,ArrowRight,BriefcaseBusiness,CalendarClock,Plus} from 'lucide-react'
import {Link} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {setCompanyBdStage} from '../core/commercialRepository'
import type {CompanyPipelineRow} from '../../shared/types/domain'
import {Badge,Panel} from '../../shared/ui/Page'
import {Select} from '../../shared/ui/Field'
import {formatDate,formatMoney} from '../../shared/lib/format'
import {useToast} from '../../shared/ui/Toast'
import {accountRisks,bdStageLabel,bdStages,groupCompaniesByStage,type BdColumn} from './bdPipeline'

function StageColumn({column,children}:{column:BdColumn;children:React.ReactNode}){
  const {setNodeRef,isOver}=useDroppable({id:column.key})
  return <section ref={setNodeRef} className={`kanban-column bd-column ${isOver?'kanban-over':''}`}>
    <header><strong>{column.label}</strong><span>{column.companies.length}</span></header>
    {column.companies.length>0&&<p className="bd-column-meta">{column.openJobs} open {column.openJobs===1?'job':'jobs'}{column.value>0&&<> · {formatMoney(column.value)}</>}</p>}
    {children}
  </section>
}

function AccountCard({row,now,canWrite,onMove,onCreateJob}:{row:CompanyPipelineRow;now:Date;canWrite:boolean;onMove:(stage:string)=>void;onCreateJob:()=>void}){
  const {organization}=useOrganization()
  const {attributes,listeners,setNodeRef,transform,isDragging}=useDraggable({id:row.id})
  const style=transform?{transform:`translate3d(${transform.x}px, ${transform.y}px, 0)`}:undefined
  const risks=accountRisks(row,now)
  const stages=[...bdStages.map((stage)=>stage.key),...(bdStages.some((stage)=>stage.key===row.business_development_stage)?[]:[row.business_development_stage])]
  return <article ref={setNodeRef} style={style} className={`candidate-card bd-card ${isDragging?'dragging':''}`} {...(canWrite?listeners:{})} {...attributes}>
    <Link className="bd-card-open" to={`/app/${organization?.slug}/clients/${row.id}`} onPointerDown={(event)=>event.stopPropagation()}>
      <strong>{row.name}</strong>
      <span>{row.owner_name||'No account owner'}</span>
    </Link>
    <p className="bd-card-stats">
      <span title="Open jobs"><BriefcaseBusiness size={13}/>{row.open_jobs}</span>
      {row.next_follow_up_at&&<span title="Next follow-up"><CalendarClock size={13}/>{formatDate(row.next_follow_up_at)}</span>}
      {row.expected_open_fee>0&&<span className="bd-card-value">{formatMoney(row.expected_open_fee,row.currency||undefined)}</span>}
    </p>
    {risks.length>0&&<p className="bd-card-risks">{risks.map((risk)=><Badge tone={risk.tone} key={risk.key}>{risk.label}</Badge>)}</p>}
    {/* The guided moment the plan asks for: a won account with nowhere to put a role is a dead end,
      * and the company is already known here, so the job form does not have to ask for it again. */}
    {row.business_development_stage==='won'&&row.open_jobs===0&&canWrite&&
      <button type="button" className="bd-card-cta" onPointerDown={(event)=>event.stopPropagation()} onClick={onCreateJob}><Plus size={13}/>Create the first job<ArrowRight size={13}/></button>}
    {canWrite&&<label onPointerDown={(event)=>event.stopPropagation()}>
      <span className="sr-only">Move {row.name} to another stage</span>
      <Select aria-label={`Move ${row.name}`} value={row.business_development_stage} onChange={(event)=>onMove(event.target.value)}>
        {stages.map((stage)=><option value={stage} key={stage}>{bdStageLabel(stage)}</option>)}
      </Select>
    </label>}
  </article>
}

export function BdBoard({rows,canWrite,onCreateJob}:{rows:CompanyPipelineRow[];canWrite:boolean;onCreateJob:(row:CompanyPipelineRow)=>void}){
  const {organization}=useOrganization();const cache=useQueryClient();const toast=useToast()
  const [now]=useState(()=>new Date())
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}))
  const columns=groupCompaniesByStage(rows)

  /* Same optimistic contract as the candidate board: the card moves now and reconciles after, with
   * the whole list snapshotted so a rejected move restores a board the user may have dragged twice. */
  const move=useMutation({
    mutationFn:({id,stage}:{id:string;stage:string;name:string})=>setCompanyBdStage(organization!.id,id,stage),
    onMutate:async({id,stage})=>{
      await cache.cancelQueries({queryKey:['company-pipeline',organization?.id]})
      const previous=cache.getQueryData<CompanyPipelineRow[]>(['company-pipeline',organization?.id])
      cache.setQueryData<CompanyPipelineRow[]>(['company-pipeline',organization?.id],(current)=>current?.map((row)=>row.id===id?{...row,business_development_stage:stage}:row))
      return {previous}
    },
    onError:(error,_variables,context)=>{
      if(context?.previous)cache.setQueryData(['company-pipeline',organization?.id],context.previous)
      toast.error(error,'The account was returned to its previous stage.')
    },
    onSuccess:(_data,{name,stage})=>toast.success(`${name} moved to ${bdStageLabel(stage)}.`),
    onSettled:()=>cache.invalidateQueries({queryKey:['company-pipeline',organization?.id]}),
  })

  const moveTo=(row:CompanyPipelineRow,stage:string)=>{if(stage!==row.business_development_stage)move.mutate({id:row.id,stage,name:row.name})}
  const onDragEnd=({active,over}:DragEndEvent)=>{
    if(!canWrite||!over)return
    const row=rows.find((item)=>item.id===String(active.id))
    if(row)moveTo(row,String(over.id))
  }

  return <Panel padding="sm">
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="kanban bd-board">
        {columns.map((column)=><StageColumn column={column} key={column.key}>
          {column.companies.map((row)=><AccountCard row={row} now={now} canWrite={canWrite} key={row.id}
            onMove={(stage)=>moveTo(row,stage)} onCreateJob={()=>onCreateJob(row)}/>)}
          {column.companies.length===0&&<p className="bd-column-empty">No accounts</p>}
        </StageColumn>)}
      </div>
    </DndContext>
  </Panel>
}

export function BdRiskSummary({rows}:{rows:CompanyPipelineRow[]}){
  const [now]=useState(()=>new Date())
  const flagged=rows.map((row)=>({row,risks:accountRisks(row,now)})).filter((entry)=>entry.risks.length>0)
  if(flagged.length===0)return null
  return <p className="bd-risk-banner"><AlertTriangle size={15}/><span><strong>{flagged.length} {flagged.length===1?'account needs':'accounts need'} attention</strong> — {[...new Set(flagged.flatMap((entry)=>entry.risks.map((risk)=>risk.label)))].join(' · ')}</span></p>
}
