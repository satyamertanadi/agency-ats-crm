import {useState} from 'react'
import {useMutation} from '@tanstack/react-query'
import {Link2Off} from 'lucide-react'
import {revokeSubmissionLink} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {ConfirmDialog} from '../../shared/ui/ConfirmDialog'
import {EmptyState} from '../../shared/ui/States'
import {Badge,StatusBadge} from '../../shared/ui/Page'
import {useToast} from '../../shared/ui/Toast'
import {submissionPackageStatus} from '../../shared/lib/status'
import {formatDate,formatDateTime} from '../../shared/lib/format'

/* What happened to the shortlists this job has already sent.
 *
 * The packages existed, the links existed, and the workspace showed neither -- so once a submission
 * left, the only evidence was an activity-feed line. A consultant could not tell whether the client
 * had opened it, when the link died, or whether the link they emailed last month is still live.
 *
 * `revokeSubmissionLink` has been exported and called from nowhere since it was written, which is why
 * Today could raise "resolve this expired link" items that had nothing to resolve them with. This is
 * that surface. */

export interface SubmissionLink {id:string;recipient_email:string|null;expires_at:string;revoked_at:string|null;last_accessed_at:string|null}
export interface SubmissionPackageRow {
  id:string;job_id:string;title:string;status:string;created_at:string
  candidate_submissions?:Array<{id:string;job_candidate_id:string;status:string}>|null
  public_submission_links?:SubmissionLink[]|null
}

/* Revoked beats expired beats live: a link that was pulled is pulled regardless of its expiry date,
 * and saying "expired" about a link someone deliberately killed misreports the act. */
export function linkState(link:SubmissionLink,now:Date):{label:string;tone:'good'|'neutral'|'bad'}{
  if(link.revoked_at)return {label:'Revoked',tone:'bad'}
  if(new Date(link.expires_at).valueOf()<=now.valueOf())return {label:'Expired',tone:'neutral'}
  return {label:'Live',tone:'good'}
}

export function JobSubmissionsRail({packages,jobId,canSubmit,onChanged,onResend}:{
  packages:SubmissionPackageRow[]
  jobId:string
  canSubmit:boolean
  onChanged:()=>Promise<unknown>
  /* Sending a replacement is the composer's job, not a second send path -- the rail hands back to it
   * rather than growing its own form that could drift from the real one. */
  onResend:()=>void
}){
  const toast=useToast()
  const [revoking,setRevoking]=useState<{link:SubmissionLink;title:string}|null>(null)
  const now=new Date()
  const forJob=packages.filter((entry)=>entry.job_id===jobId)

  const revoke=useMutation({
    mutationFn:(link:SubmissionLink)=>revokeSubmissionLink(link.id),
    onSuccess:async()=>{setRevoking(null);toast.success('The review link was revoked.','Anyone opening it now sees an expired link.');await onChanged()},
    onError:(error)=>toast.error(error,'The link is still live.'),
  })

  if(forJob.length===0)return <EmptyState title="Nothing sent yet" description="Shortlists you send to this client will show here, with whether the link is still live and whether they have opened it."/>

  return <div className="submissions-rail">
    {forJob.map((entry)=>{
      const link=(entry.public_submission_links||[])[0]
      const state=link?linkState(link,now):null
      const count=entry.candidate_submissions?.length||0
      return <article key={entry.id} className="submission-row">
        <div>
          <strong>{entry.title}</strong>
          <span className="chip-row">
            <StatusBadge map={submissionPackageStatus} value={entry.status}/>
            <Badge tone="neutral">{count} candidate{count===1?'':'s'}</Badge>
            {state&&<Badge tone={state.tone==='good'?'good':state.tone==='bad'?'bad':'neutral'}>{state.label}</Badge>}
          </span>
          <small className="muted">
            Sent {formatDate(entry.created_at)}{link?.recipient_email?` to ${link.recipient_email}`:''}
            {/* Whether the client actually opened it is the question a consultant is really asking,
              * so it is stated rather than left to be inferred from the status badge. */}
            {link&&(link.last_accessed_at?` · opened ${formatDateTime(link.last_accessed_at)}`:' · not opened yet')}
            {link&&!link.revoked_at&&` · ${state?.label==='Expired'?'expired':'expires'} ${formatDate(link.expires_at)}`}
          </small>
        </div>
        {canSubmit&&<div className="lifecycle-actions">
          {link&&!link.revoked_at&&state?.label==='Live'&&<Button size="sm" variant="quiet" leadingIcon={<Link2Off size={14}/>} onClick={()=>setRevoking({link,title:entry.title})}>Revoke link</Button>}
          {link&&state?.label!=='Live'&&<Button size="sm" variant="secondary" onClick={onResend}>Send a fresh link</Button>}
        </div>}
      </article>
    })}

    {/* Irreversible and it reaches outside the workspace -- the client's link stops working and there
      * is no un-revoke -- so this is the ConfirmDialog tier, unlike the reversible outcome moves. */}
    <ConfirmDialog open={Boolean(revoking)} title="Revoke this review link?" confirmLabel="Revoke link" loading={revoke.isPending}
      onClose={()=>setRevoking(null)} onConfirm={()=>revoking&&revoke.mutate(revoking.link)}
      body={<p>{revoking?.link.recipient_email||'The client'} will no longer be able to open &ldquo;{revoking?.title}&rdquo;. This cannot be undone — send a fresh link instead if they still need access.</p>}/>
  </div>
}
