import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ShieldOff} from 'lucide-react'
import {Drawer} from '../../shared/ui/Drawer'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {ConfirmDialog} from '../../shared/ui/ConfirmDialog'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Badge} from '../../shared/ui/Page'
import {useToast} from '../../shared/ui/Toast'
import {listTeamMembers} from '../core/commercialRepository'
import {
  confirmSpeakers,
  getConsentStatus,
  importTranscript,
  listTranscriptSpeakers,
  listTranscripts,
  recordConsent,
  withdrawConsent,
  type ConsentMethod,
  type NoticeMethod,
  type SpeakerMapping,
  type SpeakerRole,
} from './transcriptRepository'
import {speakerRoleLabel,transcriptLifecycle} from './transcriptPresentation'

/* Consent, import, and speaker mapping for one completed interview.
 *
 * One drawer rather than three, because they are one errand: a consultant finishes an interview and
 * wants it analysed. Splitting them across screens would mean three places to abandon the job
 * half-done, and a half-done job here means a stored recording of a named person that nothing will
 * ever use.
 *
 * The steps are gated in order. Consent is not a step you can skip and come back to -- it gates
 * storage, so the import control does not exist until it is granted.
 */
export function InterviewTranscriptDrawer({organizationId,interviewId,candidateId,candidateName,onClose}:{
  organizationId:string
  interviewId:string
  candidateId:string
  candidateName:string
  onClose:()=>void
}){
  const toast=useToast()
  const queryClient=useQueryClient()

  const consent=useQuery({queryKey:['interview-consent',interviewId],queryFn:()=>getConsentStatus(interviewId)})
  const transcripts=useQuery({queryKey:['interview-transcripts',organizationId,interviewId],queryFn:()=>listTranscripts(organizationId,interviewId)})
  // Fetched here rather than threaded through two components that have no other use for it.
  const {data:members=[]}=useQuery({queryKey:['team-members',organizationId],queryFn:()=>listTeamMembers(organizationId)})

  const refresh=()=>{
    queryClient.invalidateQueries({queryKey:['interview-consent',interviewId]})
    queryClient.invalidateQueries({queryKey:['interview-transcripts',organizationId,interviewId]})
    queryClient.invalidateQueries({queryKey:['interview-transcript-speakers']})
  }

  const lifecycle=transcriptLifecycle({
    featureAvailable:true,
    consent:consent.data??null,
    transcripts:transcripts.data??[],
  })

  const current=(transcripts.data??[]).filter((row)=>!row.supersededBy&&row.status!=='purged')
  const mappingTarget=current.find((row)=>row.unmappedSpeakerCount>0)??current[0]

  return <Drawer
    open
    onClose={onClose}
    eyebrow="Interview transcript"
    title={candidateName}
    description="Consent, transcript, and who spoke. Analysis is a separate step once this is complete."
  >
    <p className="transcript-lifecycle">
      <Badge tone={lifecycle.tone}>{lifecycle.label}</Badge>
      <span>{lifecycle.detail}</span>
    </p>

    {consent.data!=='granted'&&<ConsentSection
      organizationId={organizationId}
      interviewId={interviewId}
      current={consent.data??null}
      onRecorded={()=>{toast.success('Consent recorded.');refresh()}}
      onError={(error)=>toast.error(error,'The consent was not recorded.')}
    />}

    {consent.data==='granted'&&<ImportSection
      organizationId={organizationId}
      interviewId={interviewId}
      onImported={(result)=>{
        if(result.duplicate)toast.info('That transcript was already imported.','The existing copy is being used.')
        else toast.success(`Transcript imported: ${result.entryCount} lines.`,'Map the speakers next.')
        refresh()
      }}
      onError={(error)=>toast.error(error,'The transcript was not imported.')}
    />}

    {mappingTarget&&<SpeakerMappingSection
      organizationId={organizationId}
      transcriptId={mappingTarget.transcriptId}
      candidateId={candidateId}
      candidateName={candidateName}
      members={members}
      onSaved={()=>{toast.success('Speakers mapped.');refresh()}}
      onError={(error)=>toast.error(error,'The speaker mapping was not saved.')}
    />}
  </Drawer>
}

function ConsentSection({organizationId,interviewId,current,onRecorded,onError}:{
  organizationId:string
  interviewId:string
  current:string|null
  onRecorded:()=>void
  onError:(error:unknown)=>void
}){
  const [status,setStatus]=useState<'granted'|'declined'>('granted')
  const [method,setMethod]=useState<ConsentMethod>('spoken')
  const [noticeMethod,setNoticeMethod]=useState<NoticeMethod>('spoken')
  const [evidence,setEvidence]=useState('')
  const [confirmingWithdrawal,setConfirmingWithdrawal]=useState(false)
  const [withdrawalNote,setWithdrawalNote]=useState<string|null>(null)

  const withdraw=useMutation({
    mutationFn:()=>withdrawConsent(organizationId,interviewId,evidence.trim()||null),
    onSuccess:(result)=>{
      setConfirmingWithdrawal(false)
      /* The outcome is reported, never assumed. A legal hold can legitimately stop deletion, and
       * telling somebody their recording is gone when it is not would be the worse failure. */
      setWithdrawalNote(
        result.outcome==='legal_hold'
          ? `Consent withdrawn, but ${result.transcriptsOnLegalHold} transcript${result.transcriptsOnLegalHold===1?'':'s'} could not be deleted because this candidate is under a legal hold. Nothing further will be analysed.`
          : result.outcome==='purged'
            ? `Consent withdrawn. ${result.transcriptsPurged} transcript${result.transcriptsPurged===1?'':'s'} and everything derived from them were deleted.`
            : result.outcome==='already_purged'
              ? 'Consent withdrawn. The transcripts had already been deleted.'
              : 'Consent withdrawn. There was no stored transcript to delete.')
      onRecorded()
    },
    onError,
  })

  const save=useMutation({
    mutationFn:()=>recordConsent({
      organizationId,interviewId,status,consentMethod:method,
      noticeMethod,noticeVersion:null,evidence:evidence.trim()||null,
    }),
    onSuccess:onRecorded,
    onError,
  })

  return <section className="transcript-step">
    <h3>Consent</h3>
    {current==='withdrawn'&&<Callout tone="warning" title="Consent was withdrawn">
      Anything derived from this interview has been removed. Recording a new grant does not restore it.
    </Callout>}
    {withdrawalNote&&<Callout tone="info" title="Withdrawal recorded">{withdrawalNote}</Callout>}
    <Callout tone="info">
      A platform transcription notice is not consent. Record what the candidate actually agreed to.
    </Callout>

    {current==='granted'&&<div className="consent-withdrawal">
      <p className="muted">
        If the candidate asks to withdraw, this deletes the stored transcript and everything derived
        from it, and stops any analysis that has not run yet.
      </p>
      <Button variant="caution" leadingIcon={<ShieldOff size={14}/>}
        onClick={()=>setConfirmingWithdrawal(true)}>Withdraw consent and delete</Button>
    </div>}

    <ConfirmDialog open={confirmingWithdrawal} title="Withdraw consent and delete the transcript?"
      confirmLabel="Withdraw and delete" loading={withdraw.isPending}
      onClose={()=>setConfirmingWithdrawal(false)} onConfirm={()=>withdraw.mutate()}
      body={<>
        <p>The transcript, its speaker mapping, and every assessment, finding and metric derived from it are deleted.</p>
        <p className="muted">The consent record itself is kept, because the history of what was agreed must remain answerable. A legal hold on this candidate will prevent deletion, and you will be told if that happens.</p>
      </>}/>

    <Field label="What did the candidate say?">
      <Select value={status} onChange={(event)=>setStatus(event.target.value as 'granted'|'declined')}>
        <option value="granted">They agreed to the interview being transcribed</option>
        <option value="declined">They declined</option>
      </Select>
    </Field>
    <Field label="How was it given?">
      <Select value={method} onChange={(event)=>setMethod(event.target.value as ConsentMethod)}>
        <option value="spoken">Spoken, on the call</option>
        <option value="written">In writing</option>
        <option value="other">Another way</option>
      </Select>
    </Field>
    <Field label="How were they told?" hint="What the candidate was shown or told, recorded separately from what they agreed to.">
      <Select value={noticeMethod} onChange={(event)=>setNoticeMethod(event.target.value as NoticeMethod)}>
        <option value="spoken">Told on the call</option>
        <option value="written">Sent in writing</option>
        <option value="platform_notice">The meeting tool showed a notice</option>
        <option value="other">Another way</option>
      </Select>
    </Field>
    <Field label="Note" hint="Optional. Where the consent is evidenced — no transcript content.">
      <Input value={evidence} onChange={(event)=>setEvidence(event.target.value)} maxLength={2000}/>
    </Field>

    <Button onClick={()=>save.mutate()} disabled={save.isPending}>
      {save.isPending?'Recording…':'Record consent'}
    </Button>
  </section>
}

function ImportSection({organizationId,interviewId,onImported,onError}:{
  organizationId:string
  interviewId:string
  onImported:(result:{duplicate:boolean;entryCount:number})=>void
  onError:(error:unknown)=>void
}){
  const [text,setText]=useState('')
  const [fileName,setFileName]=useState<string|null>(null)

  const load=async(file:File)=>{
    setFileName(file.name)
    setText(await file.text())
  }

  const submit=useMutation({
    mutationFn:()=>importTranscript({organizationId,interviewId,text,fileName,supersedesTranscriptId:null}),
    onSuccess:(result)=>{setText('');setFileName(null);onImported(result)},
    onError,
  })

  return <section className="transcript-step">
    <h3>Transcript</h3>
    <Field label="Paste the transcript" hint="Plain text, WEBVTT, SRT or JSON. Up to 5 MB.">
      <Textarea value={text} rows={8} onChange={(event)=>{setText(event.target.value);setFileName(null)}}
        placeholder={'Sarah Chen: Tell me about your last role.\nAisha Rahman: I led the commercial team…'}/>
    </Field>
    <Field label="…or choose a file">
      <input type="file" accept=".txt,.vtt,.srt,.json,text/plain,application/json"
        onChange={(event)=>{const file=event.target.files?.[0];if(file)void load(file)}}/>
    </Field>
    <Button onClick={()=>submit.mutate()} disabled={submit.isPending||!text.trim()}>
      {submit.isPending?'Importing…':'Import transcript'}
    </Button>
  </section>
}

function SpeakerMappingSection({organizationId,transcriptId,candidateId,candidateName,members,onSaved,onError}:{
  organizationId:string
  transcriptId:string
  candidateId:string
  candidateName:string
  members:Awaited<ReturnType<typeof listTeamMembers>>
  onSaved:()=>void
  onError:(error:unknown)=>void
}){
  const {data:speakers=[],isLoading}=useQuery({
    queryKey:['interview-transcript-speakers',transcriptId],
    queryFn:()=>listTranscriptSpeakers(transcriptId),
  })

  /* Local until saved, so mapping four speakers is one decision committed once rather than four
   * round trips that can be abandoned halfway. */
  const [choices,setChoices]=useState<Record<string,{role:SpeakerRole;identity:string}>>({})

  const resolved=(speakerId:string,fallbackRole:SpeakerRole,fallbackIdentity:string)=>
    choices[speakerId]??{role:fallbackRole,identity:fallbackIdentity}

  const save=useMutation({
    mutationFn:()=>{
      const mappings:SpeakerMapping[]=speakers.map((speaker)=>{
        const choice=resolved(speaker.id,speaker.speakerRole,speaker.memberId??speaker.candidateId??'')
        const mapping:SpeakerMapping={speaker_id:speaker.id,speaker_role:choice.role}
        if(choice.role==='consultant')mapping.member_id=choice.identity
        if(choice.role==='candidate')mapping.candidate_id=choice.identity||candidateId
        return mapping
      })
      return confirmSpeakers(organizationId,transcriptId,mappings)
    },
    onSuccess:onSaved,
    onError,
  })

  if(isLoading)return <section className="transcript-step"><h3>Speakers</h3><p>Loading speakers…</p></section>

  const incomplete=speakers.some((speaker)=>{
    const choice=resolved(speaker.id,speaker.speakerRole,speaker.memberId??speaker.candidateId??'')
    if(choice.role==='consultant')return !choice.identity
    return false
  })

  return <section className="transcript-step">
    <h3>Speakers</h3>
    <p className="muted">
      These are the labels the meeting tool produced. Say who each one is — “Unknown” is a valid answer,
      and that speech stays visible rather than being counted as somebody else’s.
    </p>
    {speakers.map((speaker)=>{
      const choice=resolved(speaker.id,speaker.speakerRole,speaker.memberId??speaker.candidateId??'')
      return <div key={speaker.id} className="transcript-speaker">
        <div className="transcript-speaker-label">
          <strong>{speaker.displayName||speaker.sourceSpeakerId}</strong>
          {speaker.confirmedAt&&<Badge tone="good">{speakerRoleLabel(speaker.speakerRole)}</Badge>}
        </div>
        <Field label="Role">
          <Select value={choice.role} onChange={(event)=>setChoices((previous)=>({
            ...previous,[speaker.id]:{role:event.target.value as SpeakerRole,identity:event.target.value==='candidate'?candidateId:''},
          }))}>
            <option value="unknown">Unknown</option>
            <option value="consultant">Consultant</option>
            <option value="candidate">Candidate</option>
            <option value="other">Someone else</option>
          </Select>
        </Field>
        {choice.role==='consultant'&&<Field label="Which consultant?">
          <Select value={choice.identity} onChange={(event)=>setChoices((previous)=>({
            ...previous,[speaker.id]:{role:'consultant',identity:event.target.value},
          }))}>
            <option value="">Choose a colleague</option>
            {members.map((member)=><option key={member.id} value={member.id}>
              {member.profiles?.full_name||member.profiles?.email||'Team member'}
            </option>)}
          </Select>
        </Field>}
        {choice.role==='candidate'&&<p className="muted">{candidateName}</p>}
      </div>
    })}
    <Button onClick={()=>save.mutate()} disabled={save.isPending||incomplete}>
      {save.isPending?'Saving…':'Save speaker mapping'}
    </Button>
    {incomplete&&<p className="muted">Choose which colleague each consultant speaker is.</p>}
  </section>
}
