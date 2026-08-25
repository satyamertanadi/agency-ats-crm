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
export function CandidateCardMenu({candidateName,columnKey,targets,outcomeStages,onOpen,onMove,onOutcome}:{
  candidateName:string
  /** The column this card is currently in, so its own phase is offered as a no-op rather than a move. */
  columnKey:string
  targets:readonly {key:string;label:string}[]
  outcomeStages:PipelineStage[]
  onOpen:()=>void
  onMove:(columnKey:string)=>void
  onOutcome:(stage:PipelineStage)=>void
}){
  const items:MenuItemSpec[]=[
    {id:'open',label:'Open candidate',onSelect:onOpen},
    /* The phase move, absorbed from the <select> that used to sit permanently at the bottom of every
     * card. A card is roughly 110px tall and a full-width dropdown listing six phases was the single
     * biggest thing on it -- so a board of twenty candidates rendered twenty dropdowns and the names
     * competed with them for attention. Drag-and-drop is the pointer route; this is the keyboard and
     * screen-reader route, which is why it lists the phases as items rather than being a shortcut to
     * something only a mouse can do. The current phase is present but disabled, so the menu still
     * states where the candidate IS. */
    ...targets.map((target,index)=>({
      id:`move-${target.key}`,
      label:`Move to ${target.label}`,
      text:target.label,
      disabled:target.key===columnKey,
      separatorBefore:index===0,
      onSelect:()=>onMove(target.key),
    })),
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
