import {useRef,useState} from 'react'
import {DndContext,PointerSensor,useDraggable,useDroppable,useSensor,useSensors,type DragEndEvent} from '@dnd-kit/core'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ArrowLeft,Clock,GripVertical,Info,Layers3,Plus} from 'lucide-react'
import {Link,useParams,useSearchParams} from 'react-router-dom'
import {useAuth} from '../../app/AuthProvider'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {addCandidateToJob,getPipeline,listCandidatesPage,listInterviews,listJobHealth,listJobs,listOffers,listPlacements,listSubmissionPackages} from '../core/repository'
import {useStageMove} from '../core/useStageMove'
import {listTeamMembers,updateJob} from '../core/commercialRepository'
import type {Job,JobCandidate,JobHealth,PipelineStage,TeamMember} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'
import {Page,Panel,StatusBadge} from '../../shared/ui/Page'
import {jobPriority,jobStatus,lookup} from '../../shared/lib/status'
import {BoardSkeleton,ErrorState} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'
import {ActivityFeed} from '../activities/ActivityFeed'
import {buildPipelineColumns,columnStageStats,daysInStage,isOutcomeStage,jobNeedsCandidateAction,phaseForStage,phaseRampColor,pipelinePhases,resolveStageForColumn,slaTargetDays,stageUrgency,type PipelineColumn} from '../workflow/workflow'
import {JobCandidatePanel} from './JobCandidatePanel'
import {CandidateCardMenu} from './CandidateCardMenu'
import {OutcomePrompt} from './OutcomePrompt'
import {OutcomesDrawer} from './OutcomesDrawer'
import {PhaseJump} from './PhaseJump'
import {TaskButton} from '../activities/TaskButton'
import {formatMoney} from '../../shared/lib/format'

type WorkspaceView='pipeline'|'activity'|'details'
type Density='compact'|'roomy'

const memberInitials=(member?:Pick<TeamMember,'profiles'>|null)=>{
  const name=member?.profiles?.full_name||member?.profiles?.email||''
  return name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()||'').join('')||'—'
}

function PhaseColumn({id,label,count,color,stats,children}:{id:string;label:string;count:number;color:string;stats:{avgDays:number;overTarget:number}|null;children:React.ReactNode}){
  const {setNodeRef,isOver}=useDroppable({id})
  return <section ref={setNodeRef} data-phase-key={id} className={`kanban-column workflow-column ${isOver?'kanban-over':''}`}>
    <div className="workflow-column-bar" style={{background:color}}/>
    <header><strong>{label}</strong><span>{count}</span></header>
    <p className="workflow-column-stats">{stats?`avg ${stats.avgDays}d · ${stats.overTarget?`${stats.overTarget} over target`:'on target'}`:'No candidates'}</p>
    {children}
  </section>
}

/* `columnKey` is the key of the column this card is rendered inside, handed down rather than
 * re-derived here. That is deliberate: deriving it twice is exactly how the board came to show a
 * candidate under Interview whose dropdown read "Sourcing". */
function CandidateCard({item,columnKey,columnColor,now,members,onOpen,onMove,onOutcome,outcomeStages,targets,canMove}:{item:JobCandidate;columnKey:string;columnColor:string;now:Date;members:TeamMember[];onOpen:()=>void;onMove:(columnKey:string)=>void;onOutcome:(stage:PipelineStage)=>void;outcomeStages:PipelineStage[];targets:Array<{key:string;label:string}>;canMove:boolean}){
  const {attributes,listeners,setNodeRef,transform,isDragging}=useDraggable({id:item.id,data:{stageId:item.current_stage_id}})
  const style={borderLeftColor:columnColor,...(transform?{transform:`translate3d(${transform.x}px, ${transform.y}px, 0)`}:{})}
  const name=item.candidates?.full_name||'Candidate'
  const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()||'').join('')||'?'
  const days=item.pipeline_stages?daysInStage(item,now):0
  const targetDays=item.pipeline_stages?slaTargetDays[phaseForStage(item.pipeline_stages)]??7:7
  const urgency=stageUrgency(days,targetDays)
  const owner=members.find((member)=>member.id===item.candidates?.owner_member_id)
  return <article ref={setNodeRef} style={style} className={`candidate-card workflow-candidate-card ${isDragging?'dragging':''}`} {...(canMove?listeners:{})} {...attributes}>
    <button className="candidate-card-open" onPointerDown={(event)=>event.stopPropagation()} onClick={onOpen}>
      <span className="workflow-card-top">
        <span className="workflow-card-avatar" aria-hidden="true">{initials}</span>
        <strong>{name}</strong>
        <GripVertical size={13} className="workflow-card-grip" aria-hidden="true"/>
      </span>
      <span className="workflow-card-role">{item.candidates?.current_position||'Role not recorded'}{item.candidates?.current_company?` · ${item.candidates.current_company}`:''}</span>
      <span className="workflow-card-bottom">
        <span className={`workflow-days-badge tone-${urgency}`}><Clock size={10}/>{days}d</span>
        <span className="workflow-card-owner" aria-hidden="true">{memberInitials(owner)}</span>
      </span>
    </button>
    {canMove&&<label onPointerDown={(event)=>event.stopPropagation()}><span className="sr-only">Move {name}</span><Select aria-label={`Move ${name}`} value={columnKey} onChange={(event)=>onMove(event.target.value)}>{targets.map((target)=><option value={target.key} key={target.key}>{target.label}</option>)}</Select></label>}
    {/* The keyboard-reachable route to an outcome. The stage dropdown beside it only offers active
      * columns, so before this the only way to reject someone was the drawer's move form. */}
    {canMove&&outcomeStages.length>0&&<CandidateCardMenu candidateName={name} outcomeStages={outcomeStages} onOpen={onOpen} onOutcome={onOutcome}/>}
  </article>
}

export function JobWorkspacePage(){
  const {jobId=''}=useParams();const {organization,memberships}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast();const boardRef=useRef<HTMLDivElement>(null);const [params,setParams]=useSearchParams();const [addOpen,setAddOpen]=useState(false);const [candidateId,setCandidateId]=useState('');const [detailed,setDetailed]=useState(false);const [editOpen,setEditOpen]=useState(false);const [density,setDensity]=useState<Density>('compact');const [outcomesOpen,setOutcomesOpen]=useState(false);const [outcome,setOutcome]=useState<{item:JobCandidate;stage:PipelineStage}|null>(null)
  const jobs=useQuery({queryKey:['jobs',organization?.id],enabled:Boolean(organization),queryFn:()=>listJobs(organization!.id)});const job=jobs.data?.find((item)=>item.id===jobId)
  const pipeline=useQuery({queryKey:['pipeline',jobId],enabled:Boolean(job),queryFn:()=>getPipeline(job!)});const candidates=useQuery({queryKey:['job-add-candidates',organization?.id],enabled:Boolean(organization&&addOpen),queryFn:()=>listCandidatesPage(organization!.id,{},0,100)});const health=useQuery({queryKey:['job-health',organization?.id],enabled:Boolean(organization),queryFn:()=>listJobHealth(organization!.id)})
  const interviews=useQuery({queryKey:['interviews',organization?.id],enabled:Boolean(organization),queryFn:()=>listInterviews(organization!.id)});const offers=useQuery({queryKey:['offers',organization?.id],enabled:Boolean(organization),queryFn:()=>listOffers(organization!.id)});const placements=useQuery({queryKey:['placements',organization?.id],enabled:Boolean(organization),queryFn:()=>listPlacements(organization!.id)});const packages=useQuery({queryKey:['submissions',organization?.id],enabled:Boolean(organization),queryFn:()=>listSubmissionPackages(organization!.id)});const members=useQuery({queryKey:['members',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  const refresh=()=>Promise.all([cache.invalidateQueries({queryKey:['pipeline',jobId]}),cache.invalidateQueries({queryKey:['jobs',organization?.id]}),cache.invalidateQueries({queryKey:['today',organization?.id]})])
  const add=useMutation({mutationFn:()=>addCandidateToJob(organization!.id,user!.id,job!,candidateId),onSuccess:async()=>{const name=candidates.data?.rows.find((row)=>row.id===candidateId)?.full_name;setAddOpen(false);setCandidateId('');await refresh();toast.success(`${name||'Candidate'} was added to ${job!.title}.`)},onError:(error)=>toast.error(error,'No candidate was added.')})
  const move=useStageMove(jobId,refresh)
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}));const canRecruit=job?.status==='open'&&Boolean(capabilities.data?.canMovePipeline)
  // The board is the thing worth holding space for: it is the tallest, slowest part of this screen
  // and the one whose arrival used to shove the whole page down.
  if(jobs.isLoading||pipeline.isLoading||interviews.isLoading||offers.isLoading||placements.isLoading||packages.isLoading||members.isLoading||capabilities.isLoading)return <Panel padding="sm"><BoardSkeleton label="Opening job workspace…"/></Panel>
  if(jobs.error||pipeline.error||interviews.error||offers.error||placements.error||packages.error||members.error||!job)return <ErrorState error={jobs.error||pipeline.error||interviews.error||offers.error||placements.error||packages.error||members.error||new Error('Job not found')}/>
  const view=(params.get('view') as WorkspaceView)||'pipeline';const selected=pipeline.data!.items.find((item)=>item.id===params.get('candidate'))||null;const outcomeStages=pipeline.data!.stages.filter(isOutcomeStage)
  const columns=buildPipelineColumns(pipeline.data!.stages,detailed)
  const targets=columns.map((column)=>({key:column.key,label:column.label}))
  // Placed reads as a terminal outcome, same register as Rejected/Withdrawn/On hold, so it moves to
  // the counter row rather than sitting as a seventh draggable column. `targets` above stays
  // unfiltered so "Placed" remains a valid move destination in each card's stage dropdown.
  const boardColumns=columns.filter((column)=>!column.stages.every((stage)=>stage.stage_type==='placed'))
  const placedCount=pipeline.data!.items.filter((item)=>item.pipeline_stages?.stage_type==='placed').length
  const now=new Date()
  const urgencyLegend=pipelinePhases.filter((phase)=>phase.key!=='placed').map((phase)=>`${phase.label} ${slaTargetDays[phase.key]}d`).join(' · ')
  const moveToColumn=(item:JobCandidate,columnKey:string)=>{const stageId=resolveStageForColumn(columns,columnKey,item.current_stage_id);if(stageId)move.mutate({itemId:item.id,stageId,name:item.candidates?.full_name,label:columns.find((column)=>column.key===columnKey)?.label||'the next phase'})}
  /* Reinstating lands on the first active stage of the board rather than the stage they were closed
   * from: that stage is often deep in the pipeline and putting someone straight back into, say,
   * Offer because that is where they were rejected would assert progress nobody has re-made. */
  const reinstateStage=columns.find((column)=>column.stages.some((stage)=>stage.stage_type==='active'))?.stages[0]??null
  const confirmOutcome=(note:string)=>{
    if(!outcome)return
    move.mutate({itemId:outcome.item.id,stageId:outcome.stage.id,name:outcome.item.candidates?.full_name,
      label:outcome.stage.name,note,source:'outcome',
      undo:{stageId:outcome.item.current_stage_id,label:pipeline.data!.stages.find((stage)=>stage.id===outcome.item.current_stage_id)?.name||'their previous stage'}})
    setOutcome(null)
  }
  // Drops resolve through the same model as the dropdown, so a drag cannot land a candidate somewhere
  // the card would then contradict -- and dropping back into the column you came from is a no-op.
  const onDragEnd=({active,over}:DragEndEvent)=>{if(!canRecruit||!over)return;const item=pipeline.data!.items.find((candidate)=>candidate.id===String(active.id));if(item)moveToColumn(item,String(over.id))}
  const next=jobNeedsCandidateAction(pipeline.data!.items);const currentMember=memberships.find((item)=>item.organization_id===organization?.id&&item.user_id===user?.id)
  const setView=(nextView:WorkspaceView)=>{const nextParams=new URLSearchParams(params);nextParams.set('view',nextView);nextParams.delete('candidate');nextParams.delete('action');setParams(nextParams)}
  const openCandidate=(item:JobCandidate)=>{const nextParams=new URLSearchParams(params);nextParams.set('candidate',item.id);nextParams.delete('action');setParams(nextParams)}
  const jobHealth=health.data?.find((item)=>item.id===jobId)
  return <Page title={job.title} eyebrow={job.companies?.name||'Client job'} description="Pipeline, client review, interviews, offers, and placement in one workspace." metadata={<div className="record-metadata"><StatusBadge map={jobStatus} value={job.status}/><StatusBadge map={jobPriority} value={job.priority}/>{job.location&&<span>{job.location}</span>}{jobHealth&&<span>{jobHealth.days_open} days open · {formatMoney(jobHealth.expected_fee,jobHealth.currency)} fee</span>}</div>} actions={<><Link className="button button-quiet" to={`/app/${organization!.slug}/jobs`}><ArrowLeft size={14}/>Jobs</Link><TaskButton linkType="job" linkId={jobId}/>{next&&canRecruit&&<Button leadingIcon={<Plus size={14}/>} onClick={()=>setAddOpen(true)}>{next.label}</Button>}</>} tabs={<nav className="record-tabs" aria-label="Job workspace views"><button className={view==='pipeline'?'active':''} onClick={()=>setView('pipeline')}>Pipeline</button><button className={view==='activity'?'active':''} onClick={()=>setView('activity')}>Activity</button><button className={view==='details'?'active':''} onClick={()=>setView('details')}>Details</button></nav>}>
    {job.status!=='open'&&<p className="warning-box">This job is {lookup(jobStatus,job.status).label.toLowerCase()}. Recruitment actions are read-only until it is reopened.</p>}
    {view==='pipeline'&&<>
      <div className="workflow-toolbar">
        <div><strong>{pipeline.data!.items.length} in pipeline</strong><span>Move candidates between phases, then open a card for the next action.</span></div>
        <div className="table-actions">
          {/* The counts were the only trace a closed candidate left -- a number with nothing behind
            * it. They are buttons now, because "3 rejected" invites exactly one question and the
            * drawer is the answer to it. Placed stays inert: a placement is reached through the
            * candidate's own card, not reinstated from here. */}
          {(outcomeStages.length>0||placedCount>0)&&<div className="outcome-summary">
            {outcomeStages.map((stage)=>{const count=pipeline.data!.items.filter((item)=>item.current_stage_id===stage.id).length
              return <button type="button" className="outcome-chip" key={stage.id} disabled={count===0} onClick={()=>setOutcomesOpen(true)}>{stage.name} <strong>{count}</strong></button>})}
            {placedCount>0&&<span className="outcome-chip outcome-chip-good">Placed <strong>{placedCount}</strong></span>}
          </div>}
          <div className="segmented-control" role="group" aria-label="Card density"><button type="button" className={density==='compact'?'active':''} onClick={()=>setDensity('compact')}>Compact</button><button type="button" className={density==='roomy'?'active':''} onClick={()=>setDensity('roomy')}>Roomy</button></div>
          <label className="detail-toggle"><input type="checkbox" checked={detailed} onChange={(event)=>setDetailed(event.target.checked)}/><Layers3 size={15}/>Detailed stages</label>
          {canRecruit&&<Button variant="secondary" leadingIcon={<Plus size={14}/>} onClick={()=>setAddOpen(true)}>Add candidates</Button>}
        </div>
      </div>
      <p className="workflow-urgency-note"><Info size={12}/>Urgency is days in the current stage against that stage's target — {urgencyLegend}.</p>
      <Panel padding="sm">
        <PhaseJump containerRef={boardRef} columns={boardColumns.map((column)=>({key:column.key,label:column.label,count:pipeline.data!.items.filter((item)=>column.stages.some((stage)=>stage.id===item.current_stage_id)).length}))}/>
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div ref={boardRef} className={`kanban workflow-kanban workflow-kanban-${density} ${detailed?'workflow-kanban-detailed':''}`} style={{'--kanban-columns':boardColumns.length} as React.CSSProperties}>
            {boardColumns.map((column)=>{
              const stageIds=new Set(column.stages.map((stage)=>stage.id));const items=pipeline.data!.items.filter((item)=>stageIds.has(item.current_stage_id))
              const color=column.stages[0]?phaseRampColor[phaseForStage(column.stages[0])]:'var(--color-faint)'
              const stats=columnStageStats(column,pipeline.data!.items,now)
              return <PhaseColumn id={column.key} label={column.label} count={items.length} color={color} stats={stats} key={column.key}>{items.map((item)=><CandidateCard item={item} key={item.id} columnKey={column.key} columnColor={color} now={now} members={members.data||[]} onOpen={()=>openCandidate(item)} onMove={(columnKey)=>moveToColumn(item,columnKey)} onOutcome={(stage)=>setOutcome({item,stage})} outcomeStages={outcomeStages} targets={targets} canMove={canRecruit}/>)}</PhaseColumn>
            })}
          </div>
        </DndContext>
      </Panel>
    </>}
    {view==='activity'&&<ActivityFeed links={[{job_id:jobId}]} title="Job activity" subtitle="Calls, client updates, submissions, feedback, and stage movement in one history." readOnly={capabilities.data?.readOnly}/>}
    {view==='details'&&<JobDetails job={job} health={jobHealth} members={members.data||[]} phases={buildPipelineColumns(pipeline.data!.stages,false)} items={pipeline.data!.items} onEdit={capabilities.data?.canWriteJobs?()=>setEditOpen(true):undefined}/>}
    <Modal title="Add candidate to job" open={addOpen} onClose={()=>setAddOpen(false)}><div className="stack"><Field label="Candidate"><Select value={candidateId} onChange={(event)=>setCandidateId(event.target.value)}><option value="">Select candidate</option>{candidates.data?.rows.filter((candidate)=>!pipeline.data!.items.some((item)=>item.candidate_id===candidate.id)).map((candidate)=><option value={candidate.id} key={candidate.id}>{candidate.full_name} · {candidate.current_position||'Profile'}</option>)}</Select></Field>{add.error&&<p className="form-error" role="alert">{add.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={()=>setAddOpen(false)}>Cancel</Button><Button loading={add.isPending} disabled={!candidateId} onClick={()=>add.mutate()}>Add candidate</Button></div></div></Modal>
    {capabilities.data?.canWriteJobs&&<JobEditModal job={job} members={members.data||[]} open={editOpen} onClose={()=>setEditOpen(false)} onSaved={async()=>{setEditOpen(false);await refresh()}}/>}
    {selected&&<JobCandidatePanel job={job} item={selected} stage={pipeline.data!.stages.find((stage)=>stage.id===selected.current_stage_id)!} stages={pipeline.data!.stages} currentMemberId={currentMember?.id} interviews={interviews.data!.filter((item)=>item.job_candidate_id===selected.id)} offers={offers.data!.filter((item)=>item.job_candidate_id===selected.id)} placement={placements.data!.find((item)=>item.job_id===job.id&&item.candidate_id===selected.candidate_id)||null} hasSubmission={(packages.data||[]).some((pack)=>Array.isArray(pack.candidate_submissions)&&pack.candidate_submissions.some((submission)=>submission.job_candidate_id===selected.id))} action={params.get('action')} readOnly={job.status!=='open'} onAction={(action)=>{const nextParams=new URLSearchParams(params);if(action)nextParams.set('action',action);else nextParams.delete('action');setParams(nextParams)}} onClose={()=>{const nextParams=new URLSearchParams(params);nextParams.delete('candidate');nextParams.delete('action');setParams(nextParams)}} onUpdated={refresh} onMove={move.mutate} moving={move.isPending}/>}
    <OutcomePrompt open={Boolean(outcome)} stage={outcome?.stage??null} candidateName={outcome?.item.candidates?.full_name||'this candidate'}
      loading={move.isPending} onClose={()=>setOutcome(null)} onConfirm={confirmOutcome}/>
    <OutcomesDrawer open={outcomesOpen} onClose={()=>setOutcomesOpen(false)} items={pipeline.data!.items}
      outcomeStages={outcomeStages} reinstateStage={reinstateStage} organizationSlug={organization!.slug}
      canMove={canRecruit} onMove={move.mutate}/>
  </Page>
}

function JobDetails({job,health,members,phases,items,onEdit}:{job:Job;health?:JobHealth;members:Array<{id:string;profiles?:{full_name?:string;email?:string}|null}>;phases:PipelineColumn[];items:JobCandidate[];onEdit?:()=>void}){
  const owner=members.find((member)=>member.id===job.owner_member_id)
  // This card used to render the seven static phases as decorative pills -- the same words for every
  // job, saying nothing about this one. It now reports where this job's candidates actually are.
  const counts=phases.map((phase)=>({...phase,count:items.filter((item)=>phase.stages.some((stage)=>stage.id===item.current_stage_id)).length}))
  const furthest=counts.reduce((last,phase,index)=>phase.count>0?index:last,-1)
  void health
  return <div className="record-overview-grid"><Panel title="Job overview" action={onEdit&&<Button variant="secondary" onClick={onEdit}>Edit job</Button>}><dl className="record-summary"><div><dt>Client</dt><dd>{job.companies?.name||'—'}</dd></div><div><dt>Owner</dt><dd>{owner?.profiles?.full_name||owner?.profiles?.email||'Unassigned'}</dd></div><div><dt>Location</dt><dd>{job.location||'Not set'}</dd></div><div><dt>Status</dt><dd>{lookup(jobStatus,job.status).label}</dd></div><div><dt>Priority</dt><dd>{lookup(jobPriority,job.priority).label}</dd></div><div><dt>Currency</dt><dd>{job.currency||'Not set'}</dd></div></dl></Panel><Panel title="Where candidates are" subtitle={items.length>0?`${items.length} in this pipeline.`:undefined}>{counts.length>0?<ol className="phase-progress">{counts.map((phase,index)=><li key={phase.key} className={phase.count>0?'phase-progress-live':index<furthest?'phase-progress-cleared':''}><span>{phase.label}</span><strong>{phase.count}</strong></li>)}</ol>:<p className="muted">This job has no pipeline stages configured yet.</p>}</Panel></div>
}

function JobEditModal({job,members,open,onClose,onSaved}:{job:Job;members:Array<{id:string;status:string;profiles?:{full_name?:string;email?:string}|null}>;open:boolean;onClose:()=>void;onSaved:()=>Promise<void>}){
  const [title,setTitle]=useState(job.title);const [location,setLocation]=useState(job.location||'');const [priority,setPriority]=useState(job.priority);const [status,setStatus]=useState(job.status);const [owner,setOwner]=useState(job.owner_member_id||'');const [description,setDescription]=useState(job.description||'')
  const mutation=useMutation({mutationFn:()=>updateJob(job.organization_id,job.id,{title,location:location||null,priority,status,owner_member_id:owner||null,description:description||null}),onSuccess:onSaved})
  return <Modal title="Edit job" open={open} onClose={onClose}><div className="stack"><Field label="Job title"><Input value={title} onChange={(event)=>setTitle(event.target.value)}/></Field><div className="form-grid"><Field label="Owner"><Select value={owner} onChange={(event)=>setOwner(event.target.value)}><option value="">Unassigned</option>{members.filter((member)=>member.status==='active').map((member)=><option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><Field label="Location"><Input value={location} onChange={(event)=>setLocation(event.target.value)}/></Field><Field label="Priority"><Select value={priority} onChange={(event)=>setPriority(event.target.value as Job['priority'])}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field><Field label="Status"><Select value={status} onChange={(event)=>setStatus(event.target.value as Job['status'])}><option value="draft">Draft</option><option value="open">Open</option><option value="on_hold">On hold</option><option value="filled">Filled</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></Select></Field></div><details className="advanced-fields"><summary>Advanced details</summary><Field label="Description"><Textarea value={description} onChange={(event)=>setDescription(event.target.value)}/></Field></details>{mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button loading={mutation.isPending} disabled={title.trim().length<2} onClick={()=>mutation.mutate()}>Save job</Button></div></div></Modal>
}
