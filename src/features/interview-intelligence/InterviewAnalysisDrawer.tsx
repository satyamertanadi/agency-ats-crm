import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Drawer} from '../../shared/ui/Drawer'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {Badge} from '../../shared/ui/Page'
import {Tabs} from '../../shared/ui/Tabs'
import {useToast} from '../../shared/ui/Toast'
import {getAnalysisState,getConversationMetrics,listAssessments,requestAnalysis,type Assessment,type AnalysisFinding} from './analysisRepository'
import {getTranscriptPage,listTranscripts} from './transcriptRepository'
import {
  analysisStatusLine,
  candidateBand,
  confidenceLabel,
  consultantBand,
  dimensionLabel,
  formatDuration,
  formatShare,
  groupCandidateFindings,
  metricsAreUsable,
  metricsUnavailableReason,
  resultLabel,
  speakingShares,
} from './analysisPresentation'
import {formatOffset} from './transcriptPresentation'

/* The analysis, as a consultant reads it.
 *
 * Three tabs because there are three questions: what the evidence says about the candidate, how the
 * interview was conducted, and what was actually said. The coaching tab simply does not exist for a
 * viewer whose RLS returns no consultant-quality assessment -- an empty section labelled "Coaching"
 * tells a colleague that findings about them exist and are being withheld, which is worse than not
 * mentioning it.
 *
 * Nothing here renders raw model output, a prompt, or a percentage of fit.
 */
export function InterviewAnalysisDrawer({organizationId,interviewId,candidateName,onClose}:{
  organizationId:string
  interviewId:string
  candidateName:string
  onClose:()=>void
}){
  const toast=useToast()
  const queryClient=useQueryClient()
  const [tab,setTab]=useState('candidate')

  const state=useQuery({
    queryKey:['interview-analysis-state',organizationId,interviewId],
    queryFn:()=>getAnalysisState(organizationId,interviewId),
    // A queued or processing run finishes without anything else changing on the page, so this is the
    // one place a poll is the honest mechanism rather than a workaround.
    refetchInterval:(query)=>{
      const status=query.state.data?.status
      return status==='queued'||status==='processing'?4000:false
    },
  })

  const runId=state.data?.status==='completed'?state.data.runId:null

  const assessments=useQuery({
    queryKey:['interview-assessments',runId],
    queryFn:()=>runId?listAssessments(runId):Promise.resolve([]),
    enabled:Boolean(runId),
  })

  const metrics=useQuery({
    queryKey:['interview-metrics',runId],
    queryFn:()=>runId?getConversationMetrics(runId):Promise.resolve({speakers:[],summary:null}),
    enabled:Boolean(runId),
  })

  const analyse=useMutation({
    mutationFn:()=>requestAnalysis(organizationId,interviewId),
    onSuccess:(result)=>{
      toast.success(result.reused?'That analysis already exists.':'Analysis queued.',result.reused?undefined:'It usually takes under a minute.')
      queryClient.invalidateQueries({queryKey:['interview-analysis-state',organizationId,interviewId]})
    },
    onError:(error)=>toast.error(error,'The analysis could not be requested.'),
  })

  const candidate=(assessments.data||[]).find((entry)=>entry.assessmentType==='candidate_fit')
  const consultantAssessments=(assessments.data||[]).filter((entry)=>entry.assessmentType==='consultant_quality')
  const status=analysisStatusLine({status:state.data?.status??null,isStale:Boolean(state.data?.isStale),errorCode:state.data?.errorCode??null})

  const tabs=[
    {id:'candidate',label:'Candidate fit'},
    // Present only when there is something to show. RLS decides, not the client.
    ...(consultantAssessments.length?[{id:'coaching',label:consultantAssessments.length>1?'Interview quality':'My coaching'}]:[]),
    {id:'transcript',label:'Transcript'},
  ]

  return <Drawer
    open
    onClose={onClose}
    eyebrow="Interview analysis"
    title={candidateName}
    description="Evidence from this interview. Every conclusion is a starting point for your judgement, not a decision."
  >
    <p className="analysis-status">
      <Badge tone={status.tone}>{status.label}</Badge>
      {status.detail&&<span>{status.detail}</span>}
    </p>

    {state.data?.isStale&&<Callout tone="warning" title="The inputs have changed">
      This is still the previous analysis. Nothing was re-run automatically — request a new one if the
      change matters.
    </Callout>}

    {(!state.data?.runId||state.data.status==='failed'||state.data.isStale)&&
      <Button variant="secondary" onClick={()=>analyse.mutate()} disabled={analyse.isPending||!state.data?.hasTranscripts}>
        {analyse.isPending?'Requesting…':state.data?.runId?'Request a new analysis':'Analyse this interview'}
      </Button>}

    {runId&&<>
      <Tabs items={tabs} value={tab} onChange={setTab} label="Analysis sections"/>

      {tab==='candidate'&&<CandidateFit assessment={candidate}/>}
      {tab==='coaching'&&<ConsultantQuality assessments={consultantAssessments} metrics={metrics.data}/>}
      {tab==='transcript'&&<TranscriptTab organizationId={organizationId} interviewId={interviewId}/>}
    </>}
  </Drawer>
}

function CandidateFit({assessment}:{assessment:Assessment|undefined}){
  if(!assessment)return <p className="muted">No candidate assessment was produced.</p>
  const band=candidateBand(assessment.overallBand)
  const groups=groupCandidateFindings(assessment.findings)

  return <section className="analysis-section">
    <div className="analysis-headline">
      <Badge tone={band.tone}>{band.label}</Badge>
      <span className="muted">{confidenceLabel(assessment.confidence)}</span>
    </div>
    <p>{assessment.summary}</p>

    {groups.requirements.length>0&&<>
      <h3>Requirements</h3>
      <div className="analysis-requirements">
        {groups.requirements.map((finding)=><RequirementRow key={finding.id} finding={finding}/>)}
      </div>
    </>}

    <FindingList title="Strongest evidence" findings={groups.strongestEvidence}/>
    <FindingList title="Contradictions" findings={groups.contradictions}/>
    <FindingList title="Missing information" findings={groups.missingInformation}/>
    <FindingList title="Worth verifying" findings={groups.verification}/>
  </section>
}

function RequirementRow({finding}:{finding:AnalysisFinding}){
  const result=resultLabel(finding.result)
  return <article className="analysis-requirement">
    <header>
      <strong>{finding.title}</strong>
      <span className="analysis-requirement-meta">
        <Badge tone={result.tone}>{result.label}</Badge>
        <span className="muted">{confidenceLabel(finding.confidence)}</span>
      </span>
    </header>
    <p>{finding.summary}</p>
    {/* On a candidate finding this column carries what to verify, not coaching. */}
    {finding.coachingSuggestion&&<p className="analysis-verify">Ask next: {finding.coachingSuggestion}</p>}
    <EvidenceList evidence={finding.evidence}/>
  </article>
}

function ConsultantQuality({assessments,metrics}:{
  assessments:Assessment[]
  metrics:{speakers:import('./analysisRepository').SpeakerMetric[];summary:import('./analysisRepository').MetricSummary|null}|undefined
}){
  return <section className="analysis-section">
    {/* Each consultant is assessed separately: collapsing two into one subject would attribute one
        colleague's behaviour to the other. */}
    {assessments.map((assessment)=>{
      const band=consultantBand(assessment.overallBand)
      return <article key={assessment.id} className="analysis-consultant">
        <div className="analysis-headline">
          <Badge tone={band.tone}>{band.label}</Badge>
          <span className="muted">{confidenceLabel(assessment.confidence)}</span>
        </div>
        <p>{assessment.summary}</p>
        {assessment.findings.map((finding)=><article key={finding.id} className="analysis-dimension">
          <header>
            <strong>{dimensionLabel(finding.category)}</strong>
            <Badge tone={resultLabel(finding.result).tone}>{resultLabel(finding.result).label}</Badge>
          </header>
          <p className="analysis-dimension-title">{finding.title}</p>
          <p>{finding.summary}</p>
          {finding.coachingSuggestion&&<p className="analysis-coaching">Try: {finding.coachingSuggestion}</p>}
          <EvidenceList evidence={finding.evidence}/>
        </article>)}
      </article>
    })}

    <h3>Speaking balance</h3>
    <SpeakingBalance metrics={metrics}/>
  </section>
}

function SpeakingBalance({metrics}:{
  metrics:{speakers:import('./analysisRepository').SpeakerMetric[];summary:import('./analysisRepository').MetricSummary|null}|undefined
}){
  if(!metrics)return <p className="muted">Loading…</p>
  if(!metricsAreUsable(metrics.summary)){
    // Says why rather than showing a ratio nobody should act on.
    return <p className="muted">{metricsUnavailableReason(metrics.summary)}</p>
  }
  const shares=speakingShares(metrics.speakers)
  return <>
    <table className="analysis-metrics">
      <thead><tr><th scope="col">Speaker</th><th scope="col">Share</th><th scope="col">Speaking time</th><th scope="col">Turns</th><th scope="col">Longest turn</th></tr></thead>
      <tbody>
        {metrics.speakers.map((speaker)=><tr key={speaker.speakerId}>
          <td>{speaker.speakerRole}</td>
          <td>{formatShare(shares.get(speaker.speakerId)??null)}</td>
          <td>{formatDuration(speaker.speechMs)}</td>
          <td>{speaker.turnCount}</td>
          <td>{formatDuration(speaker.longestTurnMs)}</td>
        </tr>)}
      </tbody>
    </table>
    {/* The plan is explicit that there is no universal ideal ratio, so the interface must not imply
        one by, say, colouring a row red. */}
    <p className="muted">There is no ideal ratio. This is context for the findings above, not a score.</p>
  </>
}

function EvidenceList({evidence}:{evidence:AnalysisFinding['evidence']}){
  if(evidence.length===0)return null
  return <ul className="analysis-evidence">
    {evidence.map((item)=><li key={item.id}>
      <span className="analysis-evidence-source">{sourceLabel(item.sourceType,item.sourceLocator)}</span>
      {item.excerpt&&<q>{item.excerpt}</q>}
    </li>)}
  </ul>
}

function sourceLabel(sourceType:string,locator:string|null){
  if(sourceType==='transcript_entry')return 'From the interview'
  if(sourceType==='candidate_cv')return 'From the CV'
  if(sourceType==='candidate_field')return `From the candidate record${locator?` (${locator.replace(/_/g,' ')})`:''}`
  return 'From the job brief'
}

function FindingList({title,findings}:{title:string;findings:AnalysisFinding[]}){
  if(findings.length===0)return null
  return <>
    <h3>{title}</h3>
    <ul className="analysis-list">{findings.map((finding)=><li key={finding.id}>{finding.summary}</li>)}</ul>
  </>
}

/* Paged, never loaded whole. A two-hour panel is thousands of lines, and the RPC caps a page at 100
 * regardless of what is asked for. */
function TranscriptTab({organizationId,interviewId}:{organizationId:string;interviewId:string}){
  const [after,setAfter]=useState<number|null>(null)

  const transcripts=useQuery({
    queryKey:['interview-transcripts',organizationId,interviewId],
    queryFn:()=>listTranscripts(organizationId,interviewId),
  })
  const current=(transcripts.data||[]).find((row)=>!row.supersededBy&&row.status==='ready')

  const page=useQuery({
    queryKey:['interview-transcript-page',current?.transcriptId,after],
    queryFn:()=>current?getTranscriptPage(organizationId,current.transcriptId,after,50):Promise.resolve([]),
    enabled:Boolean(current),
  })

  if(!current)return <p className="muted">No transcript is available for this interview.</p>
  const entries=page.data||[]

  return <section className="analysis-section">
    <table className="analysis-transcript">
      <thead><tr><th scope="col">Time</th><th scope="col">Speaker</th><th scope="col">What was said</th></tr></thead>
      <tbody>
        {entries.map((entry)=><tr key={entry.entryId}>
          <td>{formatOffset(entry.startMs)}</td>
          <td>{entry.speakerLabel}</td>
          <td>{entry.content}</td>
        </tr>)}
      </tbody>
    </table>
    <div className="analysis-transcript-pager">
      <Button variant="quiet" disabled={after===null} onClick={()=>setAfter(null)}>Back to start</Button>
      <Button variant="quiet" disabled={entries.length<50}
        onClick={()=>setAfter(entries[entries.length-1]?.sequenceNumber??null)}>Next 50</Button>
    </div>
  </section>
}
