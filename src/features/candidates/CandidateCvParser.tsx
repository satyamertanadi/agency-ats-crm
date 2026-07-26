import {useEffect,useState,type ReactNode} from 'react'
import {useMutation,useQuery} from '@tanstack/react-query'
import {AlertTriangle,FileSearch,RotateCcw,Upload} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {acceptCandidateCvParse,cancelCandidateCvParse,getCandidateCvParse,retryCandidateCvParse,startCandidateCvParse} from '../core/commercialRepository'
import {confidenceFor,emptyCandidateCvExtraction,type CandidateCvExtraction} from './cvParsing'
import {EducationListEditor,EmploymentListEditor,LanguagesListEditor,SkillsListEditor} from './CandidateProfileEditors'
import {Button} from '../../shared/ui/Button'
import {Field,Input} from '../../shared/ui/Field'
import {Badge} from '../../shared/ui/Page'
import {CollapsibleSection} from '../../shared/ui/CollapsibleSection'
import {useToast} from '../../shared/ui/Toast'

// A section force-opens when it has nothing yet (so a reviewer notices it needs filling in) or when
// the parser flagged something under it as low confidence; otherwise it starts collapsed once it
// already holds data, so a clean CV doesn't cost a long scroll to confirm.
function sectionNeedsAttention(draft:CandidateCvExtraction,prefix:string,isEmpty:boolean){
  if(isEmpty)return true
  return Object.entries(draft.field_evidence).some(([path,evidence])=>evidence.confidence==='low'&&(path===prefix||path.startsWith(`${prefix}.`)||path.startsWith(`${prefix}[`)))
}

type CandidateCvParserProps={organizationId:string;userId:string;targetCandidateId?:string;targetCandidateName?:string;onAccepted:(candidateId:string)=>void;onManual?:()=>void;onCancel:()=>void;
  /* Reports whether there is work here that closing would throw away -- an upload in flight or a
   * reviewed draft. The host owns the dialog, so the host has to be told; without this, Escape on a
   * fully reviewed CV discarded several minutes of checking without a word. */
  onDirtyChange?:(dirty:boolean)=>void}

export function CandidateCvParser({organizationId,userId,targetCandidateId,targetCandidateName,onAccepted,onManual,onCancel,onDirtyChange}:CandidateCvParserProps){
  const {organization}=useOrganization();const toast=useToast();const salaryPeriodLabel=organization?.salary_period==='monthly'?'month':'year'
  const [parseId,setParseId]=useState('');const [draft,setDraft]=useState<CandidateCvExtraction|null>(null);const [loadedParseId,setLoadedParseId]=useState('');const [localError,setLocalError]=useState('');const [manualFallback,setManualFallback]=useState(false)
  const start=useMutation({mutationFn:(file:File)=>startCandidateCvParse(organizationId,userId,file,targetCandidateId),onSuccess:(id)=>{setParseId(id);setDraft(null);setLoadedParseId('');setLocalError('')},onError:(error)=>setLocalError(error.message)})
  const parse=useQuery({queryKey:['candidate-cv-parse',organizationId,parseId],enabled:Boolean(parseId),queryFn:()=>getCandidateCvParse(organizationId,parseId),refetchInterval:(query)=>['uploaded','processing'].includes(query.state.data?.status||'')?2000:false})
  const retry=useMutation({mutationFn:()=>retryCandidateCvParse(organizationId,parseId),onSuccess:()=>void parse.refetch(),onError:(error)=>setLocalError(error instanceof Error?error.message:String(error))})
  const accept=useMutation({mutationFn:(candidateId?:string)=>acceptCandidateCvParse(organizationId,parseId,draft!,candidateId||targetCandidateId),
    /* The one confirmation at the end of a review that can take a minute. Without it the modal just
     * vanished, which is what a failed save looks like too. */
    onSuccess:(candidateId)=>{toast.success(parse.data?.matchedCandidate||targetCandidateId?`${draft?.full_name||'The candidate'} was updated from this CV.`:`${draft?.full_name||'Candidate'} added.`);onAccepted(candidateId)},
    onError:(error)=>setLocalError(error instanceof Error?error.message:String(error))})
  const cancel=useMutation({mutationFn:async()=>{if(parseId)await cancelCandidateCvParse(organizationId,parseId)},onSettled:onCancel})
  useEffect(()=>{if(parse.data?.status==='ready'&&parse.data.extraction&&loadedParseId!==parseId){setDraft({...parse.data.extraction,full_name:parse.data.extraction.full_name||targetCandidateName||''});setLoadedParseId(parseId);setManualFallback(false)}},[loadedParseId,parse.data,parseId,targetCandidateName])
  useEffect(()=>{onDirtyChange?.(Boolean(parseId||draft))},[draft,onDirtyChange,parseId])
  const beginManualFallback=()=>{setDraft({...emptyCandidateCvExtraction,full_name:targetCandidateName||'',source:'CV upload'});setManualFallback(true);setLoadedParseId(parseId)}
  if(!parseId)return <div className="cv-upload-flow"><label className="cv-dropzone"><Upload size={26}/><strong>{'Upload CV to autofill'}</strong><span>PDF up to 25 MB or DOCX up to 10 MB. Scanned CVs are supported.</span><input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={start.isPending} onChange={(event)=>{const file=event.target.files?.[0];if(file)start.mutate(file)}}/></label>{(localError||start.error)&&<p className="form-error" role="alert">{localError||start.error?.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={onCancel}>Cancel</Button>{onManual&&<Button variant="secondary" onClick={onManual}>Enter manually</Button>}</div></div>
  const status=parse.data?.status
  if(parse.isLoading||status==='uploaded'||status==='processing')return <div className="cv-processing" aria-live="polite"><FileSearch size={30}/><strong>{status==='processing'?'Reading and structuring the CV…':'Preparing the CV…'}</strong><span>This usually takes under a minute. Keep this window open while the CV is processed.</span><Button variant="quiet" loading={cancel.isPending} onClick={()=>cancel.mutate()}>Cancel parsing</Button></div>
  if(parse.error)return <div className="stack"><p className="form-error" role="alert">{parse.error.message}</p><div className="form-actions"><Button variant="quiet" onClick={()=>cancel.mutate()}>Cancel</Button><Button variant="secondary" leadingIcon={<RotateCcw size={14}/>} onClick={()=>void parse.refetch()}>Check again</Button></div></div>
  if(status==='failed'&&!manualFallback)return <div className="stack"><p className="form-error" role="alert">{parse.data?.errorMessage||'The CV could not be parsed.'}</p>{parse.data?.errorCode&&<p className="muted"><code>{parse.data.errorCode}</code></p>}<p className="muted">Retry the automatic parser or enter the candidate manually and keep this CV attached.</p><div className="form-actions"><Button variant="quiet" onClick={()=>cancel.mutate()}>Cancel</Button><Button variant="secondary" loading={retry.isPending} leadingIcon={<RotateCcw size={14}/>} onClick={()=>retry.mutate()}>Retry</Button><Button onClick={beginManualFallback}>Attach without parsing</Button></div></div>
  if(!draft)return <p className="form-error" role="alert">The parsed CV preview is unavailable.</p>
  const matched=parse.data?.matchedCandidate
  const update=<K extends keyof CandidateCvExtraction>(key:K,value:CandidateCvExtraction[K])=>setDraft((current)=>current?{...current,[key]:value}:current)
  const updatePrivate=(key:keyof CandidateCvExtraction['private'],value:string|number|null)=>setDraft((current)=>current?{...current,private:{...current.private,[key]:value}}:current)
  const low=(path:string)=>confidenceFor(draft,path)==='low'
  const privateIsEmpty=!draft.private.email&&!draft.private.phone&&draft.private.current_salary==null&&draft.private.expected_salary==null&&!draft.private.salary_currency&&!draft.private.work_authorization
  return <div className="cv-review stack">
    <div className="cv-review-heading"><div><strong>{manualFallback?'Manual candidate details':'Review parsed CV'}</strong><span>Check highlighted values before saving. Nothing is created until you confirm.</span></div>{draft.uncertainties.length>0&&<span className="cv-confidence"><AlertTriangle size={13}/>{draft.uncertainties.length} item{draft.uncertainties.length===1?'':'s'} to check</span>}</div>
    {matched&&!targetCandidateId&&<div className="warning-box"><strong>Candidate already exists</strong><p>{matched.full_name}{matched.current_position?` · ${matched.current_position}`:''}{matched.current_company?` at ${matched.current_company}`:''}</p><p>This CV can fill blanks on the existing profile, but a duplicate cannot be created.</p></div>}
    {targetCandidateId&&<p className="warning-box">Only blank profile fields and new history items will be added. Existing consultant-entered values always win.</p>}
    {draft.uncertainties.length>0&&<section className="cv-parser-notes"><h3>Parser notes</h3><ul className="cv-uncertainties">{draft.uncertainties.map((item)=><li key={item}>{item}</li>)}</ul></section>}
    <section><h3>Basic details</h3><div className="form-grid"><ReviewField label="Full name" low={low('full_name')}><Input value={draft.full_name} onChange={(event)=>update('full_name',event.target.value)}/></ReviewField><ReviewField label="Current company" low={low('current_company')}><Input value={draft.current_company||''} onChange={(event)=>update('current_company',event.target.value||null)}/></ReviewField><ReviewField label="Current position" low={low('current_position')}><Input value={draft.current_position||''} onChange={(event)=>update('current_position',event.target.value||null)}/></ReviewField><ReviewField label="Location" low={low('location')}><Input value={draft.location||''} onChange={(event)=>update('location',event.target.value||null)}/></ReviewField><Field label="LinkedIn"><Input type="url" value={draft.linkedin_url||''} onChange={(event)=>update('linkedin_url',event.target.value||null)}/></Field><Field label="Portfolio"><Input type="url" value={draft.portfolio_url||''} onChange={(event)=>update('portfolio_url',event.target.value||null)}/></Field><Field label="Source"><Input value={draft.source||''} onChange={(event)=>update('source',event.target.value||null)}/></Field><Field label="Availability"><Input value={draft.availability||''} onChange={(event)=>update('availability',event.target.value||null)}/></Field><Field label="Notice period (days)"><Input type="number" min="0" value={draft.notice_period_days??''} onChange={(event)=>update('notice_period_days',event.target.value?Number(event.target.value):null)}/></Field></div></section>
    <CollapsibleSection title="Private details" forceOpen={sectionNeedsAttention(draft,'private',privateIsEmpty)}>
      <div className="form-grid"><ReviewField label="Email" low={low('private.email')}><Input type="email" value={draft.private.email||''} onChange={(event)=>updatePrivate('email',event.target.value||null)}/></ReviewField><ReviewField label="Phone" low={low('private.phone')}><Input value={draft.private.phone||''} onChange={(event)=>updatePrivate('phone',event.target.value||null)}/></ReviewField><Field label={`Current salary (per ${salaryPeriodLabel})`}><Input type="number" min="0" value={draft.private.current_salary??''} onChange={(event)=>updatePrivate('current_salary',event.target.value?Number(event.target.value):null)}/></Field><Field label={`Expected salary (per ${salaryPeriodLabel})`}><Input type="number" min="0" value={draft.private.expected_salary??''} onChange={(event)=>updatePrivate('expected_salary',event.target.value?Number(event.target.value):null)}/></Field><Field label="Currency"><Input maxLength={3} value={draft.private.salary_currency||''} onChange={(event)=>updatePrivate('salary_currency',event.target.value.toUpperCase()||null)}/></Field><Field label="Work authorization"><Input value={draft.private.work_authorization||''} onChange={(event)=>updatePrivate('work_authorization',event.target.value||null)}/></Field></div>
    </CollapsibleSection>
    <CollapsibleSection title="Employment" badge={draft.employment.length>0?<Badge>{draft.employment.length}</Badge>:undefined} forceOpen={sectionNeedsAttention(draft,'employment',draft.employment.length===0)}>
      <EmploymentListEditor value={draft.employment} onChange={(employment)=>update('employment',employment)} showHeading={false}/>
    </CollapsibleSection>
    <CollapsibleSection title="Education" badge={draft.education.length>0?<Badge>{draft.education.length}</Badge>:undefined} forceOpen={sectionNeedsAttention(draft,'education',draft.education.length===0)}>
      <EducationListEditor value={draft.education} onChange={(education)=>update('education',education)} showHeading={false}/>
    </CollapsibleSection>
    <CollapsibleSection title="Skills" badge={draft.skills.length>0?<Badge>{draft.skills.length}</Badge>:undefined} forceOpen={sectionNeedsAttention(draft,'skills',draft.skills.length===0)}>
      <SkillsListEditor value={draft.skills} onChange={(skills)=>update('skills',skills)} showHeading={false}/>
    </CollapsibleSection>
    <CollapsibleSection title="Languages" badge={draft.languages.length>0?<Badge>{draft.languages.length}</Badge>:undefined} forceOpen={sectionNeedsAttention(draft,'languages',draft.languages.length===0)}>
      <LanguagesListEditor value={draft.languages} onChange={(languages)=>update('languages',languages)} showHeading={false}/>
    </CollapsibleSection>
    {(accept.error||localError)&&<p className="form-error" role="alert">{accept.error?.message||localError}</p>}
    <div className="form-actions"><Button variant="quiet" disabled={cancel.isPending||accept.isPending} onClick={()=>cancel.mutate()}>Cancel</Button><Button loading={accept.isPending} disabled={draft.full_name.trim().length<2} onClick={()=>accept.mutate(matched&&!targetCandidateId?matched.id:undefined)}>{matched&&!targetCandidateId?'Update existing candidate':targetCandidateId?'Attach CV and fill blanks':'Create candidate'}</Button></div>
  </div>
}

function ReviewField({label,low,children}:{label:string;low:boolean;children:ReactNode}){return <Field label={label}>{children}{low&&<small className="cv-low-confidence"><AlertTriangle size={11}/>Low confidence — check this value</small>}</Field>}
