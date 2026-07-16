import {useEffect,useMemo,useState} from 'react'
import {useMutation,useQuery} from '@tanstack/react-query'
import {Download,Sparkles} from 'lucide-react'
import {generateCandidateProfileAnalysis,listCandidateJobs} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {LoadingState} from '../../shared/ui/States'
import type {CandidateDetail} from '../../shared/types/domain'
import type {CandidateProfileAnalysis} from './candidateProfile'
import {buildCandidateProfileDocx,downloadBlob,profileFilename,relevanceFor,type ProfileCandidate,type ProfileEmployment} from './candidateProfileDocx'

function byRecent(a:ProfileEmployment,b:ProfileEmployment){if(a.is_current!==b.is_current)return a.is_current?-1:1;return (b.started_on||'').localeCompare(a.started_on||'')}

export function CandidateProfileGenerator({organizationId,candidate,defaultPreparedBy,onClose}:{organizationId:string;candidate:CandidateDetail;defaultPreparedBy:string;onClose:()=>void}){
  const profileCandidate=useMemo<ProfileCandidate>(()=>({
    full_name:candidate.full_name,current_position:candidate.current_position,current_company:candidate.current_company,location:candidate.location,
    employment:(candidate.candidate_employment||[]).map((item)=>({company_name:item.company_name,title:item.title,started_on:item.started_on,ended_on:item.ended_on,started_on_precision:item.started_on_precision,ended_on_precision:item.ended_on_precision,is_current:item.is_current})).sort(byRecent),
    education:(candidate.candidate_education||[]).map((item)=>({degree:item.degree,field_of_study:item.field_of_study,institution:item.institution})),
    languages:(candidate.candidate_languages||[]).map((item)=>item.language).filter(Boolean),
  }),[candidate])

  const jobs=useQuery({queryKey:['candidate-jobs',organizationId,candidate.id],queryFn:()=>listCandidateJobs(organizationId,candidate.id)})
  const [jobId,setJobId]=useState('')
  useEffect(()=>{const first=jobs.data?.[0];if(first&&!jobId)setJobId(first.id)},[jobs.data,jobId])

  const [preparedBy,setPreparedBy]=useState(defaultPreparedBy)
  const [date,setDate]=useState(()=>new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric'}).format(new Date()))
  const [summaryText,setSummaryText]=useState('')
  const [strengthsText,setStrengthsText]=useState('')
  const [risksText,setRisksText]=useState('')
  const [pointsText,setPointsText]=useState('')
  const [relevanceText,setRelevanceText]=useState<string[]>([])
  const [ready,setReady]=useState(false)

  const applyAnalysis=(analysis:CandidateProfileAnalysis)=>{
    setSummaryText(analysis.candidate_summary.join('\n\n'))
    setStrengthsText(analysis.strengths_opportunities)
    setRisksText(analysis.risks_challenges)
    setPointsText(analysis.points_to_validate.join('\n'))
    setRelevanceText(profileCandidate.employment.map((item,index)=>relevanceFor(analysis,item,index).join('\n')))
    setReady(true)
  }
  const generate=useMutation({mutationFn:()=>generateCandidateProfileAnalysis(organizationId,candidate.id,jobId),onSuccess:applyAnalysis})

  const selectedJob=jobs.data?.find((job)=>job.id===jobId)
  const editedAnalysis=():CandidateProfileAnalysis=>({
    candidate_summary:summaryText.split(/\n\s*\n/).map((value)=>value.trim()).filter(Boolean),
    strengths_opportunities:strengthsText.trim(),
    risks_challenges:risksText.trim(),
    points_to_validate:pointsText.split('\n').map((value)=>value.trim()).filter(Boolean),
    experience_relevance:profileCandidate.employment.map((item,index)=>({company_name:item.company_name,title:item.title,relevance:(relevanceText[index]||'').split('\n').map((value)=>value.trim()).filter(Boolean)})),
  })
  const [downloadError,setDownloadError]=useState<string|null>(null)
  const download=useMutation({mutationFn:async()=>{if(!selectedJob)return;const blob=await buildCandidateProfileDocx({candidate:profileCandidate,job:{title:selectedJob.title,company_name:selectedJob.company_name},analysis:editedAnalysis(),preparedBy,date});downloadBlob(blob,profileFilename(profileCandidate,{title:selectedJob.title,company_name:selectedJob.company_name}))},onError:(error)=>setDownloadError(error instanceof Error?error.message:'Could not build the document.'),onSuccess:()=>setDownloadError(null)})

  if(jobs.isLoading)return <LoadingState/>
  if(jobs.error)return <p className="form-error" role="alert">{jobs.error.message}</p>
  if(!jobs.data?.length)return <div className="stack"><p className="muted">Add this candidate to a vacancy first — the profile is tailored to the role and client they are being put forward for.</p><div className="form-actions"><Button variant="secondary" onClick={onClose}>Close</Button></div></div>

  return <div className="stack">
    <Field label="Target vacancy"><Select value={jobId} onChange={(event)=>{setJobId(event.target.value);setReady(false)}}>{jobs.data.map((job)=><option key={job.id} value={job.id}>{job.title}{job.company_name?` — ${job.company_name}`:''}</option>)}</Select></Field>
    <p className="muted">Claude drafts the summary, strengths, risks, and per-role relevance tailored to this vacancy. Review and edit below, then download an editable Word document. Fields not yet known (age, nationality, salary, notice, interview impressions) are left as “To be confirmed” for you to complete.</p>
    <div><Button leadingIcon={<Sparkles size={15}/>} loading={generate.isPending} onClick={()=>generate.mutate()}>{ready?'Regenerate draft':'Generate draft'}</Button></div>
    {generate.error&&<p className="form-error" role="alert">{generate.error.message}</p>}
    {ready&&<>
      <div className="form-grid"><Field label="Prepared by"><Input value={preparedBy} onChange={(event)=>setPreparedBy(event.target.value)}/></Field><Field label="Date"><Input value={date} onChange={(event)=>setDate(event.target.value)}/></Field></div>
      <Field label="Candidate summary (blank line between paragraphs)"><Textarea rows={6} value={summaryText} onChange={(event)=>setSummaryText(event.target.value)}/></Field>
      <div className="form-grid"><Field label="Strengths & Opportunities"><Textarea rows={3} value={strengthsText} onChange={(event)=>setStrengthsText(event.target.value)}/></Field><Field label="Risks & Challenge"><Textarea rows={3} value={risksText} onChange={(event)=>setRisksText(event.target.value)}/></Field></div>
      <Field label="Points to validate (one per line)"><Textarea rows={3} value={pointsText} onChange={(event)=>setPointsText(event.target.value)}/></Field>
      {profileCandidate.employment.map((item,index)=><Field key={`${item.company_name}-${item.title}-${index}`} label={`Relevance — ${item.title} at ${item.company_name} (one line per bullet)`}><Textarea rows={2} value={relevanceText[index]||''} onChange={(event)=>setRelevanceText((current)=>current.map((value,position)=>position===index?event.target.value:value))}/></Field>)}
      {downloadError&&<p className="form-error" role="alert">{downloadError}</p>}
      <div className="form-actions"><Button variant="secondary" onClick={onClose}>Close</Button><Button leadingIcon={<Download size={15}/>} loading={download.isPending} onClick={()=>download.mutate()}>Download .docx</Button></div>
    </>}
  </div>
}
