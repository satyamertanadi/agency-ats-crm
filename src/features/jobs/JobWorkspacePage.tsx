import {useEffect,useRef,useState} from 'react'
import {DndContext,KeyboardSensor,PointerSensor,useDraggable,useDroppable,useSensor,useSensors,type DragEndEvent,type KeyboardCoordinateGetter} from '@dnd-kit/core'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ArrowLeft,ChevronDown,Clock,GripVertical,Plus,Send} from 'lucide-react'
import {Link,useParams,useSearchParams} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {getPipeline,listInterviews,listJobHealth,listJobs,listOffers,listPlacements,listSubmissionPackages} from '../core/repository'
import {useStageMove} from '../core/useStageMove'
import {listTeamMembers,updateJob} from '../core/commercialRepository'
import type {Job,JobCandidate,JobHealth,PipelineStage,TeamMember} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {LocationField} from '../../shared/ui/LocationField'
import {currencyOptions} from '../../shared/lib/currencies'
import {OptionSelect} from '../../shared/ui/OptionSelect'
import {employmentType} from '../../shared/lib/optionSets'
import {Modal} from '../../shared/ui/Modal'
import {Page,Panel,StatusBadge} from '../../shared/ui/Page'
import {jobPriority,jobStatus,lookup} from '../../shared/lib/status'
import {BoardSkeleton,ErrorState} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'
import {ActivityFeed} from '../activities/ActivityFeed'
import {buildPipelineColumns,columnStageStats,daysInStage,isOutcomeStage,jobNeedsCandidateAction,phaseForStage,phaseRampColor,resolveStageForColumn,type PipelineColumn} from '../workflow/workflow'
import {JobCandidatePanel} from './JobCandidatePanel'
import {CandidateCardMenu} from './CandidateCardMenu'
import {OutcomePrompt} from './OutcomePrompt'
import {OutcomesDrawer} from './OutcomesDrawer'
import {SubmissionComposerDrawer,type ComposerCandidate} from '../submissions/SubmissionComposerDrawer'
import {JobSubmissionsRail,type SubmissionPackageRow} from '../submissions/JobSubmissionsRail'
import {nextActionDetail} from './jobHealth'
import {PhaseJump} from './PhaseJump'
import {AddCandidateToJobModal} from '../candidates/AddCandidateToJobModal'
import {TaskButton} from '../activities/TaskButton'
import {formatMoney,formatSalary} from '../../shared/lib/format'
import {useShortcut} from '../../shared/lib/useShortcut'

type WorkspaceView='pipeline'|'activity'|'details'

const memberInitials=(member?:Pick<TeamMember,'profiles'>|null)=>{
  const name=member?.profiles?.full_name||member?.profiles?.email||''
  return name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()||'').join('')||'—'
}

/* Arrow keys move a picked-up card a whole column at a time.
 *
 * dnd-kit's default keyboard getter translates by 25px per press, which on a ~280px column means
 * eleven presses to move one phase and no way to tell when you have crossed a boundary. Snapping to
 * the next column's centre makes one press mean one phase -- the same unit the mouse gesture has.
 *
 * Vertical keys are left unhandled: the columns are not ordered lists, so up/down within one has no
 * meaning to preserve. */
const boardKeyboardCoordinates:KeyboardCoordinateGetter=(event,{context:{droppableContainers,collisionRect}})=>{
  const step=event.code==='ArrowRight'?1:event.code==='ArrowLeft'?-1:0
  if(!step||!collisionRect)return undefined
  const columns=[...droppableContainers.values()].filter((container)=>container.rect.current)
    .sort((a,b)=>a.rect.current!.left-b.rect.current!.left)
  if(columns.length===0)return undefined
  const centre=collisionRect.left+collisionRect.width/2
  const current=columns.findIndex((container)=>{const rect=container.rect.current!;return centre>=rect.left&&centre<rect.left+rect.width})
  const target=columns[Math.min(columns.length-1,Math.max(0,(current<0?0:current)+step))]
  if(!target)return undefined
  const rect=target.rect.current!
  return {x:rect.left+rect.width/2-collisionRect.width/2,y:collisionRect.top}
}

function PhaseColumn({id,label,count,color,stats,children}:{id:string;label:string;count:number;color:string;stats:{avgDays:number}|null;children:React.ReactNode}){
  const {setNodeRef,isOver}=useDroppable({id})
  const empty=count===0
  // An empty column used to carry the exact same header chrome (coloured top bar, a stats line
  // reading "No candidates") as a full one, at the same grid width -- all the visual weight of a
  // populated phase for none of its content. It keeps the drop target and the label/count, and
  // nothing else, at a narrower share of the board (see kanbanGridColumns in the parent).
  return <section ref={setNodeRef} data-phase-key={id} className={`kanban-column workflow-column ${isOver?'kanban-over':''}${empty?' workflow-column-empty':''}`}>
    {!empty&&<div className="workflow-column-bar" style={{background:color}}/>}
    <header><strong>{label}</strong><span>{count}</span></header>
    {!empty&&<p className="workflow-column-stats">{stats?`Average ${stats.avgDays}d in phase`:'No candidates'}</p>}
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
  const owner=members.find((member)=>member.id===item.candidates?.owner_member_id)
  const ownerName=owner?.profiles?.full_name||owner?.profiles?.email||'Unassigned'
  return <article ref={setNodeRef} style={style} className={`candidate-card workflow-candidate-card ${isDragging?'dragging':''}`} {...(canMove?listeners:{})} {...attributes}>
    <button className="candidate-card-open" onPointerDown={(event)=>event.stopPropagation()} onClick={onOpen}>
      <span className="workflow-card-top">
        <span className="workflow-card-avatar" aria-hidden="true">{initials}</span>
        <strong>{name}</strong>
        <GripVertical size={13} className="workflow-card-grip" aria-hidden="true"/>
      </span>
      <span className="workflow-card-role">{item.candidates?.current_position||'Role not recorded'}{item.candidates?.current_company?` · ${item.candidates.current_company}`:''}</span>
      <span className="workflow-card-bottom">
        <span className="workflow-days-badge"><Clock size={10}/>{days}d</span>
        {/* Two initials are unreadable to anyone who does not already know the team, and were hidden
          * from assistive tech entirely -- so the chip told a screen-reader user nothing at all and a
          * new consultant nothing they could act on. The name travels with it both ways now. */}
        <span className="workflow-card-owner" title={`Candidate owner: ${ownerName}`}>{memberInitials(owner)}<span className="sr-only">Candidate owner: {ownerName}</span></span>
      </span>
    </button>
    {canMove&&<label onPointerDown={(event)=>event.stopPropagation()}><span className="sr-only">Move {name}</span><Select aria-label={`Move ${name}`} value={columnKey} onChange={(event)=>onMove(event.target.value)}>{targets.map((target)=><option value={target.key} key={target.key}>{target.label}</option>)}</Select></label>}
    {/* The keyboard-reachable route to an outcome. The stage dropdown beside it only offers active
      * columns, so before this the only way to reject someone was the drawer's move form. */}
    {canMove&&outcomeStages.length>0&&<CandidateCardMenu candidateName={name} outcomeStages={outcomeStages} onOpen={onOpen} onOutcome={onOutcome}/>}
  </article>
}

export function JobWorkspacePage(){
  const {jobId=''}=useParams();const {organization,membership}=useOrganization();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const boardRef=useRef<HTMLDivElement>(null);const [params,setParams]=useSearchParams();const [addOpen,setAddOpen]=useState(false);const [editOpen,setEditOpen]=useState(false);const [outcomesOpen,setOutcomesOpen]=useState(false);const [outcome,setOutcome]=useState<{item:JobCandidate;stage:PipelineStage}|null>(null);const [composerCandidates,setComposerCandidates]=useState<ComposerCandidate[]|null>(null)
  /* Columns used to render every card unconditionally, so a well-worked Sourcing column with forty
   * names pushed every other phase off the fold below it. Capped per column, expanded on request --
   * a set of expanded keys rather than a single board-wide toggle, because "I want to see everyone
   * in Sourcing" says nothing about whether Screening should also be full. */
  const [expandedColumns,setExpandedColumns]=useState<Set<string>>(new Set())
  const toggleColumnExpanded=(key:string)=>setExpandedColumns((current)=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next})
  const jobs=useQuery({queryKey:['jobs',organization?.id],enabled:Boolean(organization),queryFn:()=>listJobs(organization!.id)});const job=jobs.data?.find((item)=>item.id===jobId)
  const pipeline=useQuery({queryKey:['pipeline',jobId],enabled:Boolean(job),queryFn:()=>getPipeline(job!)});const health=useQuery({queryKey:['job-health',organization?.id],enabled:Boolean(organization),queryFn:()=>listJobHealth(organization!.id)})
  /* Scoped to this job, not to the organization. These four decorate the candidate panel for
   * candidates on this board only -- fetching every interview, offer, placement and submission
   * package in the workspace to filter them down client-side was four unbounded reads per job open.
   * The query keys carry the job id so one job's cache is not served to another. */
  const interviews=useQuery({queryKey:['interviews',organization?.id,jobId],enabled:Boolean(organization),queryFn:()=>listInterviews(organization!.id,{jobId})});const offers=useQuery({queryKey:['offers',organization?.id,jobId],enabled:Boolean(organization),queryFn:()=>listOffers(organization!.id,{jobId})});const placements=useQuery({queryKey:['placements',organization?.id,jobId],enabled:Boolean(organization),queryFn:()=>listPlacements(organization!.id,{jobId})});const packages=useQuery({queryKey:['submissions',organization?.id,jobId],enabled:Boolean(organization),queryFn:()=>listSubmissionPackages(organization!.id,{jobId})});const members=useQuery({queryKey:['members',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  const refresh=()=>Promise.all([cache.invalidateQueries({queryKey:['pipeline',jobId]}),cache.invalidateQueries({queryKey:['jobs',organization?.id]}),cache.invalidateQueries({queryKey:['job-health',organization?.id]}),cache.invalidateQueries({queryKey:['today',organization?.id]})])
  /* The jobs list's next-action CTAs name an action, so they carry it: arriving with ?open=add or
   * ?open=edit lands on the surface that resolves the action rather than on the board with the
   * consultant left to find it. Consumed on arrival so a reload or a back-navigation does not
   * reopen a modal the consultant already dismissed. */
  useEffect(()=>{
    const open=params.get('open')
    if(open!=='add'&&open!=='edit')return
    if(open==='add')setAddOpen(true);else setEditOpen(true)
    const next=new URLSearchParams(params);next.delete('open');setParams(next,{replace:true})
  },[params,setParams])
  const move=useStageMove(jobId,refresh)
  /* The repeated board action keeps one discoverable shortcut. */
  useShortcut('a',()=>setAddOpen(true),Boolean(job&&job.status==='open'&&capabilities.data?.canMovePipeline))
  // The board was mouse-only: without a KeyboardSensor the drag gesture had no keyboard equivalent at
  // all, and the per-card stage select was the only way through. Both stay -- the select is still the
  // faster route for a screen-reader user, and this makes the visible affordance work for everyone.
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}),useSensor(KeyboardSensor,{coordinateGetter:boardKeyboardCoordinates}))
  const canRecruit=job?.status==='open'&&Boolean(capabilities.data?.canMovePipeline)
  // The board is the thing worth holding space for: it is the tallest, slowest part of this screen
  // and the one whose arrival used to shove the whole page down.
  /* Only the two queries the board cannot be drawn without gate it. The other five are org-wide
   * lists that decorate a candidate once you open one -- interviews, offers, placements, submission
   * packages, members -- and holding the entire workspace hostage to all seven meant one slow or
   * failing org-wide query blanked a board that had everything it needed to render.
   *
   * The failure mode was the worse half: `listOffers` fetches every offer in the organization, so a
   * single unreadable offer row anywhere in the workspace replaced this job's pipeline with a
   * full-page error. The board is the reason the page exists; it should be the last thing to go. */
  if(jobs.isLoading||pipeline.isLoading||capabilities.isLoading)return <Panel padding="sm"><BoardSkeleton label="Opening job workspace…"/></Panel>
  if(jobs.error||pipeline.error||!job)return <ErrorState error={jobs.error||pipeline.error||new Error('Job not found')}/>
  /* The lazily-hydrated five, surfaced rather than swallowed: a candidate panel that silently shows
   * "no offers" because the offers query failed is a lie, so the panel is told and says so. */
  const detailError=interviews.error||offers.error||placements.error||packages.error||members.error
  const detailLoading=interviews.isLoading||offers.isLoading||placements.isLoading||packages.isLoading||members.isLoading
  const view=(params.get('view') as WorkspaceView)||'pipeline';const selected=pipeline.data!.items.find((item)=>item.id===params.get('candidate'))||null;const outcomeStages=pipeline.data!.stages.filter(isOutcomeStage)
  const columns=buildPipelineColumns(pipeline.data!.stages)
  const targets=columns.map((column)=>({key:column.key,label:column.label}))
  // Placed reads as a terminal outcome, same register as Rejected/Withdrawn/On hold, so it moves to
  // the counter row rather than sitting as a seventh draggable column. `targets` above stays
  // unfiltered so "Placed" remains a valid move destination in each card's stage dropdown.
  const boardColumns=columns.filter((column)=>!column.stages.every((stage)=>stage.stage_type==='placed'))
  const placedCount=pipeline.data!.items.filter((item)=>item.pipeline_stages?.stage_type==='placed').length
  const now=new Date()
  /* One pass building everything each column of the board needs, rather than re-deriving items/color/
   * stats inline inside the render map -- this is also what lets the grid-template-columns string
   * below give populated columns more width than empty ones, since it needs every column's item count
   * before any of them render. */
  const columnData=boardColumns.map((column)=>{
    const stageIds=new Set(column.stages.map((stage)=>stage.id));const items=pipeline.data!.items.filter((item)=>stageIds.has(item.current_stage_id))
    const color=column.stages[0]?phaseRampColor[phaseForStage(column.stages[0])]:'var(--color-faint)'
    const stats=columnStageStats(column,pipeline.data!.items,now)
    return {column,items,color,stats}
  })
  // Outcome stages get no board column of their own, but they used to float as a separate chip row
  // above the board, disconnected from it even though they read the exact same pipeline items. They
  // now render as trailing, dimmed columns in the same grid instead -- part of the board, not a
  // second toolbar next to it. Zero-count stages are left out entirely, matching OutcomesDrawer's own
  // filter over the same items, so a job with no withdrawals never shows a "Withdrawn 0" column.
  const outcomeCounts=outcomeStages.map((stage)=>({stage,count:pipeline.data!.items.filter((item)=>item.current_stage_id===stage.id).length})).filter((entry)=>entry.count>0)
  const kanbanGridColumns=[...columnData.map(({items})=>items.length>0?'minmax(186px,1fr)':'minmax(96px,0.4fr)'),
    ...outcomeCounts.map(()=>'minmax(96px,0.5fr)'),...(placedCount>0?['minmax(96px,0.5fr)']:[])].join(' ')
  const moveToColumn=(item:JobCandidate,columnKey:string)=>{const stageId=resolveStageForColumn(columns,columnKey,item.current_stage_id);if(stageId)move.mutate({itemId:item.id,stageId,name:item.candidates?.full_name,label:columns.find((column)=>column.key===columnKey)?.label||'the next phase'})}
  /* Reinstating lands on the first active stage of the board rather than the stage they were closed
   * from: that stage is often deep in the pipeline and putting someone straight back into, say,
   * Offer because that is where they were rejected would assert progress nobody has re-made. */
  const reinstateStage=columns.find((column)=>column.stages.some((stage)=>stage.stage_type==='active'))?.stages[0]??null
  /* Everyone currently at shortlist. That phase IS the shortlist, so it is the package by default --
   * a consultant who has spent a week deciding who goes forward should not then have to re-pick them
   * one at a time. They can still drop anyone inside the composer. */
  const shortlisted=pipeline.data!.items.filter((item)=>item.pipeline_stages&&phaseForStage(item.pipeline_stages)==='shortlist')
    .map((item)=>({jobCandidateId:item.id,name:item.candidates?.full_name||'Candidate'}))
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
  const next=jobNeedsCandidateAction(pipeline.data!.items);const currentMember=membership
  const setView=(nextView:WorkspaceView)=>{const nextParams=new URLSearchParams(params);nextParams.set('view',nextView);nextParams.delete('candidate');nextParams.delete('action');setParams(nextParams)}
  const openCandidate=(item:JobCandidate)=>{const nextParams=new URLSearchParams(params);nextParams.set('candidate',item.id);nextParams.delete('action');setParams(nextParams)}
  const composeCandidate=(item:JobCandidate)=>{setComposerCandidates([{jobCandidateId:item.id,name:item.candidates?.full_name||'Candidate'}]);const nextParams=new URLSearchParams(params);nextParams.delete('candidate');nextParams.delete('action');setParams(nextParams)}
  const jobHealth=health.data?.find((item)=>item.id===jobId)
  return <Page title={job.title} eyebrow={job.companies?.name||'Client job'} metadata={<div className="record-metadata"><StatusBadge map={jobStatus} value={job.status}/><StatusBadge map={jobPriority} value={job.priority}/>{job.location&&<span>{job.location}</span>}{jobHealth&&<span>{jobHealth.days_open} days open · {formatMoney(jobHealth.expected_fee,jobHealth.currency)} fee</span>}</div>} actions={<><Link className="button button-quiet" to={`/app/${organization!.slug}/jobs`}><ArrowLeft size={14}/>Jobs</Link><TaskButton linkType="job" linkId={jobId}/>{next&&canRecruit&&<Button leadingIcon={<Plus size={14}/>} onClick={()=>setAddOpen(true)}>{next.label}</Button>}</>} tabs={<nav className="record-tabs" aria-label="Job workspace views"><button className={view==='pipeline'?'active':''} onClick={()=>setView('pipeline')}>Pipeline</button><button className={view==='activity'?'active':''} onClick={()=>setView('activity')}>Activity</button><button className={view==='details'?'active':''} onClick={()=>setView('details')}>Details</button></nav>}>
    {job.status!=='open'&&<p className="warning-box">This job is {lookup(jobStatus,job.status).label.toLowerCase()}. Recruitment actions are read-only until it is reopened.</p>}
    {view==='pipeline'&&<>
      <div className="workflow-toolbar">
        <div><strong>{pipeline.data!.items.length} in pipeline</strong><span>Move candidates between phases, then open a card for the next action.</span></div>
        <div className="table-actions">
          {capabilities.data?.canSubmit&&shortlisted.length>0&&job.status==='open'&&<Button size="sm" variant="secondary" leadingIcon={<Send size={14}/>} onClick={()=>setComposerCandidates(shortlisted)}>Send {shortlisted.length} to client</Button>}
          {canRecruit&&<Button variant="secondary" leadingIcon={<Plus size={14}/>} onClick={()=>setAddOpen(true)}>Add candidates</Button>}
        </div>
      </div>
      <Panel padding="sm">
        <PhaseJump containerRef={boardRef} columns={boardColumns.map((column)=>({key:column.key,label:column.label,count:pipeline.data!.items.filter((item)=>column.stages.some((stage)=>stage.id===item.current_stage_id)).length}))}/>
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div ref={boardRef} className="kanban workflow-kanban" style={{gridTemplateColumns:kanbanGridColumns} as React.CSSProperties}>
            {columnData.map(({column,items,color,stats})=>{
              // 6 matches the cap Today's active-jobs list already uses: enough to see the column at
              // a glance without an inner scroll, few enough that a heavily-worked phase does not
              // push every column after it below the fold.
              const expanded=expandedColumns.has(column.key)
              const visibleItems=expanded?items:items.slice(0,6)
              const hiddenCount=items.length-visibleItems.length
              return <PhaseColumn id={column.key} label={column.label} count={items.length} color={color} stats={stats} key={column.key}>
                {visibleItems.map((item)=><CandidateCard item={item} key={item.id} columnKey={column.key} columnColor={color} now={now} members={members.data||[]} onOpen={()=>openCandidate(item)} onMove={(columnKey)=>moveToColumn(item,columnKey)} onOutcome={(stage)=>setOutcome({item,stage})} outcomeStages={outcomeStages} targets={targets} canMove={canRecruit}/>)}
                {hiddenCount>0&&<button type="button" className="workflow-column-more" onClick={()=>toggleColumnExpanded(column.key)}>+{hiddenCount} more candidate{hiddenCount===1?'':'s'}<ChevronDown size={13}/></button>}
                {expanded&&items.length>6&&<button type="button" className="workflow-column-more workflow-column-more-collapse" onClick={()=>toggleColumnExpanded(column.key)}>Show fewer<ChevronDown size={13}/></button>}
              </PhaseColumn>
            })}
            {/* Outcome/placed counts, as trailing columns of the same board rather than a chip row
              * disconnected from it. Placed stays inert -- not a button -- a placement is reached
              * through the candidate's own card, not reinstated from here. */}
            {outcomeCounts.map(({stage,count})=><button type="button" className="kanban-column workflow-outcome-column" key={stage.id} onClick={()=>setOutcomesOpen(true)}><header><strong>{stage.name}</strong><span>{count}</span></header></button>)}
            {placedCount>0&&<div className="kanban-column workflow-outcome-column workflow-outcome-column-good"><header><strong>Placed</strong><span>{placedCount}</span></header></div>}
          </div>
        </DndContext>
        {/* Sits under the board as a second section of the same Panel rather than its own card: what
          * you already sent a client is context for what you do next on it, and a second bordered
          * surface directly under the first read as two disconnected features instead of one flow. */}
        <div className="panel-section-divider"/>
        <div className="workflow-submissions-section">
          <h3>Sent to this client</h3>
          <JobSubmissionsRail packages={(packages.data||[]) as SubmissionPackageRow[]} jobId={jobId} organizationId={organization!.id}
            canSubmit={Boolean(capabilities.data?.canSubmit)} onChanged={refresh} onResend={()=>setComposerCandidates(shortlisted)}/>
        </div>
      </Panel>
    </>}
    {view==='activity'&&<ActivityFeed links={[{job_id:jobId}]} title="Job activity" subtitle="Calls, client updates, submissions, feedback, and stage movement in one history." readOnly={capabilities.data?.readOnly}/>}
    {view==='details'&&<JobDetails job={job} health={jobHealth} members={members.data||[]} phases={buildPipelineColumns(pipeline.data!.stages)} items={pipeline.data!.items} onEdit={capabilities.data?.canWriteJobs?()=>setEditOpen(true):undefined} onAdd={canRecruit?()=>setAddOpen(true):undefined}/>}
    {/* The bare list this replaces held the first 100 candidates in the organization, unsearchable and
      * unordered, and added exactly one at a time -- so filling a pipeline from the job side meant
      * repeating a scroll through a list that could not contain the person you wanted. The good modal
      * already existed on the candidate side; it is handed this job and this board's occupants so it
      * neither asks which job nor offers someone already on it. */}
    {/* Gated on the same capability as the buttons that open it, so arriving with ?open=add cannot
      * hand a read-only member a form whose only possible outcome is an RLS rejection. */}
    {canRecruit&&<AddCandidateToJobModal open={addOpen} onClose={()=>setAddOpen(false)} job={{id:job.id,title:job.title}}
      excludeIds={pipeline.data!.items.map((item)=>item.candidate_id)} onAdded={refresh}/>}
    {capabilities.data?.canWriteJobs&&<JobEditModal job={job} members={members.data||[]} open={editOpen} onClose={()=>setEditOpen(false)} onSaved={async()=>{setEditOpen(false);await refresh()}}/>}
    {selected&&<JobCandidatePanel job={job} item={selected}
      stage={pipeline.data!.stages.find((stage)=>stage.id===selected.current_stage_id)!} stages={pipeline.data!.stages}
      currentMemberId={currentMember?.id} interviews={(interviews.data||[]).filter((item)=>item.job_candidate_id===selected.id)}
      offers={(offers.data||[]).filter((item)=>item.job_candidate_id===selected.id)}
      placement={(placements.data||[]).find((item)=>item.job_id===job.id&&item.candidate_id===selected.candidate_id)||null}
      hasSubmission={(packages.data||[]).some((pack)=>Array.isArray(pack.candidate_submissions)&&pack.candidate_submissions.some((submission)=>submission.job_candidate_id===selected.id))}
      action={params.get('action')} readOnly={job.status!=='open'}
      onAction={(action)=>{const nextParams=new URLSearchParams(params);if(action)nextParams.set('action',action);else nextParams.delete('action');setParams(nextParams)}}
      onClose={()=>{const nextParams=new URLSearchParams(params);nextParams.delete('candidate');nextParams.delete('action');setParams(nextParams)}}
      onUpdated={refresh} onMove={move.mutate} moving={move.isPending} onComposeSubmission={()=>composeCandidate(selected)}
      detailLoading={detailLoading} detailError={detailError}/>}
    <SubmissionComposerDrawer open={Boolean(composerCandidates)} onClose={()=>setComposerCandidates(null)} job={job} organizationId={organization!.id}
      candidates={composerCandidates||[]} onSent={refresh}/>
    <OutcomePrompt open={Boolean(outcome)} stage={outcome?.stage??null} candidateName={outcome?.item.candidates?.full_name||'this candidate'}
      loading={move.isPending} onClose={()=>setOutcome(null)} onConfirm={confirmOutcome}/>
    <OutcomesDrawer open={outcomesOpen} onClose={()=>setOutcomesOpen(false)} items={pipeline.data!.items}
      outcomeStages={outcomeStages} reinstateStage={reinstateStage} organizationSlug={organization!.slug}
      canMove={canRecruit} onMove={move.mutate}/>
  </Page>
}

function JobDetails({job,health,members,phases,items,onEdit,onAdd}:{job:Job;health?:JobHealth;members:Array<{id:string;profiles?:{full_name?:string;email?:string}|null}>;phases:PipelineColumn[];items:JobCandidate[];onEdit?:()=>void;onAdd?:()=>void}){
  const owner=members.find((member)=>member.id===job.owner_member_id)
  // This card used to render the seven static phases as decorative pills -- the same words for every
  // job, saying nothing about this one. It now reports where this job's candidates actually are.
  const counts=phases.map((phase)=>({...phase,count:items.filter((item)=>phase.stages.some((stage)=>stage.id===item.current_stage_id)).length}))
  const furthest=counts.reduce((last,phase,index)=>phase.count>0?index:last,-1)
  /* `health` was fetched, threaded through two components and then discarded with `void health`. It
   * carries the two facts this page could not otherwise state without re-deriving them in TypeScript:
   * what the placement is worth and where that number came from. The fee formula lives in SQL --
   * salary period, job override, account agreement fallback -- and re-deriving it here is how a
   * workspace comes to quote a different fee from the jobs list it was opened from. */
  const next=health?nextActionDetail(health):null
  const act=next?.surface==='edit'?onEdit:next?.surface==='add'?onAdd:undefined
  return <div className="stack">
    {next&&<Callout tone="info" title={next.label} action={act&&<Button size="sm" variant="secondary" onClick={act}>{next.label}</Button>}>{next.explain}</Callout>}
    <div className="record-overview-grid"><Panel title="Job overview" action={onEdit&&<Button variant="secondary" onClick={onEdit}>Edit job</Button>}><dl className="record-summary"><div><dt>Client</dt><dd>{job.companies?.name||'—'}</dd></div><div><dt>Owner</dt><dd>{owner?.profiles?.full_name||owner?.profiles?.email||'Unassigned'}</dd></div><div><dt>Location</dt><dd>{job.location||'Not set'}</dd></div><div><dt>Status</dt><dd>{lookup(jobStatus,job.status).label}</dd></div><div><dt>Priority</dt><dd>{lookup(jobPriority,job.priority).label}</dd></div><div><dt>Days open</dt><dd>{health?`${health.days_open} days`:'—'}</dd></div><div><dt>Salary</dt><dd>{job.salary_min||job.salary_max?<>{formatSalary(job.salary_min??null,job.currency)}{job.salary_max?` – ${formatSalary(job.salary_max,job.currency)}`:''}</>:'Not set'}</dd></div><div><dt>Expected fee</dt><dd>{health?.expected_fee?<>{formatMoney(health.expected_fee,health.currency)}<small className="muted"> · {health.fee_source||'no source'}</small></>:'Not set'}</dd></div></dl></Panel><Panel title="Where candidates are" subtitle={items.length>0?`${items.length} in this pipeline.`:undefined}>{counts.length>0?<ol className="phase-progress">{counts.map((phase,index)=><li key={phase.key} className={phase.count>0?'phase-progress-live':index<furthest?'phase-progress-cleared':''}><span>{phase.label}</span><strong>{phase.count}</strong></li>)}</ol>:<p className="muted">This job has no pipeline stages configured yet.</p>}</Panel></div>
  </div>
}

/* Empty means "not set", which for the fee fields is not the same as zero: a null override falls back
 * to the account agreement, a 0 asserts this job is worked for free. `''` therefore has to survive as
 * null rather than being coerced through Number(). */
const numberOrNull=(value:string)=>value.trim()===''?null:Number(value)

function JobEditModal({job,members,open,onClose,onSaved}:{job:Job;members:Array<{id:string;status:string;profiles?:{full_name?:string;email?:string}|null}>;open:boolean;onClose:()=>void;onSaved:()=>Promise<void>}){
  const {organization}=useOrganization();const toast=useToast()
  const [title,setTitle]=useState(job.title);const [location,setLocation]=useState(job.location||'');const [priority,setPriority]=useState(job.priority);const [status,setStatus]=useState(job.status);const [owner,setOwner]=useState(job.owner_member_id||'');const [description,setDescription]=useState(job.description||'')
  /* Salary and fee were settable once, in the create drawer, and never again -- so a brief that
   * arrived with the budget still to be confirmed (which is most of them) left the job permanently
   * quoting a fee derived from a salary nobody could correct. */
  const [salaryMin,setSalaryMin]=useState(job.salary_min?.toString()||'');const [salaryMax,setSalaryMax]=useState(job.salary_max?.toString()||'');const [currency,setCurrency]=useState(job.currency||organization?.base_currency||'USD')
  const [feePercentage,setFeePercentage]=useState(job.placement_fee_percentage?.toString()||'');const [fixedFee,setFixedFee]=useState(job.fixed_fee?.toString()||'')
  // The column shipped with the initial schema and never had an input; only the CSV importer wrote it.
  const [employment,setEmployment]=useState(employmentType.key(job.employment_type))
  const period=organization?.salary_period==='monthly'?'month':'year'
  const mutation=useMutation({
    mutationFn:()=>updateJob(job.organization_id,job.id,{title,location:location||null,priority,status,employment_type:employment||null,owner_member_id:owner||null,description:description||null,
      salary_min:numberOrNull(salaryMin),salary_max:numberOrNull(salaryMax),currency:currency.trim().toUpperCase()||null,
      placement_fee_percentage:numberOrNull(feePercentage),fixed_fee:numberOrNull(fixedFee)}),
    onSuccess:async()=>{await onSaved();toast.success(`${title} was updated.`)},
    onError:(error)=>toast.error(error,'The job is unchanged.'),
  })
  return <Modal title="Edit job" open={open} onClose={onClose}><div className="stack"><Field label="Job title"><Input value={title} onChange={(event)=>setTitle(event.target.value)}/></Field><div className="form-grid"><Field label="Owner"><Select value={owner} onChange={(event)=>setOwner(event.target.value)}><option value="">Unassigned</option>{members.filter((member)=>member.status==='active').map((member)=><option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><LocationField value={location} onChange={setLocation}/><Field label="Priority"><Select value={priority} onChange={(event)=>setPriority(event.target.value as Job['priority'])}>{Object.entries(jobPriority).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</Select></Field><Field label="Employment type"><OptionSelect label="Employment type" placeholder="Not specified" options={employmentType.options(employment)} value={employmentType.key(employment)} onChange={setEmployment}/></Field><Field label="Status"><Select value={status} onChange={(event)=>setStatus(event.target.value as Job['status'])}><option value="draft">Draft</option><option value="open">Open</option><option value="on_hold">On hold</option><option value="filled">Filled</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></Select></Field></div>
    <div className="form-grid"><Field label={`Salary minimum (per ${period})`}><Input type="number" min="0" value={salaryMin} onChange={(event)=>setSalaryMin(event.target.value)}/></Field><Field label={`Salary maximum (per ${period})`}><Input type="number" min="0" value={salaryMax} onChange={(event)=>setSalaryMax(event.target.value)}/></Field><Field label="Currency"><Select value={currency} onChange={(event)=>setCurrency(event.target.value)}>{currencyOptions(organization?.base_currency).map((option)=><option key={option.code} value={option.code}>{option.code} — {option.name}</option>)}</Select></Field></div>
    <details className="advanced-fields"><summary>Fee override and description</summary>
      {/* Named an override because that is what it is: leave both empty and the fee follows the
        * client's approved commercial terms, which is the right answer for most jobs. */}
      <p className="muted">Leave both fee fields empty to use the client's approved commercial terms. A fixed fee wins over a percentage.</p>
      <div className="form-grid"><Field label="Fee percentage of salary"><Input type="number" min="0" max="100" step="0.5" value={feePercentage} onChange={(event)=>setFeePercentage(event.target.value)}/></Field><Field label="Fixed fee"><Input type="number" min="0" value={fixedFee} onChange={(event)=>setFixedFee(event.target.value)}/></Field></div>
      <Field label="Description"><Textarea value={description} onChange={(event)=>setDescription(event.target.value)}/></Field>
    </details>{mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button loading={mutation.isPending} disabled={title.trim().length<2} onClick={()=>mutation.mutate()}>Save job</Button></div></div></Modal>
}
