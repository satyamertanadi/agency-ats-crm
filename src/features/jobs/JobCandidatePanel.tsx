import {useEffect,useMemo,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {BriefcaseBusiness,CalendarPlus,CheckCircle2,Handshake,Mail,MoveRight,TriangleAlert} from 'lucide-react'
import {Link} from 'react-router'
import {useAuth} from '../../app/AuthProvider'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {convertOfferToPlacement,createInterview,createOffer,listJobHealth,updateInterview,type PlacementFeeSource} from '../core/repository'
import {getCandidateDetail,listCalendarConnections,syncInterviewCalendar} from '../core/commercialRepository'
import type {Interview,Job,JobCandidate,Offer,PipelineStage,Placement} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {Drawer} from '../../shared/ui/Drawer'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {OptionSelect} from '../../shared/ui/OptionSelect'
import {interviewType} from '../../shared/lib/optionSets'
import {Badge,StatusBadge} from '../../shared/ui/Page'
import {useToast} from '../../shared/ui/Toast'
import {consentStatus} from '../../shared/lib/status'
import {formatMoney} from '../../shared/lib/format'
import {groupPipelineStages,isOutcomeStage,recommendedCandidateAction} from '../workflow/workflow'
import type {StageMoveInput} from '../core/useStageMove'
import {JobCandidateLifecycle} from './JobCandidateLifecycle'
import {recordWorkflowEvent} from '../../shared/lib/productAnalytics'

type ActionName='check_feedback'|'check_offer'|'outcome'|'retry_cancel'|'interview'|'offer'|'placement'|'move'

export interface JobCandidatePanelProps {job:Job;item:JobCandidate;stage:PipelineStage;stages:PipelineStage[];currentMemberId?:string;interviews:Interview[];offers:Offer[];placement:Placement|null;hasSubmission:boolean;action:string|null;readOnly:boolean;onAction:(action:string|null)=>void;onClose:()=>void;onUpdated:()=>Promise<unknown>;onMove:(input:StageMoveInput)=>void;moving:boolean;
  onComposeSubmission:()=>void;
  /* The org-wide lists no longer gate the board, so this panel can open before they land -- or after
   * they failed. Empty and not-yet-known are different claims and the panel must not confuse them. */
  detailLoading?:boolean;detailError?:unknown}

const localValue=(date:Date)=>{const offset=date.getTimezoneOffset()*60_000;return new Date(date.valueOf()-offset).toISOString().slice(0,16)}

export function JobCandidatePanel({job,item,stage,stages,currentMemberId,interviews,offers,placement,hasSubmission,action:requestedAction,readOnly,onAction,onClose,onUpdated,onMove,moving,onComposeSubmission,detailLoading=false,detailError}:JobCandidatePanelProps){
  const {organization}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast()
  const details=useQuery({queryKey:['candidate-detail',organization?.id,item.candidate_id],queryFn:()=>getCandidateDetail(organization!.id,item.candidate_id)})
  const connections=useQuery({queryKey:['calendar-connections',organization?.id],queryFn:()=>listCalendarConnections(organization!.id)})
  const startDefault=useMemo(()=>{const start=new Date();start.setDate(start.getDate()+1);start.setHours(9,0,0,0);return start},[])
  const [startsAt,setStartsAt]=useState(localValue(startDefault));const [endsAt,setEndsAt]=useState(localValue(new Date(startDefault.valueOf()+60*60*1000)));const [location,setLocation]=useState('');const [attendeeEmails,setAttendeeEmails]=useState('');const [createMeet,setCreateMeet]=useState(true);const [interviewKind,setInterviewKind]=useState('client_interview')
  // Non-null only while this form is moving an existing interview rather than creating one.
  const [rescheduling,setRescheduling]=useState<Interview|null>(null)
  const [salary,setSalary]=useState('');const [startDate,setStartDate]=useState('');const [fee,setFee]=useState('');const [moveStage,setMoveStage]=useState(item.current_stage_id);const [moveNote,setMoveNote]=useState('')
  /* Which source set the fee is recorded, not inferred. Accepting the suggested figure states the
   * agreement that produced it; typing anything else is a manual price, and saying so is what keeps
   * a later fee-agreement change from making this placement look mispriced. */
  const [feeSource,setFeeSource]=useState<PlacementFeeSource>('manual')
  const privateData=Array.isArray(details.data?.candidate_private_details)?details.data.candidate_private_details[0]:details.data?.candidate_private_details
  useEffect(()=>{if(privateData?.email&&!attendeeEmails)setAttendeeEmails(privateData.email)},[privateData?.email,attendeeEmails])
  const health=useQuery({queryKey:['job-health',organization?.id],enabled:Boolean(organization),queryFn:()=>listJobHealth(organization!.id)})
  const jobHealth=health.data?.find((entry)=>entry.id===job.id)
  const expectedFee=jobHealth?.expected_fee!=null?Number(jobHealth.expected_fee):null
  const expectedSource:PlacementFeeSource|null=jobHealth?.fee_source==='Job override'?'job_override':jobHealth?.fee_source==='Account agreement'?'account_agreement':null
  const acceptedOffer=offers.find((offer)=>offer.status==='accepted');const recommendation=recommendedCandidateAction({stage,hasSubmission,interviews,offers,hasPlacement:Boolean(placement)})
  const calendarConnected=connections.data?.some((connection)=>connection.member_id===currentMemberId&&connection.status==='connected')||false
  const compliant=details.isSuccess&&item.candidates?.status!=='do_not_contact'&&privateData?.consent_status==='granted'
  const trackAction=(eventName:'action_started'|'action_completed'|'action_abandoned',actionKey:string)=>recordWorkflowEvent({organizationId:organization!.id,eventName,surface:'job_candidate_panel',actionKey})
  const refresh=async()=>{await Promise.all([cache.invalidateQueries({queryKey:['interviews',organization?.id]}),cache.invalidateQueries({queryKey:['offers',organization?.id]}),cache.invalidateQueries({queryKey:['placements',organization?.id]}),cache.invalidateQueries({queryKey:['submissions',organization?.id]}),onUpdated()])}
  const candidateName=item.candidates?.full_name||'The candidate'
  /* Reschedule moves the interview that exists; it used to open this same form and call
   * createInterview, so "reschedule" quietly produced a SECOND interview -- two rows on the card, two
   * calendar events, and a client invited twice. updateInterview has existed since the initial schema
   * with nothing calling it. The form is shared deliberately: a reschedule collects exactly the fields
   * a schedule does, and a second near-identical form is how the two drift. */
  const interview=useMutation({mutationFn:async()=>{
    const fields={starts_at:new Date(startsAt).toISOString(),ends_at:new Date(endsAt).toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,location,attendee_emails:attendeeEmails.split(',').map((email)=>email.trim()).filter(Boolean),create_google_meet:createMeet&&calendarConnected}
    if(rescheduling){
      await updateInterview(organization!.id,rescheduling.id,fields)
      // Re-synced for the same reason the create path syncs: an unsynced move leaves the attendees
      // holding an invitation to the old time, which is worse than never having sent one.
      if(calendarConnected)await syncInterviewCalendar(organization!.id,rescheduling.id)
      return rescheduling.id
    }
    const id=await createInterview(organization!.id,user!.id,{job_candidate_id:item.id,starts_at:new Date(startsAt).toISOString(),ends_at:new Date(endsAt).toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,location,attendee_emails:attendeeEmails.split(',').map((email)=>email.trim()).filter(Boolean),create_google_meet:createMeet&&calendarConnected,organizer_member_id:calendarConnected?currentMemberId:undefined,interview_type:interviewKind||'client_interview'})
    if(calendarConnected)await syncInterviewCalendar(organization!.id,id)
    return id
  },onSuccess:async()=>{trackAction('action_completed','interview');toast.success(rescheduling?`Interview moved for ${candidateName}.`:`Interview scheduled for ${candidateName}.`,calendarConnected?'Your Google Calendar is updated.':'Saved in the ATS only — your calendar is not connected.');setRescheduling(null);onAction(null);await refresh()},onError:(error)=>toast.error(error,rescheduling?'The interview was not moved.':'The interview was not scheduled.')})
  const offer=useMutation({mutationFn:()=>createOffer(organization!.id,user!.id,{job_candidate_id:item.id,salary:Number(salary),currency:job.currency||organization!.base_currency,start_date:startDate||undefined}),onSuccess:async()=>{trackAction('action_completed','offer');toast.success(`Offer recorded for ${candidateName}.`);onAction(null);await refresh()},onError:(error)=>toast.error(error,'The offer was not recorded.')})
  const place=useMutation({mutationFn:()=>convertOfferToPlacement(acceptedOffer!.id,Number(fee),90,feeSource),onSuccess:async()=>{trackAction('action_completed','placement');toast.success(`${candidateName} is placed.`,`Fee recorded as ${feeSource==='manual'?'manually priced':feeSource==='job_override'?'a job override':'the account agreement'}.`);onAction(null);await refresh()},onError:(error)=>toast.error(error,'The placement was not recorded.')})
  /* Was its own bare mutation, so a move made here got no optimistic patch, no rollback and no Undo,
   * and the board and the panel wrote the same row through two different code paths -- the exact
   * duplication useStageMove exists to prevent.
   *
   * The mutation is the board's and is passed down, rather than being created again here: it writes
   * the board's ['pipeline', jobId] cache, so the surface that owns that cache should own the write.
   * One instance also means one optimistic patch and one rollback for a row both surfaces render. */
  const submitMove=()=>{
    const target=stages.find((entry)=>entry.id===moveStage)
    onMove({itemId:item.id,stageId:moveStage,name:candidateName,label:target?.name||'a new stage',
      note:moveNote,source:'panel',undo:{stageId:item.current_stage_id,label:stage.name}})
    trackAction('action_completed','move');onAction(null)
  }
  const chooseAction=(value:ActionName)=>{trackAction('action_started',value);setRescheduling(null);onAction(value)};const action=readOnly?null:requestedAction
  const composeSubmission=()=>{trackAction('action_started','submit');onComposeSubmission()}
  /* Pre-filled with the interview's current time, because a reschedule is an edit of a known value --
   * making the consultant retype a slot the card is displaying beside them is how a wrong date gets
   * typed. Retains the same form, in reschedule mode. */
  const startReschedule=(entry:Interview)=>{
    setRescheduling(entry)
    setStartsAt(localValue(new Date(entry.starts_at)));setEndsAt(localValue(new Date(entry.ends_at)))
    setLocation(entry.location||'');setAttendeeEmails((entry.attendee_emails||[]).join(', '))
    trackAction('action_started','interview');onAction('interview')
  }
  const closePanel=()=>{if(action)trackAction('action_abandoned',action);onClose()}
  const showLifecycle=!action||['check_feedback','check_offer','outcome','retry_cancel'].includes(action)
  return <Drawer title={item.candidates?.full_name||'Candidate'} description={`${stage.name} · ${job.title}`} eyebrow="Candidate action" open onClose={closePanel}>
    <div className="candidate-context"><div className="candidate-context-summary"><span className="candidate-context-avatar">{item.candidates?.full_name?.split(/\s+/).slice(0,2).map((part)=>part[0]).join('')}</span><div><strong>{item.candidates?.current_position||'Role not recorded'}</strong><p>{[item.candidates?.current_company,item.candidates?.location].filter(Boolean).join(' · ')||'Profile details need review'}</p></div></div><div className="context-badges"><Badge tone="info">{stage.name}</Badge>{privateData&&<StatusBadge map={consentStatus} value={privateData.consent_status}/>}</div><Link className="record-link" to={`/app/${organization!.slug}/candidates/${item.candidate_id}`}>Open full candidate profile</Link></div>
    <section className="next-action-card"><span><MoveRight size={18}/></span><div><p className="eyebrow">Recommended next action</p><strong>{readOnly?'Waiting':recommendation.label}</strong><p>{readOnly?'This job is closed to recruitment actions. Its history remains available.':recommendation.reason}</p></div>{!readOnly&&<>{recommendation.key==='submit'&&capabilities.data?.canSubmit&&<Button disabled={!compliant} onClick={composeSubmission}>Submit to client</Button>}{recommendation.key==='schedule_interview'&&capabilities.data?.canManageInterviews&&<Button onClick={()=>chooseAction('interview')}>Schedule interview</Button>}{recommendation.key==='record_outcome'&&capabilities.data?.canManageInterviews&&<Button onClick={()=>chooseAction('outcome')}>Record outcome</Button>}{recommendation.key==='record_offer'&&capabilities.data?.canManageOffers&&<Button onClick={()=>chooseAction('offer')}>Record offer</Button>}{recommendation.key==='check_offer'&&capabilities.data?.canManageOffers&&<Button onClick={()=>chooseAction('check_offer')}>Open offer</Button>}{recommendation.key==='create_placement'&&capabilities.data?.canManagePlacements&&<Button onClick={()=>chooseAction('placement')}>Create placement</Button>}{recommendation.key==='check_feedback'&&<Button onClick={()=>chooseAction('check_feedback')}>Check feedback</Button>}</>}</section>
    {!compliant&&<p className="warning-box">Submission is unavailable because consent is not granted or the candidate is marked do not contact. Update the candidate record before sharing information.</p>}
    {/* 'check_feedback' no longer needs a step of its own -- the feedback is on the lifecycle cards
      * below, so choosing it just returns to them rather than opening a screen that restated the
      * question instead of answering it. */}
    {action==='interview'&&<section className="context-action-form"><h3>{rescheduling?'Reschedule interview':'Schedule interview'}</h3><div className="form-grid">{/* The column existed and was hardcoded to 'client_interview' at the only call site, so a phone screen and a final panel were indistinguishable in the record and in any report over it. */}<Field label="Interview type"><OptionSelect label="Interview type" placeholder="Client interview" options={interviewType.options(interviewKind)} value={interviewType.key(interviewKind)} onChange={setInterviewKind}/></Field><Field label="Starts"><Input type="datetime-local" value={startsAt} onChange={(event)=>setStartsAt(event.target.value)}/></Field><Field label="Ends"><Input type="datetime-local" value={endsAt} onChange={(event)=>setEndsAt(event.target.value)}/></Field></div><Field label="Location or call details"><Input value={location} onChange={(event)=>setLocation(event.target.value)}/></Field><Field label="Attendee emails"><Input value={attendeeEmails} onChange={(event)=>setAttendeeEmails(event.target.value)}/></Field><label className="check-row"><input type="checkbox" checked={createMeet} disabled={!calendarConnected} onChange={(event)=>setCreateMeet(event.target.checked)}/><span>Create a Google Meet link and synchronize my Calendar</span></label>{!calendarConnected&&<p className="muted">Calendar is not connected. The interview will still be saved in the ATS.</p>}{interview.error&&<p className="form-error" role="alert">{interview.error.message}</p>}<ActionButtons onCancel={()=>{setRescheduling(null);onAction(null)}} label={rescheduling?'Move interview':'Schedule interview'} loading={interview.isPending} disabled={!startsAt||!endsAt} onSave={()=>interview.mutate()}/></section>}
    {action==='offer'&&<section className="context-action-form"><h3>Record offer</h3><Field label="Salary"><Input type="number" min="0" value={salary} onChange={(event)=>setSalary(event.target.value)}/></Field><Field label="Currency"><Input value={job.currency||organization!.base_currency} disabled/></Field><Field label="Proposed start"><Input type="date" value={startDate} onChange={(event)=>setStartDate(event.target.value)}/></Field>{offer.error&&<p className="form-error" role="alert">{offer.error.message}</p>}<ActionButtons onCancel={()=>onAction(null)} label="Record offer" loading={offer.isPending} disabled={!salary} onSave={()=>offer.mutate()}/></section>}
    {action==='placement'&&<section className="context-action-form"><h3>Create placement</h3>{acceptedOffer?<><p className="success-box"><CheckCircle2 size={15}/>Accepted offer · {formatMoney(acceptedOffer.salary,acceptedOffer.currency)}</p>{expectedFee!=null&&expectedSource
      ?<p className="fee-suggestion"><span>Expected fee <strong>{formatMoney(expectedFee,jobHealth?.currency||job.currency||undefined)}</strong> · {jobHealth?.fee_source}</span><Button size="sm" variant="secondary" type="button" onClick={()=>{setFee(String(expectedFee));setFeeSource(expectedSource)}}>Use this fee</Button></p>
      :<p className="warning-box"><TriangleAlert size={15}/>This job has no agreed fee terms, so the placement fee will be recorded as manually priced.</p>}<Field label="Placement fee"><Input type="number" min="0" value={fee} onChange={(event)=>{setFee(event.target.value);setFeeSource('manual')}}/></Field><p className="muted">Recorded as <strong>{feeSource==='manual'?'manually priced':feeSource==='job_override'?'the job fee override':'the account fee agreement'}</strong>. The 90-day guarantee default will be applied.</p>{place.error&&<p className="form-error" role="alert">{place.error.message}</p>}<ActionButtons onCancel={()=>onAction(null)} label="Create placement" loading={place.isPending} disabled={!fee} onSave={()=>place.mutate()}/></>:<p className="warning-box">An accepted offer is required before creating a placement.</p>}</section>}
    {/* Imported legacy stages remain phase-grouped. Outcome stages stay last and apart because
      * rejecting someone and advancing them are different intentions. */}
    {action==='move'&&<section className="context-action-form"><h3>Move candidate</h3>
      <Field label="Stage"><Select value={moveStage} onChange={(event)=>setMoveStage(event.target.value)}>
        {groupPipelineStages(stages.filter((option)=>!isOutcomeStage(option))).map((phase)=><optgroup key={phase.key} label={phase.label}>{phase.stages.map((option)=><option value={option.id} key={option.id}>{option.name}</option>)}</optgroup>)}
        {stages.some(isOutcomeStage)&&<optgroup label="Outcomes">{stages.filter(isOutcomeStage).map((option)=><option value={option.id} key={option.id}>{option.name}</option>)}</optgroup>}
      </Select></Field>
      <Field label="Reason (optional)"><Textarea value={moveNote} onChange={(event)=>setMoveNote(event.target.value)} placeholder="Why are they moving?"/></Field>
      <ActionButtons onCancel={()=>onAction(null)} label="Move candidate" loading={moving} disabled={moveStage===item.current_stage_id} onSave={submitMove}/></section>}
    {/* Replaces a four-line milestone list that could only say "Recorded" or "Not recorded" -- true
      * statements with no way to act on any of them. Submission and placement stay as one-line facts
      * because both already have their own affordances above; the other four each ended a loop that
      * had no ending. */}
    {showLifecycle&&<section className="context-history">
      <div className="milestone-list"><article><Mail size={15}/><span><strong>Client submission</strong><small>{hasSubmission?'Sent to client':'Not yet sent'}</small></span></article><article><Handshake size={15}/><span><strong>Placement</strong><small>{placement?'Recorded':'Not recorded'}</small></span></article></div>
      {/* Says which it is. "No offer recorded" while the offers query is still in flight, or after it
        * failed, is the panel asserting something it does not know. */}
      {detailError
        ?<Callout tone="warning" title="Some details could not be loaded">Offers, interviews and placements for this candidate are unavailable right now. The pipeline itself is unaffected.</Callout>
        :detailLoading&&<p className="muted">Loading offers, interviews and placements…</p>}
      <JobCandidateLifecycle organizationId={organization!.id} jobCandidateId={item.id} candidateName={candidateName}
        interviews={interviews} offers={offers} canManageInterviews={Boolean(capabilities.data?.canManageInterviews)} canManageOffers={Boolean(capabilities.data?.canManageOffers)} readOnly={readOnly}
        openOutcome={action==='outcome'} onOutcomeClose={()=>onAction(null)} onUpdated={refresh} onReschedule={startReschedule}/>
      {!readOnly&&<div className="context-secondary-actions">{capabilities.data?.canManageInterviews&&<Button variant="secondary" leadingIcon={<CalendarPlus size={14}/>} onClick={()=>chooseAction('interview')}>Interview</Button>}{capabilities.data?.canManageOffers&&<Button variant="secondary" leadingIcon={<BriefcaseBusiness size={14}/>} onClick={()=>chooseAction('offer')}>Offer</Button>}{capabilities.data?.canMovePipeline&&<Button variant="quiet" onClick={()=>chooseAction('move')}>Move stage</Button>}</div>}
    </section>}
  </Drawer>
}

function ActionButtons({onCancel,label,loading,disabled,onSave}:{onCancel:()=>void;label:string;loading:boolean;disabled:boolean;onSave:()=>void}){return <div className="form-actions"><Button variant="quiet" onClick={onCancel}>Cancel</Button><Button loading={loading} disabled={disabled} onClick={onSave}>{label}</Button></div>}
