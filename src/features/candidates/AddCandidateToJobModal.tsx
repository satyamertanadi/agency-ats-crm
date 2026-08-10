import {useEffect,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {BriefcaseBusiness,Search,X} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {formatMoney,formatSalary} from '../../shared/lib/format'
import type {CandidateStatus,ConsentStatus} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {Checkbox,Field,Input,Select} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'
import {addCandidatesToJob,listCandidatesPage,listJobHealth,listPipelineStagesForJob} from '../core/repository'
import {useToast} from '../../shared/ui/Toast'

export interface PlacementCandidate {id:string;full_name:string;current_position:string|null;status:CandidateStatus;consent_status:ConsentStatus|null}
/* The job side of this modal knows its job already, so it hands one over rather than making the
 * consultant pick the job they are standing inside. `excludeIds` is that side's other piece of
 * knowledge: the workspace holds the pipeline, so it can say who is already on the board and spare
 * the modal a second fetch to find out. */
export interface AddToJobTarget {id:string;title:string}

export function AddCandidateToJobModal({open,onClose,candidates:fixedCandidates=[],job,excludeIds=[],onAdded}:{
  open:boolean
  onClose:()=>void
  candidates?:PlacementCandidate[]
  job?:AddToJobTarget
  excludeIds?:string[]
  onAdded?:()=>Promise<unknown>
}){
  const {organization}=useOrganization();const cache=useQueryClient();const toast=useToast();const [query,setQuery]=useState('');const [picked,setPicked]=useState<PlacementCandidate[]>([]);const [jobId,setJobId]=useState(job?.id||'');const [stageId,setStageId]=useState('')
  const chooseCandidate=fixedCandidates.length===0
  const chooseJob=!job
  const search=useQuery({queryKey:['candidate-placement-search',organization?.id,query],enabled:open&&chooseCandidate&&Boolean(organization),queryFn:()=>listCandidatesPage(organization!.id,{query,status:'active'},0,20)})
  const chosen=chooseCandidate?picked:fixedCandidates
  const candidateIds=chosen.map((item)=>item.id)
  const candidateContextId=candidateIds.length===1?candidateIds[0]:undefined
  /* Only fetched when the job is still to be chosen. Inside a job workspace this list is both
   * redundant and the slowest thing in the modal -- it reads every job in the organization to
   * populate a picker with exactly one valid answer. */
  const health=useQuery({queryKey:['job-health',organization?.id,candidateContextId||'bulk'],enabled:open&&chooseJob&&Boolean(organization)&&(!chooseCandidate||candidateIds.length>0),queryFn:()=>listJobHealth(organization!.id,candidateContextId)})
  const stages=useQuery({queryKey:['job-stages',organization?.id,jobId],enabled:open&&Boolean(organization&&jobId),queryFn:()=>listPipelineStagesForJob(organization!.id,jobId)})
  useEffect(()=>{setStageId(stages.data?.[0]?.id||'')},[stages.data])
  // Reopening for a different job must not carry the previous one's id into the mutation. Keyed on the
  // id rather than the object: callers build the prop inline, so the object is new every render.
  useEffect(()=>{if(job?.id)setJobId(job.id)},[job?.id])
  const reset=()=>{setQuery('');setPicked([]);setJobId(job?.id||'');setStageId('')}
  const close=()=>{reset();onClose()}
  const mutation=useMutation({mutationFn:()=>addCandidatesToJob(organization!.id,jobId,candidateIds,stageId||undefined),onSuccess:async()=>{const count=candidateIds.length;const name=job?.title||health.data?.find((entry)=>entry.id===jobId)?.title;close();await Promise.all([cache.invalidateQueries({queryKey:['pipeline',jobId]}),cache.invalidateQueries({queryKey:['job-health',organization?.id]}),cache.invalidateQueries({queryKey:['candidate-pipelines',organization?.id]}),cache.invalidateQueries({queryKey:['today',organization?.id]})]);await onAdded?.();toast.success(count===1?`Candidate added to ${name||'the job'}.`:`${count} candidates added to ${name||'the job'}.`)},onError:(error)=>toast.error(error,'No candidate was added to this job.')})
  const selectedJob=health.data?.find((entry)=>entry.id===jobId)
  const blocked=chosen.filter((candidate)=>candidate.status==='do_not_contact'||candidate.status==='archived')
  const withoutConsent=chosen.filter((candidate)=>candidate.consent_status!=='granted')
  /* Anyone already on this board is listed but not selectable. Hiding them would read as "we could
   * not find them" for a candidate the consultant can see on the board behind the modal. */
  const alreadyIn=new Set(excludeIds)
  const toggle=(candidate:PlacementCandidate,checked:boolean)=>setPicked((current)=>checked?[...current,candidate]:current.filter((item)=>item.id!==candidate.id))
  // Selected candidates stay listed after the search that found them is replaced, so building a
  // shortlist from three different searches does not silently drop the first two.
  const results=(search.data?.rows||[]).filter((row)=>!picked.some((item)=>item.id===row.id))
  const title=chooseJob?(candidateIds.length>1?`Add ${candidateIds.length} candidates to a job`:'Add candidate to a job'):`Add candidates to ${job.title}`
  return <Modal title={title} open={open} wide onClose={close}><div className="stack">
    {chooseCandidate&&<>
      <Field label="Find candidate"><div className="search-box"><Search size={15}/><Input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Name, role, company, or contact detail"/></div></Field>
      {picked.length>0&&<div className="chip-row" aria-label="Selected candidates">{picked.map((candidate)=><button type="button" className="selection-chip" key={candidate.id} onClick={()=>toggle(candidate,false)}><span className="selection-chip-label">{candidate.full_name}</span><X size={12} aria-hidden="true"/><span className="sr-only">Remove {candidate.full_name}</span></button>)}</div>}
      <fieldset className="candidate-pick-list"><legend>Candidates</legend>
        {search.isLoading?<p className="muted">Searching…</p>:results.length===0&&picked.length===0?<p className="muted">{query?'No active candidates match that search.':'Search to find candidates.'}</p>:results.map((candidate)=>
          <Checkbox key={candidate.id} label={candidate.full_name} description={`${candidate.current_position||'Role not recorded'}${alreadyIn.has(candidate.id)?' · already in this job':''}`}
            checked={false} disabled={alreadyIn.has(candidate.id)}
            onChange={(event)=>toggle({id:candidate.id,full_name:candidate.full_name,current_position:candidate.current_position,status:candidate.status,consent_status:candidate.consent_status},event.target.checked)}/>)}
      </fieldset>
    </>}
    {!chooseCandidate&&<p><strong>{fixedCandidates.map((item)=>item.full_name).join(', ')}</strong></p>}
    {chooseJob&&<Field label="Job"><Select value={jobId} disabled={!candidateIds.length||blocked.length>0||health.isLoading} onChange={(event)=>setJobId(event.target.value)}><option value="">Select open job</option>{health.data?.filter((entry)=>['open','draft','on_hold'].includes(entry.status)).map((entry)=><option value={entry.id} key={entry.id} disabled={entry.already_in_job}>{entry.title} · {entry.company_name}{entry.already_in_job?' · already added':''}</option>)}</Select></Field>}
    {selectedJob&&<div className="job-choice-context"><BriefcaseBusiness size={17}/><dl><div><dt>Owner</dt><dd>{selectedJob.owner_name||'Unassigned'}</dd></div><div><dt>Pipeline</dt><dd>{selectedJob.candidate_count} {selectedJob.candidate_count===1?'candidate':'candidates'}</dd></div><div><dt>Salary</dt><dd>{formatSalary(selectedJob.salary_min,selectedJob.currency)}{selectedJob.salary_max?` – ${formatSalary(selectedJob.salary_max,selectedJob.currency)}`:''}</dd></div><div><dt>Expected fee</dt><dd>{formatMoney(selectedJob.expected_fee,selectedJob.currency)}{selectedJob.fee_source?` · ${selectedJob.fee_source}`:''}</dd></div></dl></div>}
    {jobId&&<Field label="Starting stage"><Select value={stageId} onChange={(event)=>setStageId(event.target.value)}><option value="">Default first stage</option>{stages.data?.map((stage)=><option value={stage.id} key={stage.id}>{stage.name}</option>)}</Select></Field>}
    {mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}
    {/* Placed right above the button they explain rather than mid-form, so the reason a control is
      * disabled sits next to the control -- not stated once earlier and then left to be remembered. */}
    {blocked.length>0&&<Callout tone="danger" title="Cannot be added">{blocked.map((candidate)=>candidate.full_name).join(', ')} {blocked.length===1?'is':'are'} archived or marked Do not contact.</Callout>}
    {blocked.length===0&&withoutConsent.length>0&&<Callout tone="warning" title="Consent is not granted">{withoutConsent.map((candidate)=>candidate.full_name).join(', ')} can be worked internally, but client submission stays blocked until consent is granted.</Callout>}
    <div className="form-actions"><Button variant="quiet" onClick={close}>Cancel</Button><Button onClick={()=>mutation.mutate()} loading={mutation.isPending} disabled={!candidateIds.length||!jobId||blocked.length>0}>{candidateIds.length>1?`Add ${candidateIds.length} to job`:'Add to job'}</Button></div>
  </div></Modal>
}
