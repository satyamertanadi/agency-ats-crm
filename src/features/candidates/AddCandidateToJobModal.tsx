import {useEffect,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {BriefcaseBusiness,Search,TriangleAlert} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {formatMoney,formatSalary} from '../../shared/lib/format'
import type {CandidateStatus,ConsentStatus} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'
import {addCandidatesToJob,listCandidatesPage,listJobHealth,listPipelineStagesForJob} from '../core/repository'
import {useToast} from '../../shared/ui/Toast'

export interface PlacementCandidate {id:string;full_name:string;current_position:string|null;status:CandidateStatus;consent_status:ConsentStatus|null}

/* Set when the modal is opened FROM a job -- the job workspace's own "Add candidates" action -- so the
 * job step never needs asking. This is what replaced the board's bare 100-row `<Select>`: that select
 * offered no search, no consent warning, and no already-in-job filtering, three things this modal has
 * always done for the "candidate(s) known, job unknown" direction. The job workspace needed the mirror
 * of that: job known, candidates unknown. */
export interface FixedJobContext {id:string;title:string;companyName?:string|null}

export function AddCandidateToJobModal({open,onClose,candidates:fixedCandidates=[],fixedJob,excludeCandidateIds=[]}:{
  open:boolean;onClose:()=>void;candidates?:PlacementCandidate[]
  fixedJob?:FixedJobContext
  /* Candidates already on this job's pipeline. add_candidates_to_job already refuses a duplicate
   * server-side, but filtering them out of the picker is a better failure than a request that goes
   * out and bounces -- the consultant never sees them as an option to begin with. */
  excludeCandidateIds?:string[]
}){
  const {organization}=useOrganization();const cache=useQueryClient();const toast=useToast();const [query,setQuery]=useState('');const [selectedIds,setSelectedIds]=useState<Set<string>>(new Set());const [jobId,setJobId]=useState(fixedJob?.id||'');const [stageId,setStageId]=useState('')
  const chooseCandidate=fixedCandidates.length===0
  const search=useQuery({queryKey:['candidate-placement-search',organization?.id,query],enabled:open&&chooseCandidate&&Boolean(organization),queryFn:()=>listCandidatesPage(organization!.id,{query,status:'active'},0,20)})
  const searchResults=(search.data?.rows||[]).filter((row)=>!excludeCandidateIds.includes(row.id))
  const selectedFromSearch=searchResults.filter((row)=>selectedIds.has(row.id))
  const selectedCandidates=chooseCandidate?selectedFromSearch:fixedCandidates
  const candidateIds=selectedCandidates.map((item)=>item.id)
  /* already_in_job is scoped to one candidate by list_job_health's own contract, so it only means
   * anything when exactly one is picked -- multi-select falls back to add_candidates_to_job's own
   * server-side refusal for that flag specifically, same as it always did before multi-select existed. */
  const candidateContextId=candidateIds.length===1?candidateIds[0]:undefined
  const health=useQuery({queryKey:['job-health',organization?.id,candidateContextId||'bulk'],enabled:open&&Boolean(organization)&&(Boolean(fixedJob)||!chooseCandidate||Boolean(candidateIds.length)),queryFn:()=>listJobHealth(organization!.id,candidateContextId)})
  const stages=useQuery({queryKey:['job-stages',organization?.id,jobId],enabled:open&&Boolean(organization&&jobId),queryFn:()=>listPipelineStagesForJob(organization!.id,jobId)})
  useEffect(()=>{setStageId(stages.data?.[0]?.id||'')},[stages.data])
  useEffect(()=>{if(open)setJobId(fixedJob?.id||'')},[open,fixedJob?.id])
  const reset=()=>{setQuery('');setSelectedIds(new Set());if(!fixedJob)setJobId('');setStageId('')}
  const close=()=>{reset();onClose()}
  const toggleCandidate=(id:string,checked:boolean)=>setSelectedIds((current)=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next})
  const mutation=useMutation({mutationFn:()=>addCandidatesToJob(organization!.id,jobId,candidateIds,stageId||undefined),onSuccess:async()=>{const count=candidateIds.length;const targetJob=health.data?.find((entry)=>entry.id===jobId);const label=targetJob?.title||fixedJob?.title||'the job';close();await Promise.all([cache.invalidateQueries({queryKey:['pipeline',jobId]}),cache.invalidateQueries({queryKey:['job-health',organization?.id]}),cache.invalidateQueries({queryKey:['candidate-pipelines',organization?.id]}),cache.invalidateQueries({queryKey:['today',organization?.id]})]);toast.success(count===1?`Candidate added to ${label}.`:`${count} candidates added to ${label}.`)},onError:(error)=>toast.error(error,'No candidate was added to this job.')})
  const selectedJob=health.data?.find((job)=>job.id===jobId);const blocked=selectedCandidates.some((candidate)=>candidate.status==='do_not_contact'||candidate.status==='archived')
  const consentWarning=selectedCandidates.some((candidate)=>candidate.consent_status!=='granted')
  return <Modal title={fixedJob?`Add candidates to ${fixedJob.title}`:candidateIds.length>1?`Add ${candidateIds.length} candidates to a job`:'Add candidate to a job'} open={open} wide onClose={close}><div className="stack">
    {chooseCandidate&&<>
      <Field label="Find candidate"><div className="search-box"><Search size={15}/><Input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Name, role, or company"/></div></Field>
      {/* A checkbox list rather than a select -- add_candidates_to_job has always taken an array, so
        * picking several people for the same job at once was already free at the RPC layer and only
        * the picker was single-item. */}
      <div className="candidate-picker-list">
        {search.isLoading&&<p className="muted">Searching…</p>}
        {!search.isLoading&&searchResults.length===0&&<p className="muted">{query?'No matching candidates.':'Start typing a name, role, or company.'}</p>}
        <div className="checkbox-list">{searchResults.map((candidate)=><label key={candidate.id}>
          <input type="checkbox" checked={selectedIds.has(candidate.id)} onChange={(event)=>toggleCandidate(candidate.id,event.target.checked)}/>
          <span>{candidate.full_name} · {candidate.current_position||'Role not recorded'}</span>
        </label>)}</div>
      </div>
    </>}
    {!chooseCandidate&&<p><strong>{fixedCandidates.map((item)=>item.full_name).join(', ')}</strong></p>}
    {blocked&&<p className="warning-box" role="alert"><TriangleAlert size={16}/>Archived and Do not contact candidates cannot be added to jobs.</p>}
    {!blocked&&consentWarning&&<p className="warning-box"><TriangleAlert size={16}/>Consent is not currently granted. Internal pipeline work is allowed, but client submission remains blocked until consent is granted.</p>}
    {/* The job step only exists when the modal was NOT opened from a job -- fixedJob means the answer
      * was already known, so asking again would just be a second click for the same fact. */}
    {!fixedJob&&<Field label="Job"><Select value={jobId} disabled={!candidateIds.length||blocked||health.isLoading} onChange={(event)=>setJobId(event.target.value)}><option value="">Select open job</option>{health.data?.filter((job)=>['open','draft','on_hold'].includes(job.status)).map((job)=><option value={job.id} key={job.id} disabled={job.already_in_job}>{job.title} · {job.company_name}{job.already_in_job?' · already added':''}</option>)}</Select></Field>}
    {selectedJob&&<div className="job-choice-context"><BriefcaseBusiness size={17}/><dl><div><dt>Owner</dt><dd>{selectedJob.owner_name||'Unassigned'}</dd></div><div><dt>Pipeline</dt><dd>{selectedJob.candidate_count} candidates · {selectedJob.waiting_count} waiting</dd></div><div><dt>Salary</dt><dd>{formatSalary(selectedJob.salary_min,selectedJob.currency)}{selectedJob.salary_max?` – ${formatSalary(selectedJob.salary_max,selectedJob.currency)}`:''}</dd></div><div><dt>Expected fee</dt><dd>{formatMoney(selectedJob.expected_fee,selectedJob.currency)}{selectedJob.fee_source?` · ${selectedJob.fee_source}`:''}</dd></div></dl></div>}
    {jobId&&<Field label="Starting stage"><Select value={stageId} onChange={(event)=>setStageId(event.target.value)}><option value="">Default first stage</option>{stages.data?.map((stage)=><option value={stage.id} key={stage.id}>{stage.name}</option>)}</Select></Field>}
    {mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}
    <div className="form-actions"><Button variant="quiet" onClick={close}>Cancel</Button><Button onClick={()=>mutation.mutate()} loading={mutation.isPending} disabled={!candidateIds.length||!jobId||blocked}>{candidateIds.length>1?`Add ${candidateIds.length} to job`:'Add to job'}</Button></div>
  </div></Modal>
}
