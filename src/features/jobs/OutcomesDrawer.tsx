import {Link} from 'react-router-dom'
import {Undo2} from 'lucide-react'
import {Button} from '../../shared/ui/Button'
import {Drawer} from '../../shared/ui/Drawer'
import {EmptyState} from '../../shared/ui/States'
import type {JobCandidate,PipelineStage} from '../../shared/types/domain'
import type {StageMoveInput} from '../core/useStageMove'
import {formatDate} from '../../shared/lib/format'

/* Where rejected, withdrawn and on-hold candidates went to be forgotten.
 *
 * They were counted in a chip and then unreachable: outcome stages get no board column, so a closed
 * candidate could only be found by knowing their name and searching the whole talent database, and
 * there was no way back into the pipeline at all. The counts were the only evidence they had ever
 * existed on this job.
 *
 * Reinstating is a plain stage move to the first active stage, which is why it needs no RPC of its
 * own -- move_job_candidate_stage clears closed_at whenever the target is not an outcome. It carries
 * a note saying so, because a candidate reappearing on the board with no explanation is its own small
 * mystery. */
export function OutcomesDrawer({open,onClose,items,outcomeStages,reinstateStage,organizationSlug,canMove,onMove}:{
  open:boolean
  onClose:()=>void
  /* The whole pipeline. Filtering happens here rather than at the call site so the drawer and the
   * chips that open it cannot disagree about what counts as closed. */
  items:JobCandidate[]
  outcomeStages:PipelineStage[]
  /* Where a reinstated candidate lands -- the board's first active stage. */
  reinstateStage:PipelineStage|null
  organizationSlug:string
  canMove:boolean
  onMove:(input:StageMoveInput)=>void
}){
  const groups=outcomeStages.map((stage)=>({
    stage,
    rows:items.filter((item)=>item.current_stage_id===stage.id),
  })).filter((group)=>group.rows.length>0)
  const total=groups.reduce((sum,group)=>sum+group.rows.length,0)

  return <Drawer title="Closed candidates" description="Everyone who came off this job, and why." eyebrow="Outcomes" open={open} onClose={onClose}>
    {total===0
      ?<EmptyState title="Nobody has been closed yet" description="Rejected, withdrawn and on-hold candidates collect here with the reason they were closed."/>
      :<div className="stack">{groups.map((group)=><section key={group.stage.id} className="outcome-group">
        <h3>{group.stage.name} <span className="muted">{group.rows.length}</span></h3>
        <ul className="outcome-rows">{group.rows.map((item)=>{
          /* The embed is ordered occurred_at desc, so [0] is the move that closed them -- but only if
           * it actually landed on this stage. Guarding on that stops a later unrelated edit from
           * being presented as the reason they were rejected. */
          const latest=item.stage_history?.[0]
          const reason=latest?.to_stage_id===group.stage.id?latest.note:null
          const name=item.candidates?.full_name||'Candidate'
          return <li key={item.id}>
            <div>
              <Link className="record-link" to={`/app/${organizationSlug}/candidates/${item.candidate_id}`}><strong>{name}</strong></Link>
              <small className="muted">{item.candidates?.current_position||'Role not recorded'} · closed {formatDate(latest?.occurred_at||item.updated_at)}</small>
              {reason?<p className="outcome-reason">{reason}</p>:<p className="outcome-reason muted">No reason was recorded.</p>}
            </div>
            {canMove&&reinstateStage&&<Button size="sm" variant="secondary" leadingIcon={<Undo2 size={14}/>}
              onClick={()=>onMove({itemId:item.id,stageId:reinstateStage.id,name,label:reinstateStage.name,
                note:`Reinstated from ${group.stage.name}.`,source:'reinstate',
                undo:{stageId:group.stage.id,label:group.stage.name}})}>Reinstate</Button>}
          </li>
        })}</ul>
      </section>)}</div>}
  </Drawer>
}
