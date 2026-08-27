import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {ClipboardList} from 'lucide-react'
import {Badge,Panel} from '../../shared/ui/Page'
import {Button} from '../../shared/ui/Button'
import {getBlueprintStatus} from './blueprintRepository'
import {blueprintState,summarizeBlueprint} from './blueprintPresentation'
import {InterviewBlueprintDrawer} from './InterviewBlueprintDrawer'

/* The compact blueprint summary on Job Workspace.
 *
 * Deliberately does not render the blueprint itself. A job page already carries a pipeline, a
 * submissions rail, health and an activity feed; a full question list here would push all of it below
 * the fold to show something a consultant reads once before an interview and not again. The detail
 * lives in a drawer.
 */
export function InterviewBlueprintPanel({organizationId,jobId,canConfigure}:{organizationId:string;jobId:string;canConfigure:boolean}){
  const [open,setOpen]=useState(false)
  const {data:status,isLoading}=useQuery({
    queryKey:['interview-blueprint',organizationId,jobId],
    queryFn:()=>getBlueprintStatus(organizationId,jobId),
  })

  // The RPC returns no row when the feature is off or the caller cannot use it. Rendering nothing is
  // the correct answer: an entry point RLS would refuse is worse than no entry point.
  if(isLoading||!status)return null

  const state=blueprintState(status)
  const summary=summarizeBlueprint(status)

  return <>
    <Panel
      title="Interview blueprint"
      icon={<ClipboardList size={16}/>}
      action={<div className="panel-actions">
        {status.rubricId||status.draftRubricId
          ? <Button variant="quiet" onClick={()=>setOpen(true)}>View</Button>
          : null}
        {canConfigure&&<Button variant="secondary" onClick={()=>setOpen(true)}>
          {status.draftRubricId?'Review draft':status.rubricId?'New version':'Set up'}
        </Button>}
      </div>}
    >
      <div className="blueprint-summary">
        <div className="blueprint-summary-headline">
          <strong>{summary.headline}</strong>
          {state==='stale'&&<Badge tone="warn">May be outdated</Badge>}
          {state==='draft_waiting'&&<Badge tone="neutral">Draft</Badge>}
        </div>
        <p>{summary.detail}</p>
        {/* An analysis reads the agency core rubric as well as this one, so a missing core rubric is
            a real blocker and is surfaced here rather than discovered at analysis time. */}
        {status.rubricId&&!status.coreRubricId&&
          <p className="blueprint-summary-note">No agency core rubric is active yet. Interviews cannot be analysed until one is.</p>}
      </div>
    </Panel>
    {open&&<InterviewBlueprintDrawer
      organizationId={organizationId}
      jobId={jobId}
      status={status}
      canConfigure={canConfigure}
      onClose={()=>setOpen(false)}
    />}
  </>
}
