import {useEffect,useMemo,useState} from 'react'
import {useMutation,useQuery} from '@tanstack/react-query'
import {FileCheck2,Sparkles} from 'lucide-react'
import {discardCandidateProfileDocument,finalizeCandidateProfile,generateCandidateProfile,listCandidateJobs,listCandidateProfileTemplates,recordCandidateProfileExportFailure,uploadCandidateProfileDocument} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {Badge} from '../../shared/ui/Page'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {LoadingState} from '../../shared/ui/States'
import type {CandidateDetail} from '../../shared/types/domain'
import {countEditedFields,type CandidateProfileDraft,type CandidateProfileGeneration} from './candidateProfile'
import {buildCandidateProfileViewModel,loadProfileLogo,profileFilename,type ProfileCandidate,type ProfileEmployment} from './candidateProfileViewModel'

const DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
function byRecent(a:ProfileEmployment,b:ProfileEmployment){if(a.is_current!==b.is_current)return a.is_current?-1:1;return (b.started_on||'').localeCompare(a.started_on||'')}
function lines(value:string){return value.split('\n').map((item)=>item.trim()).filter(Boolean)}

export function CandidateProfileGenerator({organizationId,userId,candidate,organizationName,accent,logoUrl,defaultPreparedBy,onClose,onFinalized}:{organizationId:string;userId:string;candidate:CandidateDetail;organizationName:string;accent?:string;logoUrl?:string|null;defaultPreparedBy:string;onClose:()=>void;onFinalized:()=>Promise<unknown>}){
  const profileCandidate=useMemo<ProfileCandidate>(()=>({full_name:candidate.full_name,current_position:candidate.current_position,current_company:candidate.current_company,location:candidate.location,employment:(candidate.candidate_employment||[]).map((item)=>({company_name:item.company_name,title:item.title,started_on:item.started_on,ended_on:item.ended_on,started_on_precision:item.started_on_precision,ended_on_precision:item.ended_on_precision,is_current:item.is_current})).sort(byRecent),education:(candidate.candidate_education||[]).map((item)=>({degree:item.degree,field_of_study:item.field_of_study,institution:item.institution})),languages:(candidate.candidate_languages||[]).map((item)=>item.language).filter(Boolean)}),[candidate])
  const jobs=useQuery({queryKey:['candidate-jobs',organizationId,candidate.id],queryFn:()=>listCandidateJobs(organizationId,candidate.id)})
  const templates=useQuery({queryKey:['candidate-profile-templates',organizationId],queryFn:()=>listCandidateProfileTemplates(organizationId)})
  const [jobId,setJobId]=useState('');const [templateId,setTemplateId]=useState('');const [anonymized,setAnonymized]=useState(false);const [preparedBy,setPreparedBy]=useState(defaultPreparedBy);const [generation,setGeneration]=useState<CandidateProfileGeneration|null>(null);const [draft,setDraft]=useState<CandidateProfileDraft|null>(null)
  useEffect(()=>{if(!jobId&&jobs.data?.[0])setJobId(jobs.data[0].id)},[jobId,jobs.data])
  useEffect(()=>{if(!templateId&&templates.data?.length){const selected=templates.data.find((item)=>item.is_default)||templates.data[0];if(selected){setTemplateId(selected.id);setAnonymized(selected.configuration.anonymize_by_default)}}},[templateId,templates.data])
  const selectedJob=jobs.data?.find((job)=>job.id===jobId);const selectedTemplate=templates.data?.find((template)=>template.id===templateId)
  const generate=useMutation({mutationFn:()=>generateCandidateProfile({organizationId,candidateId:candidate.id,jobId,templateId,anonymize:anonymized}),onSuccess:(value)=>{setGeneration(value);setDraft(value.draft)}})
  const finalize=useMutation({mutationFn:async()=>{
    if(!generation||!draft||!selectedJob||!selectedTemplate)throw new Error('Generate and review a profile draft first.')
    const [{buildCandidateProfileDocx,downloadBlob},{buildCandidateProfilePdf}]=await Promise.all([import('./candidateProfileDocx'),import('./candidateProfilePdf')])
    const logo=await loadProfileLogo(logoUrl);const preparedDate=new Intl.DateTimeFormat(selectedTemplate.configuration.output_language==='id'?'id-ID':'en-GB',{day:'2-digit',month:'long',year:'numeric'}).format(new Date())
    const view=buildCandidateProfileViewModel({candidate:profileCandidate,job:selectedJob,draft,template:selectedTemplate.configuration,preparedBy,preparedDate,organizationName,accent,logo,anonymized})
    const [docxBlob,pdfBlob]=await Promise.all([buildCandidateProfileDocx(view),buildCandidateProfilePdf(view)]);const uploaded:Array<{id:string;storagePath:string}>=[]
    try{
      const docxName=profileFilename(view,'docx');const pdfName=profileFilename(view,'pdf')
      const docx=await uploadCandidateProfileDocument(organizationId,candidate.id,userId,new File([docxBlob],docxName,{type:DOCX_MIME}));uploaded.push(docx)
      const pdf=await uploadCandidateProfileDocument(organizationId,candidate.id,userId,new File([pdfBlob],pdfName,{type:'application/pdf'}));uploaded.push(pdf)
      await finalizeCandidateProfile({organizationId,profileVersionId:generation.profileVersionId,reviewedContent:draft,anonymized,docxDocumentId:docx.id,pdfDocumentId:pdf.id,editedFieldCount:countEditedFields(generation.draft,draft)})
      downloadBlob(docxBlob,docxName);downloadBlob(pdfBlob,pdfName)
    }catch(error){await Promise.all(uploaded.map((document)=>discardCandidateProfileDocument(organizationId,document)));await recordCandidateProfileExportFailure(organizationId,generation.profileVersionId,error instanceof Error?error.message:'Dual-format export failed.');throw error}
  },onSuccess:async()=>{await onFinalized();onClose()}})
  if(jobs.isLoading||templates.isLoading)return <LoadingState/>;if(jobs.error||templates.error)return <p className="form-error" role="alert">{jobs.error?.message||templates.error?.message}</p>
  if(!jobs.data?.length)return <div className="stack"><p className="muted">Add this candidate to a vacancy first. Every profile is tailored to a role the candidate is already attached to.</p><div className="form-actions"><Button variant="secondary" onClick={onClose}>Close</Button></div></div>
  if(!templates.data?.length)return <div className="stack"><p className="muted">An organization owner must create a candidate profile template first.</p><div className="form-actions"><Button variant="secondary" onClick={onClose}>Close</Button></div></div>
  const update=(change:Partial<CandidateProfileDraft>)=>setDraft((current)=>current?{...current,...change}:current)
  return <div className="stack profile-generator">
    <div className="form-grid"><Field label="Target vacancy"><Select value={jobId} onChange={(event)=>{setJobId(event.target.value);setGeneration(null);setDraft(null)}}>{jobs.data.map((job)=><option key={job.id} value={job.id}>{job.title}{job.company_name?` - ${job.company_name}`:''}</option>)}</Select></Field><Field label="Profile template"><Select value={templateId} onChange={(event)=>{const template=templates.data?.find((item)=>item.id===event.target.value);setTemplateId(event.target.value);setAnonymized(Boolean(template?.configuration.anonymize_by_default));setGeneration(null);setDraft(null)}}>{templates.data.map((template)=><option key={template.id} value={template.id}>{template.name} ({template.configuration.output_language==='id'?'ID':'EN'})</option>)}</Select></Field></div>
    <label><input type="checkbox" checked={anonymized} onChange={(event)=>setAnonymized(event.target.checked)}/> Remove name, contact details, photo, social URLs, and precise address from both files</label>
    <p className="muted">The score and requirement evidence stay internal. No profile is sent, ranked, or finalized until you review every client-facing field below.</p>
    <div><Button leadingIcon={<Sparkles size={15}/>} loading={generate.isPending} disabled={!jobId||!templateId} onClick={()=>generate.mutate()}>{generation?'Regenerate as a new version':'Generate evidence-backed draft'}</Button></div>
    {generate.error&&<p className="form-error" role="alert">{generate.error.message}</p>}
    {generation&&draft&&<>
      <section className="evidence-panel" aria-label="Internal role evidence"><div><strong>Internal evidence score</strong><span className="evidence-score">{generation.evaluation.score}/100</span></div><p className="muted">Deterministic score from matched, partial, missing, and uncertain requirements. Excluded from client documents.</p><div className="evidence-list">{generation.evaluation.evidence.map((item,index)=><article key={`${item.requirement}-${index}`}><Badge tone={item.classification==='matched'?'good':item.classification==='missing'?'bad':'warn'}>{item.classification}</Badge><div><strong>{item.requirement}</strong><p>{item.explanation}</p>{item.excerpt&&<small>{item.source_path}: “{item.excerpt}”</small>}</div></article>)}</div></section>
      <Field label="Prepared by"><Input value={preparedBy} onChange={(event)=>setPreparedBy(event.target.value)}/></Field>
      <Field label="Candidate summary (blank line between paragraphs)"><Textarea rows={6} value={draft.candidate_summary.join('\n\n')} onChange={(event)=>update({candidate_summary:event.target.value.split(/\n\s*\n/).map((item)=>item.trim()).filter(Boolean)})}/></Field>
      <div className="form-grid"><Field label="Strengths and opportunities"><Textarea rows={4} value={draft.strengths_opportunities} onChange={(event)=>update({strengths_opportunities:event.target.value})}/></Field><Field label="Risks and challenges"><Textarea rows={4} value={draft.risks_challenges} onChange={(event)=>update({risks_challenges:event.target.value})}/></Field></div>
      <Field label="Points to validate (one per line)"><Textarea rows={4} value={draft.points_to_validate.join('\n')} onChange={(event)=>update({points_to_validate:lines(event.target.value)})}/></Field>
      {profileCandidate.employment.map((item,index)=><Field key={`${item.company_name}-${item.title}-${index}`} label={`Role relevance - ${item.title} at ${item.company_name} (one line per bullet)`}><Textarea rows={3} value={draft.experience_relevance[index]?.relevance.join('\n')||''} onChange={(event)=>update({experience_relevance:profileCandidate.employment.map((employment,position)=>({company_name:employment.company_name,title:employment.title,relevance:position===index?lines(event.target.value):(draft.experience_relevance[position]?.relevance||[])}))})}/></Field>)}
      {finalize.error&&<p className="form-error" role="alert">{finalize.error.message}</p>}
      <div className="form-actions"><Button variant="secondary" onClick={onClose}>Close without finalizing</Button><Button leadingIcon={<FileCheck2 size={15}/>} loading={finalize.isPending} disabled={!draft.candidate_summary.length} onClick={()=>finalize.mutate()}>Finalize DOCX + PDF</Button></div>
    </>}
  </div>
}
