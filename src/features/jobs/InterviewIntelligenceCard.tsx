import {useEffect,useRef,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Sparkles} from 'lucide-react'
import {acceptInterviewNotes,analyzeInterview,getInterviewCoachingReview,getInterviewNotes,getInterviewTranscript,startInterviewTranscript} from '../core/commercialRepository'
import {RUBRIC_LABELS,currentNotesContent,talkSharePercent,transcriptInFlight,type InterviewNotesDraft} from './interviewIntelligence'
import type {Interview} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {Field,Input,Textarea} from '../../shared/ui/Field'
import {StatusBadge} from '../../shared/ui/Page'
import {useToast} from '../../shared/ui/Toast'
import {interviewNotesStatus,rubricRating,transcriptStatus} from '../../shared/lib/status'
import {formatDateTime} from '../../shared/lib/format'

/* What was said in the interview, and what it means -- the two things the record never held.
 *
 * The transcript is the one Google Meet already produced for the call; nothing here records audio.
 * The notes are a draft until a consultant accepts them, which is the same gate every other AI
 * output in this product ends with. The coaching review of the consultant who ran the interview is
 * fetched separately and rendered only for members the database will actually return it to.
 */

export interface InterviewIntelligenceCardProps {
  organizationId:string
  interview:Interview
  candidateName:string
  canManage:boolean
  canViewCoaching:boolean
  onUpdated:()=>Promise<unknown>
}

export function InterviewIntelligenceCard({organizationId,interview,candidateName,canManage,canViewCoaching,onUpdated}:InterviewIntelligenceCardProps){
  const toast=useToast()
  const queryClient=useQueryClient()
  const [edited,setEdited]=useState<InterviewNotesDraft|null>(null)
  // Auto-generation is allowed exactly once per mounted card. A transcript row only exists because
  // somebody asked for it, so generating notes the moment it lands is what they asked for -- but a
  // failed generation must not re-fire on the next poll and bill for the same failure repeatedly.
  const analyzeAttempted=useRef(false)

  const transcript=useQuery({
    queryKey:['interview-transcript',organizationId,interview.id],
    queryFn:()=>getInterviewTranscript(organizationId,interview.id),
    refetchInterval:(query)=>transcriptInFlight(query.state.data?.status)?4000:false,
  })
  const notes=useQuery({
    queryKey:['interview-notes',organizationId,interview.id],
    queryFn:()=>getInterviewNotes(organizationId,interview.id),
  })
  const coaching=useQuery({
    queryKey:['interview-coaching',organizationId,notes.data?.id],
    enabled:Boolean(canViewCoaching&&notes.data?.id),
    queryFn:()=>getInterviewCoachingReview(organizationId,notes.data!.id),
  })

  const fetchTranscript=useMutation({
    mutationFn:()=>startInterviewTranscript(organizationId,interview.id),
    onSuccess:async()=>{analyzeAttempted.current=false;await queryClient.invalidateQueries({queryKey:['interview-transcript',organizationId,interview.id]})},
    onError:(error)=>toast.error(error,'The transcript was not retrieved.'),
  })
  const generate=useMutation({
    mutationFn:(force:boolean)=>analyzeInterview(organizationId,interview.id,force),
    onSuccess:async(result)=>{
      setEdited(null)
      if(result.degraded)toast.error(new Error('AI notes could not be written because the provider is unavailable. The draft is empty for you to fill in.'),'The interview was not analyzed.')
      await queryClient.invalidateQueries({queryKey:['interview-notes',organizationId,interview.id]})
    },
    onError:(error)=>toast.error(error,'The interview notes were not generated.'),
  })
  const accept=useMutation({
    mutationFn:(content:InterviewNotesDraft)=>acceptInterviewNotes(organizationId,notes.data!.id,content),
    onSuccess:async()=>{
      setEdited(null)
      toast.success(`Interview notes accepted for ${candidateName}.`,'The summary now appears on the interview record.')
      await Promise.all([queryClient.invalidateQueries({queryKey:['interview-notes',organizationId,interview.id]}),onUpdated()])
    },
    onError:(error)=>toast.error(error,'The interview notes were not accepted.'),
  })

  const transcriptRow=transcript.data
  const notesRow=notes.data
  useEffect(()=>{
    if(!canManage||analyzeAttempted.current)return
    if(transcriptRow?.status!=='ready'||notesRow||notes.isLoading||generate.isPending)return
    analyzeAttempted.current=true
    generate.mutate(false)
  },[canManage,transcriptRow?.status,notesRow,notes.isLoading,generate])

  const content=notesRow?edited||currentNotesContent(notesRow):null
  const share=transcriptRow?talkSharePercent(transcriptRow.talk_time):null
  const patch=(change:Partial<InterviewNotesDraft['summary']>&{recommendation_note?:string})=>{
    if(!content)return
    const {recommendation_note,...summaryChange}=change
    setEdited({
      ...content,
      summary:{...content.summary,...summaryChange},
      candidate_assessment:{...content.candidate_assessment,...(recommendation_note===undefined?{}:{recommendation_note})},
    })
  }

  return <section className="lifecycle-card interview-intelligence">
    <h3><Sparkles size={15}/>Interview notes</h3>
    <p className="muted interview-intelligence-subject">{formatDateTime(interview.starts_at)}</p>

    {!interview.meeting_url
      ? <p className="muted">This interview has no Google Meet link, so there is no transcript to read.</p>
      : <>
        <div className="interview-intelligence-transcript">
          {transcript.isLoading?<p className="muted">Checking for a transcript…</p>
            :transcript.error?<Callout tone="danger">The transcript status could not be loaded.</Callout>
            :transcriptRow?<>
              <p className="lifecycle-headline">
                <StatusBadge map={transcriptStatus} value={transcriptRow.status}/>
                {transcriptRow.status==='ready'&&<span className="muted">{transcriptRow.entry_count} lines · {Math.max(1,Math.round(transcriptRow.duration_seconds/60))} min{transcriptRow.language?` · ${transcriptRow.language}`:''}</span>}
              </p>
              {/* Measured from the transcript timings, so it is a fact about the call rather than an
                * impression of it -- and it is the number the coaching rubric is told to use. */}
              {share&&transcriptRow.status==='ready'&&<p className="muted">Talk time — consultant {share.consultant}%, candidate {share.candidate}%{share.other?`, unidentified ${share.other}%`:''}</p>}
              {transcriptRow.status==='unavailable'&&<Callout tone="info">
                Google Meet produced no transcript for this call. Transcription is started by the meeting host and has to be on before the interview begins.
              </Callout>}
              {transcriptRow.status==='failed'&&<Callout tone="danger" title={transcriptRow.failure_code==='calendar_reauthorization_required'?'Reconnect Google':undefined}>
                {transcriptRow.failure_message||'The transcript could not be retrieved.'}
                {transcriptRow.failure_code==='calendar_reauthorization_required'&&' Meet transcripts need a permission that was added after this account connected — reconnect Google Calendar in workspace settings.'}
              </Callout>}
              {transcriptInFlight(transcriptRow.status)&&<p className="muted">Meet publishes a transcript a few minutes after the call ends. This keeps checking on its own.</p>}
            </>
            :<p className="muted">No transcript has been retrieved for this interview yet.</p>}

          {canManage&&!transcriptInFlight(transcriptRow?.status)&&<div className="lifecycle-actions">
            <Button size="sm" variant="secondary" loading={fetchTranscript.isPending} onClick={()=>fetchTranscript.mutate()}>
              {transcriptRow?'Check again':'Get transcript'}
            </Button>
          </div>}
        </div>

        {notesRow&&content&&<div className="interview-intelligence-notes">
          <p className="lifecycle-headline">
            <StatusBadge map={interviewNotesStatus} value={notesRow.status}/>
            {notesRow.score!==null&&<span className="muted">Requirement match {Math.round(notesRow.score)}%</span>}
          </p>
          {notesRow.degraded_reason&&<Callout tone="warning">
            The AI provider was unavailable when this ran, so the draft is empty. Write the summary yourself, or generate again once the provider is back.
          </Callout>}

          {notesRow.status==='draft'&&canManage
            ? <Field label="Summary"><Input value={content.summary.headline} onChange={(event)=>patch({headline:event.target.value})}/></Field>
            : <p><strong>{content.summary.headline}</strong></p>}

          {notesRow.status==='draft'&&canManage
            ? <Field label="Key points (one per line)">
                <Textarea rows={4} value={content.summary.key_points.join('\n')} onChange={(event)=>patch({key_points:event.target.value.split('\n')})}/>
              </Field>
            : content.summary.key_points.length>0&&<ul className="lifecycle-list">{content.summary.key_points.map((point,index)=><li key={index}>{point}</li>)}</ul>}

          <Logistics logistics={content.summary.logistics}/>

          {content.candidate_assessment.requirement_evidence.length>0&&<details className="interview-intelligence-evidence">
            <summary>Requirement evidence ({content.candidate_assessment.requirement_evidence.length})</summary>
            <ul className="lifecycle-list">
              {content.candidate_assessment.requirement_evidence.map((item,index)=><li key={index}>
                <span><strong>{item.requirement}</strong><span className="muted"> · {item.classification}</span></span>
                {/* The quote is the whole point: a finding with nothing behind it is an inference. */}
                {item.quote&&<small className="muted">“{item.quote}”</small>}
                {item.explanation&&<p>{item.explanation}</p>}
              </li>)}
            </ul>
          </details>}

          {content.candidate_assessment.open_questions.length>0&&<details className="interview-intelligence-evidence">
            <summary>Still to validate ({content.candidate_assessment.open_questions.length})</summary>
            <ul className="lifecycle-list">{content.candidate_assessment.open_questions.map((question,index)=><li key={index}>{question}</li>)}</ul>
          </details>}

          {notesRow.status==='draft'&&canManage
            ? <Field label="Next step"><Textarea rows={3} value={content.candidate_assessment.recommendation_note} onChange={(event)=>patch({recommendation_note:event.target.value})}/></Field>
            : content.candidate_assessment.recommendation_note&&<p>{content.candidate_assessment.recommendation_note}</p>}

          {canManage&&<div className="lifecycle-actions">
            {notesRow.status==='draft'&&<Button size="sm" variant="primary" loading={accept.isPending} onClick={()=>accept.mutate(content)}>Accept notes</Button>}
            <Button size="sm" variant="quiet" loading={generate.isPending} onClick={()=>generate.mutate(true)}>Generate again</Button>
          </div>}
          {notesRow.status==='accepted'&&notesRow.accepted_at&&<p className="muted">Accepted {formatDateTime(notesRow.accepted_at)}.</p>}
        </div>}

        {transcriptRow?.status==='ready'&&!notesRow&&!notes.isLoading&&<p className="muted">
          {generate.isPending?'Reading the transcript…':'No notes have been generated for this transcript yet.'}
        </p>}

        {/* Rendered only where interview_coaching.read is granted. The query is not even issued
          * otherwise, so a consultant never sees an empty section hinting at what is being withheld. */}
        {canViewCoaching&&coaching.data&&<div className="interview-intelligence-coaching">
          <h4>Interviewing performance</h4>
          <p className="muted">How this interview was conducted. Visible to workspace owners and admins only.</p>
          <p className="lifecycle-headline"><strong>{coaching.data.rating_summary.index}%</strong><span className="muted">across {coaching.data.rubric.filter((entry)=>entry.rating!=='not_observed').length} observed criteria</span></p>
          <ul className="lifecycle-list">
            {coaching.data.rubric.map((entry)=><li key={entry.criterion}>
              <span><strong>{RUBRIC_LABELS[entry.criterion]||entry.criterion}</strong><StatusBadge map={rubricRating} value={entry.rating}/></span>
              {entry.evidence_quote&&<small className="muted">“{entry.evidence_quote}”</small>}
              {entry.coaching_note&&<p>{entry.coaching_note}</p>}
            </li>)}
          </ul>
          {coaching.data.missed_topics.length>0&&<p className="muted">Not raised: {coaching.data.missed_topics.join(', ')}</p>}
        </div>}
      </>}
  </section>
}

function Logistics({logistics}:{logistics:InterviewNotesDraft['summary']['logistics']}){
  const stated=[
    ['Notice period',logistics.notice_period],['Salary expectation',logistics.salary_expectation],
    ['Location',logistics.location_preference],['Availability',logistics.availability],
  ].filter(([,value])=>Boolean(value))
  // An empty field means the topic never came up, which is worth nothing on screen and is already
  // reported as a missed topic in the coaching rubric.
  if(!stated.length)return null
  return <dl className="interview-intelligence-logistics">
    {stated.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>
}
