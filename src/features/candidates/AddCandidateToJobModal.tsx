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

export function AddCandidateToJobModal({open,onClose,candidates:fixedCandidates=[]}:{open:boolean;onClose:()=>void;candidates?:PlacementCandidate[]}){
  const {organization}=useOrganization();const cache=useQueryClient();const toast=useToast();const [query,setQuery]=useState('');const [selectedCandidateId,setSelectedCandidateId]=useState('');const [jobId,setJobId]=useState('');const [stageId,setStageId]=useState('')
  const chooseCandidate=fixedCandidates.length===0
  const search=useQuery({queryKey:['candidate-placement-search',organization?.id,query],enabled:open&&chooseCandidate&&Boolean(organization),queryFn:()=>listCandidatesPage(organization!.id,{query,status:'active'},0,20)})
  const chosen=chooseCandidate?search.data?.rows.find((item)=>item.id===selectedCandidateId):fixedCandidates[0]
  const candidateIds=chooseCandidate?(selectedCandidateId?[selectedCandidateId]:[]):fixedCandidates.map((item)=>item.id)
  const candidateContextId=candidateIds.length===1?candidateIds[0]:undefined
  const health=useQuery({queryKey:['job-health',organization?.id,candidateContextId||'bulk'],enabled:open&&Boolean(organization)&&(!chooseCandidate||Boolean(selectedCandidateId)),queryFn:()=>listJobHealth(organization!.id,candidateContextId)})
  const stages=useQuery({queryKey:['job-stages',organization?.id,jobId],enabled:open&&Boolean(organization&&jobId),queryFn:()=>listPipelineStagesForJob(organization!.id,jobId)})
  useEffect(()=>{setStageId(stages.data?.[0]?.id||'')},[stages.data])
  const reset=()=>{setQuery('');setSelectedCandidateId('');setJobId('');setStageId('')}
  const close=()=>{reset();onClose()}
  const mutation=useMutation({mutationFn:()=>addCandidatesToJob(organization!.id,jobId,candidateIds,stageId||undefined),onSuccess:async()=>{const count=candidateIds.length;const job=health.data?.find((entry)=>entry.id===jobId);close();await Promise.all([cache.invalidateQueries({queryKey:['pipeline',jobId]}),cache.invalidateQueries({queryKey:['job-health',organization?.id]}),cache.invalidateQueries({queryKey:['candidate-pipelines',organization?.id]}),cache.invalidateQueries({queryKey:['today',organization?.id]})]);toast.success(count===1?`Candidate added to ${job?.title||'the job'}.`:`${count} candidates added to ${job?.title||'the job'}.`)},onError:(error)=>toast.error(error,'No candidate was added to this job.')})
  const selectedJob=health.data?.find((job)=>job.id===jobId);const blocked=fixedCandidates.some((candidate)=>candidate.status==='do_not_contact'||candidate.status==='archived')||chosen?.status==='do_not_contact'||chosen?.status==='archived'
  const consentWarning=(chooseCandidate?[chosen]:fixedCandidates).some((candidate)=>candidate&&candidate.consent_status!=='granted')
  return <Modal title={candidateIds.length>1?`Add ${candidateIds.length} candidates to a job`:'Add candidate to a job'} open={open} wide onClose={close}><div className="stack">
    {chooseCandidate&&<><Field label="Find candidate"><div className="search-box"><Search size={15}/><Input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Name, role, or company"/></div></Field><Field label="Candidate"><Select value={selectedCandidateId} onChange={(event)=>{setSelectedCandidateId(event.target.value);setJobId('')}}><option value="">Select candidate</option>{search.data?.rows.map((candidate)=><option value={candidate.id} key={candidate.id}>{candidate.full_name} · {candidate.current_position||'Role not recorded'}</option>)}</Select></Field></>}
    {!chooseCandidate&&<p><strong>{fixedCandidates.map((item)=>item.full_name).join(', ')}</strong></p>}
    {blocked&&<p className="warning-box" role="alert"><TriangleAlert size={16}/>Archived and Do not contact candidates cannot be added to jobs.</p>}
    {!blocked&&consentWarning&&<p className="warning-box"><TriangleAlert size={16}/>Consent is not currently granted. Internal pipeline work is allowed, but client submission remains blocked until consent is granted.</p>}
    <Field label="Job"><Select value={jobId} disabled={!candidateIds.length||blocked||health.isLoading} onChange={(event)=>setJobId(event.target.value)}><option value="">Select open job</option>{health.data?.filter((job)=>['open','draft','on_hold'].includes(job.status)).map((job)=><option value={job.id} key={job.id} disabled={job.already_in_job}>{job.title} · {job.company_name}{job.already_in_job?' · already added':''}</option>)}</Select></Field>
    {selectedJob&&<div className="job-choice-context"><BriefcaseBusiness size={17}/><dl><div><dt>Owner</dt><dd>{selectedJob.owner_name||'Unassigned'}</dd></div><div><dt>Pipeline</dt><dd>{selectedJob.candidate_count} candidates · {selectedJob.waiting_count} waiting</dd></div><div><dt>Salary</dt><dd>{formatSalary(selectedJob.salary_min,selectedJob.currency)}{selectedJob.salary_max?` – ${formatSalary(selectedJob.salary_max,selectedJob.currency)}`:''}</dd></div><div><dt>Expected fee</dt><dd>{formatMoney(selectedJob.expected_fee,selectedJob.currency)}{selectedJob.fee_source?` · ${selectedJob.fee_source}`:''}</dd></div></dl></div>}
    {jobId&&<Field label="Starting stage"><Select value={stageId} onChange={(event)=>setStageId(event.target.value)}><option value="">Default first stage</option>{stages.data?.map((stage)=><option value={stage.id} key={stage.id}>{stage.name}</option>)}</Select></Field>}
    {mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}
    <div className="form-actions"><Button variant="quiet" onClick={close}>Cancel</Button><Button onClick={()=>mutation.mutate()} loading={mutation.isPending} disabled={!candidateIds.length||!jobId||blocked}>Add to job</Button></div>
  </div></Modal>
}
