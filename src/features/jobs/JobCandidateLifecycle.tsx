import {useState} from 'react'
import {useMutation,useQuery} from '@tanstack/react-query'
import {BriefcaseBusiness,CalendarPlus,History,MessageSquare} from 'lucide-react'
import {cancelInterview,completeInterview,listStageHistory,listSubmissionFeedback,updateOfferStatus} from '../core/repository'
import type {Interview,Offer} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {ConfirmDialog} from '../../shared/ui/ConfirmDialog'
import {Field,Select,Textarea} from '../../shared/ui/Field'
import {StatusBadge} from '../../shared/ui/Page'
import {useToast} from '../../shared/ui/Toast'
import {feedbackDecision,interviewStatus,offerStatus} from '../../shared/lib/status'
import {formatDateTime,formatMoney} from '../../shared/lib/format'

/* The four things that were true about a candidate but unreachable from the surface built to work
 * them, replacing a static four-line "Recruitment milestones" list that could only ever say
 * "Recorded" or "Not recorded".
 *
 * Each card is the end of a loop that previously had no end: an offer could be presented but never
 * accepted, an interview scheduled but never resolved, a client could answer and nobody would see it,
 * and a stage could change for a reason nobody could read back. */

export interface JobCandidateLifecycleProps {
  organizationId:string
  jobCandidateId:string
  candidateName:string
  interviews:Interview[]
  offers:Offer[]
  canManageInterviews:boolean
  canManageOffers:boolean
  readOnly:boolean
  onUpdated:()=>Promise<unknown>
  /* Reschedule reuses the panel's existing interview form rather than growing a second one that can
   * drift from it -- the panel owns that form, so it owns reopening it. */
  onReschedule:(interview:Interview)=>void
}

type OfferDecision='accepted'|'declined'|'withdrawn'
const offerDecisions:Array<{value:OfferDecision;label:string}>=[
  {value:'accepted',label:'Accepted'},{value:'declined',label:'Declined'},{value:'withdrawn',label:'Withdrawn'},
]

export function JobCandidateLifecycle({organizationId,jobCandidateId,candidateName,interviews,offers,canManageInterviews,canManageOffers,readOnly,onUpdated,onReschedule}:JobCandidateLifecycleProps){
  const toast=useToast()
  const [offerDecision,setOfferDecision]=useState<{offer:Offer;decision:OfferDecision}|null>(null)
  const [offerNote,setOfferNote]=useState('')
  const [cancelling,setCancelling]=useState<Interview|null>(null)
  const [completing,setCompleting]=useState<Interview|null>(null)
  const [outcome,setOutcome]=useState<'completed'|'no_show'>('completed')
  const [outcomeNotes,setOutcomeNotes]=useState('')

  const feedback=useQuery({queryKey:['submission-feedback',organizationId,jobCandidateId],queryFn:()=>listSubmissionFeedback(organizationId,jobCandidateId)})
  const history=useQuery({queryKey:['stage-history',organizationId,jobCandidateId],queryFn:()=>listStageHistory(organizationId,jobCandidateId)})

  const decideOffer=useMutation({
    mutationFn:({offer,decision}:{offer:Offer;decision:OfferDecision})=>updateOfferStatus(organizationId,offer.id,decision,offerNote),
    onSuccess:async(_result,{decision})=>{
      setOfferDecision(null);setOfferNote('')
      /* Accepting is the one that unblocks something, so the confirmation says so -- the placement
       * affordance behind it has been built and unreachable this whole time. */
      toast.success(`The offer for ${candidateName} was marked ${decision}.`,decision==='accepted'?'You can now create the placement.':undefined)
      await onUpdated()
    },
    onError:(error)=>toast.error(error,'The offer status was not changed.'),
  })
  const finishInterview=useMutation({
    mutationFn:(interview:Interview)=>completeInterview(organizationId,interview.id,{outcome,notes:outcomeNotes}),
    onSuccess:async()=>{setCompleting(null);setOutcomeNotes('');setOutcome('completed');toast.success(`Interview outcome recorded for ${candidateName}.`);await onUpdated()},
    onError:(error)=>toast.error(error,'The interview outcome was not recorded.'),
  })
  const dropInterview=useMutation({
    mutationFn:(interview:Interview)=>cancelInterview(organizationId,interview.id),
    onSuccess:async()=>{setCancelling(null);toast.success(`Interview cancelled for ${candidateName}.`);await onUpdated()},
    onError:(error)=>toast.error(error,'The interview was not cancelled.'),
  })

  const latestOffer=offers[0]
  const offersActive=canManageOffers&&!readOnly
  const interviewsActive=canManageInterviews&&!readOnly

  return <div className="lifecycle-cards">
    <section className="lifecycle-card">
      <h3><BriefcaseBusiness size={15}/>Offer</h3>
      {latestOffer?<>
        <p className="lifecycle-headline"><strong>{formatMoney(latestOffer.salary,latestOffer.currency)}</strong><StatusBadge map={offerStatus} value={latestOffer.status}/></p>
        {latestOffer.notes&&<p className="muted">{latestOffer.notes}</p>}
        {/* The dead end this whole card exists to remove: 'presented' was terminal in the UI, so the
          * fee-provenance placement flow behind it could never be reached and Today kept a permanent
          * row chasing an offer that had already been answered. */}
        {latestOffer.status==='presented'&&offersActive&&<div className="lifecycle-actions">
          {offerDecisions.map((option)=><Button key={option.value} size="sm" variant={option.value==='accepted'?'primary':'secondary'}
            onClick={()=>{setOfferNote('');setOfferDecision({offer:latestOffer,decision:option.value})}}>{option.label}</Button>)}
        </div>}
      </>:<p className="muted">No offer recorded.</p>}
    </section>

    <section className="lifecycle-card">
      <h3><CalendarPlus size={15}/>Interviews</h3>
      {interviews.length===0?<p className="muted">No interview scheduled.</p>:<ul className="lifecycle-list">
        {interviews.map((entry)=><li key={entry.id}>
          <span><strong>{formatDateTime(entry.starts_at)}</strong><StatusBadge map={interviewStatus} value={entry.status}/></span>
          {entry.notes&&<small className="muted">{entry.notes}</small>}
          {entry.status==='scheduled'&&interviewsActive&&<div className="lifecycle-actions">
            <Button size="sm" variant="secondary" onClick={()=>{setOutcome('completed');setOutcomeNotes('');setCompleting(entry)}}>Complete</Button>
            <Button size="sm" variant="quiet" onClick={()=>onReschedule(entry)}>Reschedule</Button>
            <Button size="sm" variant="quiet" onClick={()=>setCancelling(entry)}>Cancel</Button>
          </div>}
        </li>)}
      </ul>}
    </section>

    <section className="lifecycle-card">
      <h3><MessageSquare size={15}/>Client review</h3>
      {/* Was a static sentence telling the consultant to go "review recent activity", while the
        * client's actual answer sat unread in submission_feedback. */}
      {feedback.isLoading?<p className="muted">Loading feedback…</p>
        :feedback.error?<Callout tone="danger">The client's feedback could not be loaded.</Callout>
        :feedback.data?.length?<ul className="lifecycle-list">
          {feedback.data.map((entry)=><li key={entry.id}>
            <span><StatusBadge map={feedbackDecision} value={entry.decision}/><small className="muted">{entry.reviewer_name||'The client'} · {formatDateTime(entry.created_at)}</small></span>
            {entry.comments&&<p>{entry.comments}</p>}
          </li>)}
        </ul>:<p className="muted">The client has not responded yet.</p>}
    </section>

    <section className="lifecycle-card">
      <h3><History size={15}/>Stage history</h3>
      {history.isLoading?<p className="muted">Loading history…</p>
        :history.data?.length?<ol className="stage-timeline">
          {history.data.map((entry)=><li key={entry.id}>
            <span><strong>{entry.from_stage?`${entry.from_stage.name} → ${entry.to_stage?.name??'a new stage'}`:`Added at ${entry.to_stage?.name??'a stage'}`}</strong><small className="muted">{formatDateTime(entry.occurred_at)}</small></span>
            {/* The reason, finally readable. p_note was written on every move and shown nowhere. */}
            {entry.note&&<p>{entry.note}</p>}
          </li>)}
        </ol>:<p className="muted">No stage changes recorded yet.</p>}
    </section>

    <ConfirmDialog open={Boolean(offerDecision)} title={offerDecision?`Mark the offer ${offerDecision.decision}?`:''}
      confirmLabel={offerDecision?`Mark ${offerDecision.decision}`:'Confirm'} loading={decideOffer.isPending}
      onClose={()=>setOfferDecision(null)} onConfirm={()=>offerDecision&&decideOffer.mutate(offerDecision)}
      body={<div className="stack">
        <p>{candidateName}&rsquo;s offer of {latestOffer?formatMoney(latestOffer.salary,latestOffer.currency):'this amount'} will be recorded as {offerDecision?.decision}.</p>
        <Field label="Note (optional)"><Textarea value={offerNote} onChange={(event)=>setOfferNote(event.target.value)} placeholder="What did they say?"/></Field>
      </div>}/>

    <ConfirmDialog open={Boolean(completing)} title="Record interview outcome" confirmLabel="Record outcome"
      loading={finishInterview.isPending} onClose={()=>setCompleting(null)} onConfirm={()=>completing&&finishInterview.mutate(completing)}
      body={<div className="stack">
        <Field label="What happened"><Select value={outcome} onChange={(event)=>setOutcome(event.target.value as 'completed'|'no_show')}>
          <option value="completed">The interview went ahead</option><option value="no_show">The candidate did not attend</option>
        </Select></Field>
        <Field label="Notes (optional)"><Textarea value={outcomeNotes} onChange={(event)=>setOutcomeNotes(event.target.value)} placeholder="How did it go?"/></Field>
      </div>}/>

    <ConfirmDialog open={Boolean(cancelling)} title="Cancel this interview?" confirmLabel="Cancel interview"
      loading={dropInterview.isPending} onClose={()=>setCancelling(null)} onConfirm={()=>cancelling&&dropInterview.mutate(cancelling)}
      body={<p>The interview on {formatDateTime(cancelling?.starts_at)} will be marked cancelled. Attendees are not emailed automatically — tell them yourself.</p>}/>
  </div>
}
