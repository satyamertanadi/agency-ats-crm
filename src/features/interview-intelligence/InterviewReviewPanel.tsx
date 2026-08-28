import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Badge} from '../../shared/ui/Page'
import {useToast} from '../../shared/ui/Toast'
import {
  assignCoaching,
  listCoachingActions,
  listFeedback,
  recordFeedback,
  respondToCoaching,
  type CoachingAction,
  type FeedbackEntry,
  type FeedbackType,
} from './reviewRepository'
import {feedbackLabel,coachingStatusLabel} from './reviewPresentation'

/* The human layer under a consultant-quality assessment.
 *
 * Two audiences, one panel, and the difference between them is not cosmetic. A reviewer records a
 * verdict and assigns coaching; the consultant the assessment is about adds context and answers.
 * Neither can do the other's half, and the controls simply are not rendered for the wrong one --
 * rendering a disabled "Assign coaching" to somebody being coached would tell them the product
 * thinks they might.
 *
 * Nothing here can edit a finding, because nothing in the database can.
 */
export function InterviewReviewPanel({organizationId,assessmentId,canReview,isSubject}:{
  organizationId:string
  assessmentId:string
  canReview:boolean
  isSubject:boolean
}){
  const toast=useToast()
  const queryClient=useQueryClient()

  const feedback=useQuery({queryKey:['interview-feedback',assessmentId],queryFn:()=>listFeedback(assessmentId)})
  const coaching=useQuery({queryKey:['interview-coaching',assessmentId],queryFn:()=>listCoachingActions(assessmentId)})

  const refresh=()=>{
    queryClient.invalidateQueries({queryKey:['interview-feedback',assessmentId]})
    queryClient.invalidateQueries({queryKey:['interview-coaching',assessmentId]})
    queryClient.invalidateQueries({queryKey:['interview-attention']})
  }

  return <section className="review-panel">
    <h3>Review</h3>

    {canReview&&<ReviewerControls organizationId={organizationId} assessmentId={assessmentId}
      onDone={()=>{toast.success('Review recorded.');refresh()}}
      onError={(error)=>toast.error(error,'The review was not recorded.')}/>}

    {isSubject&&!canReview&&<ConsultantContext organizationId={organizationId} assessmentId={assessmentId}
      onDone={()=>{toast.success('Your context was added.');refresh()}}
      onError={(error)=>toast.error(error,'Your context was not added.')}/>}

    <FeedbackHistory entries={feedback.data||[]}/>

    <h3>Coaching</h3>
    {canReview&&<AssignCoaching organizationId={organizationId} assessmentId={assessmentId}
      onDone={()=>{toast.success('Coaching assigned.');refresh()}}
      onError={(error)=>toast.error(error,'The coaching was not assigned.')}/>}

    <CoachingList actions={coaching.data||[]} organizationId={organizationId}
      canRespond={isSubject} canCancel={canReview}
      onDone={(message)=>{toast.success(message);refresh()}}
      onError={(error)=>toast.error(error,'The coaching action was not updated.')}/>
  </section>
}

function ReviewerControls({organizationId,assessmentId,onDone,onError}:{
  organizationId:string
  assessmentId:string
  onDone:()=>void
  onError:(error:unknown)=>void
}){
  const [type,setType]=useState<FeedbackType>('reviewed')
  const [note,setNote]=useState('')
  const [privateNote,setPrivateNote]=useState(false)

  const save=useMutation({
    mutationFn:()=>recordFeedback({
      organizationId,assessmentId,feedbackType:type,note:note.trim()||null,
      visibility:privateNote?'reviewers_only':'subject_and_reviewers',
    }),
    onSuccess:()=>{setNote('');setPrivateNote(false);onDone()},
    onError,
  })

  return <div className="review-controls">
    <Field label="Your verdict">
      <Select value={type} onChange={(event)=>setType(event.target.value as FeedbackType)}>
        <option value="reviewed">Reviewed</option>
        <option value="agreed">I agree with this</option>
        <option value="disagreed">I disagree with this</option>
        <option value="discussed">Discussed with the consultant</option>
      </Select>
    </Field>
    <Field label="Note" hint="Optional. Disagreeing does not change the finding — both are kept.">
      <Textarea value={note} rows={2} onChange={(event)=>setNote(event.target.value)} maxLength={4000}/>
    </Field>
    <label className="review-private">
      <input type="checkbox" checked={privateNote} onChange={(event)=>setPrivateNote(event.target.checked)}/>
      {/* Says exactly what stays visible, so nobody believes this hides the assessment. */}
      Keep this note between reviewers. The finding itself stays visible to the consultant.
    </label>
    <Button onClick={()=>save.mutate()} disabled={save.isPending}>
      {save.isPending?'Recording…':'Record review'}
    </Button>
  </div>
}

function ConsultantContext({organizationId,assessmentId,onDone,onError}:{
  organizationId:string
  assessmentId:string
  onDone:()=>void
  onError:(error:unknown)=>void
}){
  const [note,setNote]=useState('')
  const save=useMutation({
    mutationFn:()=>recordFeedback({organizationId,assessmentId,feedbackType:'consultant_context',note:note.trim()||null}),
    onSuccess:()=>{setNote('');onDone()},
    onError,
  })

  return <div className="review-controls">
    <Field label="Add your context" hint="What the analysis could not see. This is kept alongside the findings, not instead of them.">
      <Textarea value={note} rows={3} onChange={(event)=>setNote(event.target.value)} maxLength={4000}
        placeholder="The client ended the call fifteen minutes early…"/>
    </Field>
    <Button onClick={()=>save.mutate()} disabled={save.isPending||!note.trim()}>
      {save.isPending?'Adding…':'Add context'}
    </Button>
  </div>
}

function FeedbackHistory({entries}:{entries:FeedbackEntry[]}){
  if(entries.length===0)return <p className="muted">No review recorded yet.</p>
  return <ul className="review-history">
    {entries.map((entry)=><li key={entry.id}>
      <span className="review-history-meta">
        <Badge tone={entry.feedbackType==='disagreed'?'warn':'neutral'}>{feedbackLabel(entry.feedbackType)}</Badge>
        {entry.visibility==='reviewers_only'&&<Badge tone="info">Reviewers only</Badge>}
      </span>
      {entry.note&&<p>{entry.note}</p>}
    </li>)}
  </ul>
}

function AssignCoaching({organizationId,assessmentId,onDone,onError}:{
  organizationId:string
  assessmentId:string
  onDone:()=>void
  onError:(error:unknown)=>void
}){
  const [text,setText]=useState('')
  const [dueAt,setDueAt]=useState('')

  const save=useMutation({
    mutationFn:()=>assignCoaching({
      organizationId,assessmentId,actionText:text.trim(),
      dueAt:dueAt?new Date(dueAt).toISOString():null,
    }),
    onSuccess:()=>{setText('');setDueAt('');onDone()},
    onError,
  })

  return <div className="review-controls">
    <Field label="What should change next time?" hint="Behavioural and specific. It goes to the consultant this assessment is about.">
      <Textarea value={text} rows={2} onChange={(event)=>setText(event.target.value)} maxLength={2000}
        placeholder="Ask for expected salary before describing the offer process."/>
    </Field>
    <Field label="Due">
      <Input type="date" value={dueAt} onChange={(event)=>setDueAt(event.target.value)}/>
    </Field>
    <Button onClick={()=>save.mutate()} disabled={save.isPending||!text.trim()}>
      {save.isPending?'Assigning…':'Assign coaching'}
    </Button>
  </div>
}

function CoachingList({actions,organizationId,canRespond,canCancel,onDone,onError}:{
  actions:CoachingAction[]
  organizationId:string
  canRespond:boolean
  canCancel:boolean
  onDone:(message:string)=>void
  onError:(error:unknown)=>void
}){
  const [responses,setResponses]=useState<Record<string,string>>({})

  const respond=useMutation({
    mutationFn:({actionId,outcome,response}:{actionId:string;outcome:'acknowledged'|'completed'|'cancelled';response?:string})=>
      respondToCoaching({organizationId,actionId,outcome,response:response??null}),
    onSuccess:(status)=>onDone(status==='cancelled'?'Coaching cancelled.':status==='completed'?'Marked complete.':'Acknowledged.'),
    onError,
  })

  if(actions.length===0)return <p className="muted">No coaching assigned.</p>

  return <ul className="coaching-list">
    {actions.map((action)=>{
      const open=action.status==='open'||action.status==='acknowledged'
      return <li key={action.id}>
        <div className="coaching-headline">
          <strong>{action.actionText}</strong>
          <Badge tone={action.status==='completed'?'good':action.status==='cancelled'?'neutral':'info'}>
            {coachingStatusLabel(action.status)}
          </Badge>
        </div>
        {action.consultantResponse&&<p className="coaching-response">{action.consultantResponse}</p>}

        {canRespond&&open&&<div className="coaching-actions">
          {action.status==='open'&&<Button size="sm" variant="secondary"
            onClick={()=>respond.mutate({actionId:action.id,outcome:'acknowledged'})}>Acknowledge</Button>}
          <Field label="What you did">
            <Input value={responses[action.id]??''} maxLength={4000}
              onChange={(event)=>setResponses((previous)=>({...previous,[action.id]:event.target.value}))}/>
          </Field>
          <Button size="sm" onClick={()=>respond.mutate({actionId:action.id,outcome:'completed',response:responses[action.id]})}>
            Mark complete
          </Button>
        </div>}

        {/* A reviewer can withdraw coaching but cannot complete it for somebody else. */}
        {canCancel&&open&&!canRespond&&<div className="coaching-actions">
          <Button size="sm" variant="quiet" onClick={()=>respond.mutate({actionId:action.id,outcome:'cancelled'})}>Cancel</Button>
        </div>}
      </li>
    })}
  </ul>
}
