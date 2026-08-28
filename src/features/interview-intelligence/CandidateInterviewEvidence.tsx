import {useQuery} from '@tanstack/react-query'
import {MessagesSquare} from 'lucide-react'
import {Badge,Panel} from '../../shared/ui/Page'
import {formatDate} from '../../shared/lib/format'
import {listCandidateInterviewEvidence} from './analysisRepository'
import {candidateBand,confidenceLabel,resultLabel} from './analysisPresentation'

/* What this candidate's interviews established, on their record.
 *
 * Candidate-fit only. A consultant's coaching is about the interviewer, not the interviewee, and has
 * no business on the candidate's page -- RLS would refuse it anyway, but the query does not ask,
 * which is the difference between a boundary and a filter somebody can forget.
 *
 * Renders nothing when there is no analysed interview, rather than an empty panel on every candidate
 * in the database.
 */
export function CandidateInterviewEvidence({organizationId,candidateId}:{organizationId:string;candidateId:string}){
  const {data:entries=[],isLoading}=useQuery({
    queryKey:['candidate-interview-evidence',organizationId,candidateId],
    queryFn:()=>listCandidateInterviewEvidence(organizationId,candidateId),
  })

  if(isLoading||entries.length===0)return null

  return <Panel title="Interview evidence" icon={<MessagesSquare size={17}/>}
    subtitle="What each interview established against the job it was for.">
    <div className="list">
      {entries.map((entry)=>{
        const band=candidateBand(entry.overallBand)
        return <article className="list-row candidate-evidence" key={entry.assessmentId}>
          <div className="candidate-evidence-headline">
            <strong>{entry.jobTitle??'Job'}</strong>
            <span className="candidate-evidence-meta">
              <Badge tone={band.tone}>{band.label}</Badge>
              <span className="muted">{confidenceLabel(entry.confidence)}</span>
              {entry.interviewAt&&<span className="muted">{formatDate(entry.interviewAt)}</span>}
            </span>
          </div>
          <p>{entry.summary}</p>

          {entry.requirements.length>0&&<ul className="candidate-evidence-requirements">
            {entry.requirements.map((requirement)=>{
              const result=resultLabel(requirement.result)
              return <li key={requirement.id}>
                <Badge tone={result.tone}>{result.label}</Badge>
                <span>{requirement.title}</span>
              </li>
            })}
          </ul>}

          {/* The three lists a consultant acts on before the next conversation. */}
          <EvidenceGroup title="Contradictions" items={entry.contradictions}/>
          <EvidenceGroup title="Still unknown" items={entry.missingInformation}/>
          <EvidenceGroup title="Worth verifying" items={entry.verification}/>
        </article>
      })}
    </div>
  </Panel>
}

function EvidenceGroup({title,items}:{title:string;items:string[]}){
  if(items.length===0)return null
  return <div className="candidate-evidence-group">
    <span className="candidate-evidence-group-title">{title}</span>
    <ul>{items.map((item,index)=><li key={index}>{item}</li>)}</ul>
  </div>
}
