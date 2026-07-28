import {useEffect,useState} from 'react'
import {Button} from '../../shared/ui/Button'
import {Field,Textarea} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'
import type {PipelineStage} from '../../shared/types/domain'

/* The one place a candidate's run is ended, shared by the card menu and the board's outcome tray so
 * the two cannot ask for different things.
 *
 * The reason is optional but pre-focused, which is the whole point of capturing it here: the moment a
 * consultant decides to reject someone is the only moment they know why, and asking later means
 * asking someone who has since worked twenty other candidates. It reaches stage_history.note and
 * becomes the activity-feed summary, so it is readable from the outcomes drawer and the timeline.
 *
 * Deliberately not a ConfirmDialog: this is reversible (the move can be undone from its toast, and
 * the candidate stays findable and reinstatable), and ConfirmDialog is reserved for the irreversible
 * tier. A stop sign in front of something you can walk back teaches people to click through stop
 * signs. */
export function OutcomePrompt({stage,candidateName,open,onClose,onConfirm,loading=false}:{
  stage:PipelineStage|null
  candidateName:string
  open:boolean
  onClose:()=>void
  onConfirm:(note:string)=>void
  loading?:boolean
}){
  const [note,setNote]=useState('')
  // Cleared per opening, so a reason typed for one candidate never rides along to the next.
  useEffect(()=>{if(open)setNote('')},[open])
  if(!stage)return null
  const verb=stage.stage_type==='rejected'?'Reject':stage.stage_type==='withdrawn'?'Withdraw':'Put on hold'
  return <Modal title={`${verb} ${candidateName}?`} eyebrow="Candidate outcome" open={open} onClose={onClose} dirty={note.trim().length>0}
    discardMessage="Discard this reason?">
    <form className="stack" onSubmit={(event)=>{event.preventDefault();onConfirm(note)}}>
      <p className="muted">They move to <strong>{stage.name}</strong> and drop off the board. Nothing is deleted — they stay in the outcomes list, with this reason, and can be reinstated.</p>
      <Field label="Reason (optional)">
        {/* Enter submits, because this is a one-field form and the confirm is the obvious next act. */}
        <Textarea autoFocus value={note} onChange={(event)=>setNote(event.target.value)} rows={3}
          placeholder={stage.stage_type==='rejected'?'What ruled them out?':'What happened?'}
          onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();onConfirm(note)}}}/>
      </Field>
      <div className="form-actions">
        <Button type="button" variant="quiet" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="caution" loading={loading}>{verb} {candidateName}</Button>
      </div>
    </form>
  </Modal>
}
