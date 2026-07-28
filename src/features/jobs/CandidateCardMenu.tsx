import {MoreHorizontal} from 'lucide-react'
import {Menu,type MenuItemSpec} from '../../shared/ui/Menu'
import type {PipelineStage} from '../../shared/types/domain'

/* Ending a candidate's run used to require opening the drawer and working the move form -- five
 * interactions for the single most common negative outcome in recruitment, and the drag-to-tray
 * gesture that shortens it is unavailable to anyone not using a mouse.
 *
 * So this is not a convenience duplicate of the tray: it is the accessible path, and the tray is the
 * shortcut. Both run the same mutation through the same prompt, which is what keeps them honest with
 * each other.
 *
 * `stopPropagation` on pointer-down because the card itself is a dnd-kit draggable -- without it,
 * reaching for the menu starts dragging the card instead of opening it. */
export function CandidateCardMenu({candidateName,outcomeStages,onOpen,onOutcome}:{
  candidateName:string
  outcomeStages:PipelineStage[]
  onOpen:()=>void
  onOutcome:(stage:PipelineStage)=>void
}){
  const items:MenuItemSpec[]=[
    {id:'open',label:'Open candidate',onSelect:onOpen},
    ...outcomeStages.map((stage,index)=>({
      id:stage.id,
      /* The trailing ellipsis is load-bearing: it promises a prompt rather than an immediate
       * destructive act, which is what makes putting these in a menu acceptable at all. */
      label:`${stage.stage_type==='rejected'?'Reject':stage.stage_type==='withdrawn'?'Withdraw':'Put on hold'}…`,
      onSelect:()=>onOutcome(stage),
      separatorBefore:index===0,
      tone:stage.stage_type==='rejected'?('danger' as const):('default' as const),
    })),
  ]
  return <span className="candidate-card-menu" onPointerDown={(event)=>event.stopPropagation()}>
    <Menu label={`Actions for ${candidateName}`} items={items} trigger={(props)=>
      <button {...props} type="button" className="icon-button icon-button-sm" aria-label={`Actions for ${candidateName}`}>
        <MoreHorizontal size={15}/>
      </button>}/>
  </span>
}
