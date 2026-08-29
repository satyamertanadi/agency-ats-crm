import {useEffect,useMemo,useState} from 'react'
import {useMutation,useQuery} from '@tanstack/react-query'
import {FileCheck2,Sparkles} from 'lucide-react'
import {discardCandidateProfileDocument,finalizeCandidateProfile,generateCandidateProfile,listCandidateJobs,listCandidateProfileTemplates,recordCandidateProfileExportFailure,uploadCandidateProfileDocument} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {Badge} from '../../shared/ui/Page'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {LoadingState} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'
import type {CandidateDetail} from '../../shared/types/domain'
import {countEditedFields,type CandidateProfileDraft,type CandidateProfileGeneration} from './candidateProfile'
import {buildCandidateProfileViewModel,loadProfileLogo,profileFilename,type ProfileCandidate,type ProfileEmployment} from './candidateProfileViewModel'
import {detailFields,prefillProfileDetails,roleKey,type ProfileDetails,type RoleWebsites} from './candidateProfileDetails'

const DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
function byRecent(a:ProfileEmployment,b:ProfileEmployment){if(a.is_current!==b.is_current)return a.is_current?-1:1;return (b.started_on||'').localeCompare(a.started_on||'')}
function lines(value:string){return value.split('\n').map((item)=>item.trim()).filter(Boolean)}

export function CandidateProfileGenerator({organizationId,userId,candidate,organizationName,accent,logoUrl,footerBannerUrl,defaultPreparedBy,onClose,onFinalized}:{organizationId:string;userId:string;candidate:CandidateDetail;organizationName:string;accent?:string;logoUrl?:string|null;footerBannerUrl?:string|null;defaultPreparedBy:string;onClose:()=>void;onFinalized:()=>Promise<unknown>}){
  const toast=useToast()
  const profileCandidate=useMemo<ProfileCandidate>(()=>({full_name:candidate.full_name,current_position:candidate.current_position,current_company:candidate.current_company,location:candidate.location,employment:(candidate.candidate_employment||[]).map((item)=>({company_name:item.company_name,title:item.title,started_on:item.started_on,ended_on:item.ended_on,started_on_precision:item.started_on_precision,ended_on_precision:item.ended_on_precision,is_current:item.is_current})).sort(byRecent),education:(candidate.candidate_education||[]).map((item)=>({degree:item.degree,field_of_study:item.field_of_study,institution:item.institution})),languages:(candidate.candidate_languages||[]).map((item)=>item.language).filter(Boolean)}),[candidate])
  const jobs=useQuery({queryKey:['candidate-jobs',organizationId,candidate.id],queryFn:()=>listCandidateJobs(organizationId,candidate.id)})
  const templates=useQuery({queryKey:['candidate-profile-templates',organizationId],queryFn:()=>listCandidateProfileTemplates(organizationId)})
  const [jobId,setJobId]=useState('');const [templateId,setTemplateId]=useState('');const [anonymized,setAnonymized]=useState(false);const [preparedBy,setPreparedBy]=useState(defaultPreparedBy);const [generation,setGeneration]=useState<CandidateProfileGeneration|null>(null);const [draft,setDraft]=useState<CandidateProfileDraft|null>(null)
  // The client template states facts the record does not hold -- age, nationality, motivation, the
  // interview impressions -- so they are gathered here per document. Salary and notice arrive
  // prefilled from the record; anything left blank prints "To be confirmed", as it does today when
  // a consultant fills the template by hand.
  const [details,setDetails]=useState<ProfileDetails>(()=>prefillProfileDetails(candidate))
  const [websites,setWebsites]=useState<RoleWebsites>({})
  useEffect(()=>{if(!jobId&&jobs.data?.[0])setJobId(jobs.data[0].id)},[jobId,jobs.data])
  useEffect(()=>{if(!templateId&&templates.data?.length){const selected=templates.data.find((item)=>item.is_default)||templates.data[0];if(selected){setTemplateId(selected.id);setAnonymized(selected.configuration.anonymize_by_default)}}},[templateId,templates.data])
  const selectedJob=jobs.data?.find((job)=>job.id===jobId);const selectedTemplate=templates.data?.find((template)=>template.id===templateId)
  const generate=useMutation({mutationFn:()=>generateCandidateProfile({organizationId,candidateId:candidate.id,jobId,templateId,anonymize:anonymized}),onSuccess:(value)=>{toast.success('Draft profile generated.','Review every section before sending it to a client.');setGeneration(value);setDraft(value.draft)},onError:(error)=>toast.error(error,'No profile was generated and no AI budget was spent on a saved draft.')})
  const finalize=useMutation({mutationFn:async()=>{
    if(!generation||!draft||!selectedJob||!selectedTemplate)throw new Error('Generate and review a profile draft first.')
    const {buildCandidateProfileDocx,downloadBlob}=await import('./candidateProfileDocx')
    // Month and year only -- the approved template's cover reads "June 2026", not a full date.
    const logo=await loadProfileLogo(logoUrl);const preparedDate=new Intl.DateTimeFormat(selectedTemplate.configuration.output_language==='id'?'id-ID':'en-GB',{month:'long',year:'numeric'}).format(new Date())
    const view=buildCandidateProfileViewModel({candidate:profileCandidate,job:selectedJob,draft,template:selectedTemplate.configuration,preparedBy,preparedDate,organizationName,accent,logo,footerBanner:await loadProfileLogo(footerBannerUrl),anonymized,details,websites})
    const docxBlob=await buildCandidateProfileDocx(view);const uploaded:Array<{id:string;storagePath:string}>=[]
    try{
      const docxName=profileFilename(view,'docx')
      const docx=await uploadCandidateProfileDocument(organizationId,candidate.id,userId,new File([docxBlob],docxName,{type:DOCX_MIME}));uploaded.push(docx)
      await finalizeCandidateProfile({organizationId,profileVersionId:generation.profileVersionId,reviewedContent:draft,anonymized,docxDocumentId:docx.id,editedFieldCount:countEditedFields(generation.draft,draft)})
      downloadBlob(docxBlob,docxName)
    }catch(error){await Promise.all(uploaded.map((document)=>discardCandidateProfileDocument(organizationId,document)));await recordCandidateProfileExportFailure(organizationId,generation.profileVersionId,error instanceof Error?error.message:'Profile export failed.');throw error}
  },onSuccess:async()=>{await onFinalized();onClose()}})
  if(jobs.isLoading||templates.isLoading)return <LoadingState/>;if(jobs.error||templates.error)return <p className="form-error" role="alert">{jobs.error?.message||templates.error?.message}</p>
  if(!jobs.data?.length)return <div className="stack"><p className="muted">Add this candidate to a vacancy first. Every profile is tailored to a role the candidate is already attached to.</p><div className="form-actions"><Button variant="secondary" onClick={onClose}>Close</Button></div></div>
  if(!templates.data?.length)return <div className="stack"><p className="muted">An organization owner must create a candidate profile template first.</p><div className="form-actions"><Button variant="secondary" onClick={onClose}>Close</Button></div></div>
  const update=(change:Partial<CandidateProfileDraft>)=>setDraft((current)=>current?{...current,...change}:current)
  return <div className="stack profile-generator">
    <div className="form-grid"><Field label="Target vacancy"><Select value={jobId} onChange={(event)=>{setJobId(event.target.value);setGeneration(null);setDraft(null)}}>{jobs.data.map((job)=><option key={job.id} value={job.id}>{job.title}{job.company_name?` - ${job.company_name}`:''}</option>)}</Select></Field><Field label="Profile template"><Select value={templateId} onChange={(event)=>{const template=templates.data?.find((item)=>item.id===event.target.value);setTemplateId(event.target.value);setAnonymized(Boolean(template?.configuration.anonymize_by_default));setGeneration(null);setDraft(null)}}>{templates.data.map((template)=><option key={template.id} value={template.id}>{template.name} ({template.configuration.output_language==='id'?'ID':'EN'})</option>)}</Select></Field></div>
    <label><input type="checkbox" checked={anonymized} onChange={(event)=>setAnonymized(event.target.checked)}/> Remove name, contact details, photo, social URLs, and precise address from the generated document</label>
    {/* Says what anonymising does and does not cover. It redacts the document; it is not a limit on
      * what the assessment reads, and a consultant who assumed otherwise would be surprised by a CV
      * excerpt naming the candidate in the internal evidence panel below. That evidence never leaves
      * the workspace -- no submission or public-review surface reads it, and the DOCX never renders
      * it -- which is why the honest fix here is precise wording rather than a narrower payload. */}
    <p className="muted">The score and requirement evidence stay internal. Anonymising redacts the document you send the client &mdash; the assessment itself still reads the full candidate record and CV. No profile is sent, ranked, or finalized until you review every client-facing field below.</p>
    <div><Button leadingIcon={<Sparkles size={15}/>} loading={generate.isPending} disabled={!jobId||!templateId} onClick={()=>generate.mutate()}>{generation?'Regenerate as a new version':'Generate evidence-backed draft'}</Button></div>
    {generate.error&&<p className="form-error" role="alert">{generate.error.message}</p>}
    {generation&&draft&&<>
      {/* The degraded path is the one that runs while the AI balance is empty, so it has to read as
        * a working state with fields to fill, not as a failure. */}
      {generation.degraded&&<p className="warning-box" role="status">The AI provider is unavailable (billing), so the summary, strengths, risks, and role relevance were not written. Everything drawn from the candidate record is unaffected — fill the fields below and the document is complete. Anything left blank prints “To be confirmed”.</p>}
      <section className="evidence-panel" aria-label="Internal role evidence">
        <div><strong>Internal evidence score</strong><span className="evidence-score">{generation.degraded?'Not evaluated':`${generation.evaluation.score}/100`}</span></div>
        {/* Reported beside the score rather than folded into it. A weighted average can hide one
          * unevidenced non-negotiable behind a row of matched nice-to-haves, and that single fact is
          * usually the whole decision -- so it gets its own line and its own words. */}
        {!generation.degraded&&draft.must_have_coverage&&draft.must_have_coverage.total>0&&
          <p className={draft.must_have_coverage.evidenced<draft.must_have_coverage.total?'evidence-coverage evidence-coverage-short':'evidence-coverage'}>
            <strong>{draft.must_have_coverage.evidenced} of {draft.must_have_coverage.total} must-haves evidenced.</strong>
            {draft.must_have_coverage.evidenced<draft.must_have_coverage.total?' Check the unevidenced ones before submitting.':''}
          </p>}
        <p className="muted">{generation.degraded
          ?'No requirements were assessed, so there is no score. This does not reflect on the candidate.'
          :'Deterministic score from matched, partial, missing, and uncertain requirements, weighted by requirement level. Excluded from client documents.'}</p>
        {/* An unstructured assessment is not wrong, but it was scored against prose nobody approved
          * rather than a requirement set, and that changes how much the number is worth. */}
        {draft.requirements_source==='unstructured'&&!generation.degraded&&
          <p className="warning-box" role="status">This vacancy has no saved requirements, so the assessment used the job description text and every requirement counted equally. Add requirements on the job to get a weighted, repeatable score.</p>}
        <div className="evidence-list">{generation.evaluation.evidence.map((item,index)=>
          <article key={`${item.requirement}-${index}`}>
            <Badge tone={item.classification==='matched'?'good':item.classification==='missing'?'bad':'warn'}>{item.classification}</Badge>
            <div>
              <strong>{item.requirement}</strong>
              {item.requirement_level==='must_have'&&<Badge tone="info">Must have</Badge>}
              <p>{item.explanation}</p>
              {/* CV citations are labelled because they cannot be checked the way record citations
                * can: a candidate.* excerpt is findable in the data that was sent, a CV excerpt was
                * read out of the attached document and is only as good as the model reading it. */}
              {item.excerpt&&<small>{item.source==='candidate_cv'?'From the CV — ':''}{item.source_path}: “{item.excerpt}”</small>}
            </div>
          </article>)}</div>
      </section>

      <Field label="Prepared by"><Input value={preparedBy} onChange={(event)=>setPreparedBy(event.target.value)}/></Field>
      {/* Above the AI fields deliberately: in the degraded path those are empty, and these are the
        * only content the consultant can actually supply. */}
      <fieldset className="profile-details"><legend>Client template details</legend><p className="muted">These rows are required by the client template and are not held on the candidate record. Blank prints “To be confirmed”.</p><div className="form-grid">{detailFields.map((field)=><Field key={field.key} label={field.label.en}>{field.multiline?<Textarea rows={2} value={details[field.key]} onChange={(event)=>setDetails((current)=>({...current,[field.key]:event.target.value}))}/>:<Input value={details[field.key]} onChange={(event)=>setDetails((current)=>({...current,[field.key]:event.target.value}))}/>}</Field>)}</div></fieldset>
      <Field label="Candidate summary (blank line between paragraphs)"><Textarea rows={6} value={draft.candidate_summary.join('\n\n')} onChange={(event)=>update({candidate_summary:event.target.value.split(/\n\s*\n/).map((item)=>item.trim()).filter(Boolean)})}/></Field>
      {/* The label carries the format because the document renders these two as a bulleted list, one
        * point per line, capped at three -- a consultant pasting a paragraph back in would otherwise
        * silently reintroduce the wall of text this format exists to prevent. */}
      <div className="form-grid"><Field label="Strengths and opportunities (one point per line, max 3)"><Textarea rows={4} placeholder={'One point per line, e.g.\n20+ years managing large infrastructure projects.'} value={draft.strengths_opportunities} onChange={(event)=>update({strengths_opportunities:event.target.value})}/></Field><Field label="Risks and challenges (one point per line, max 3)"><Textarea rows={4} placeholder={'One point per line, e.g.\nNo evidence of plant engineering experience.'} value={draft.risks_challenges} onChange={(event)=>update({risks_challenges:event.target.value})}/></Field></div>
      <Field label="Points to validate (one per line)"><Textarea rows={4} value={draft.points_to_validate.join('\n')} onChange={(event)=>update({points_to_validate:lines(event.target.value)})}/></Field>
      {profileCandidate.employment.map((item,index)=><div key={`${item.company_name}-${item.title}-${index}`}>
        <Field label={`Role relevance - ${item.title} at ${item.company_name} (one line per bullet)`}><Textarea rows={3} value={draft.experience_relevance[index]?.relevance.join('\n')||''} onChange={(event)=>update({experience_relevance:profileCandidate.employment.map((employment,position)=>({company_name:employment.company_name,title:employment.title,relevance:position===index?lines(event.target.value):(draft.experience_relevance[position]?.relevance||[])}))})}/></Field>
        {/* No employer website exists on the record -- companies are client accounts, not the
          * candidate's past employers -- so the link is entered here or the line is omitted. */}
        <Field label={`Company website - ${item.company_name} (optional)`}><Input type="url" placeholder="https://" value={websites[roleKey(item.company_name,item.title)]||''} onChange={(event)=>setWebsites((current)=>({...current,[roleKey(item.company_name,item.title)]:event.target.value}))}/></Field>
      </div>)}
      {finalize.error&&<p className="form-error" role="alert">{finalize.error.message}</p>}
      <div className="form-actions"><Button variant="secondary" onClick={onClose}>Close without finalizing</Button><Button leadingIcon={<FileCheck2 size={15}/>} loading={finalize.isPending} disabled={!draft.candidate_summary.length} onClick={()=>finalize.mutate()}>Finalize DOCX</Button></div>
    </>}
  </div>
}
