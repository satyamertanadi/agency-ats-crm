import { useState,type CSSProperties } from 'react'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { supabase } from '../../shared/lib/supabase'
import { resolveReview,sendReviewFeedback } from '../core/repository'
import type { PublicReview,PublicSubmission } from '../../shared/types/domain'
import { Button } from '../../shared/ui/Button'
import { Field,Input,Textarea } from '../../shared/ui/Field'
import { Badge } from '../../shared/ui/Page'
import { ErrorState,LoadingState } from '../../shared/ui/States'
import { formatMoney } from '../../shared/lib/format'

// Exported so the dev styleguide can render the real client-facing components against fixtures,
// rather than a copy that drifts. Both are pure functions of their props; ReviewCandidate only
// touches the network inside a mutation, which the styleguide never fires.
// The agency's client opens this page, so it wears the AGENCY's identity, not the product's.
// Settings already collects an accent colour and logo, and the organization-assets bucket is
// public by design; the branding simply never reached the public payload until now.
export function ReviewHeader({pkg,documents,branding}:{pkg:PublicReview['package'];documents?:PublicReview['documents'];branding?:PublicReview['branding']}){
  const accent=branding?.primary_color&&/^#[0-9a-f]{6}$/i.test(branding.primary_color)?branding.primary_color:null
  const logoUrl=branding?.logo_path?supabase.storage.from('organization-assets').getPublicUrl(branding.logo_path).data.publicUrl:null
  // Scoped to this element, so an agency accent can never leak into the rest of the page.
  const style=accent?{'--color-sidebar':accent,'--color-forest':accent} as CSSProperties:undefined
  return <header className="review-header" style={style}>
    {(logoUrl||branding?.organization_name)&&<div className="review-brand">
      {logoUrl
        ?<img src={logoUrl} alt={branding?.organization_name||'Agency logo'}/>
        :<span aria-hidden="true">{branding?.organization_name?.slice(0,2).toUpperCase()}</span>}
      {branding?.organization_name&&<strong>{branding.organization_name}</strong>}
    </div>}
    <p className="eyebrow">Confidential candidate review</p>
    <h1>{pkg.title}</h1>
    <p>{pkg.job_title} · {pkg.company_name}</p>
    {pkg.message&&<p>{pkg.message}</p>}
    {documents?.length?<div className="review-documents"><strong>Shared documents</strong>{documents.map((document)=><a href={document.url} target="_blank" rel="noreferrer" key={document.id}>{document.filename}</a>)}</div>:null}
  </header>
}

export function ReviewCandidate({token,candidate}:{token:string;candidate:PublicSubmission}){const cache=useQueryClient();const [decision,setDecision]=useState(candidate.feedback?.decision||'');const [comments,setComments]=useState(candidate.feedback?.comments||'');const [name,setName]=useState(candidate.feedback?.reviewer_name||'');const mutation=useMutation({mutationFn:()=>sendReviewFeedback(token,candidate.submission_id,decision,comments,name),onSuccess:()=>cache.invalidateQueries({queryKey:['public-review',token]})});return <article className="review-card"><h2>{candidate.candidate_name}</h2><p className="muted">{[candidate.current_position,candidate.current_company,candidate.location].filter(Boolean).join(' · ')}</p><p>{candidate.candidate_summary}</p>{candidate.suitability_assessment&&<><h3>Suitability</h3><p>{candidate.suitability_assessment}</p></>}<dl><dt>Expected salary</dt><dd>{formatMoney(candidate.expected_salary,candidate.currency)}</dd><dt>Notice period</dt><dd>{candidate.notice_period||'Not provided'}</dd><dt>Availability</dt><dd>{candidate.availability||'Not provided'}</dd></dl>{candidate.feedback&&<Badge tone="info">Current decision: {candidate.feedback.decision}</Badge>}{/* A radio group in all but name. Selection was conveyed by colour alone, which is invisible to
    a screen reader and to anyone who cannot distinguish the variants -- aria-pressed states it. */}
<div className="decision-row" role="group" aria-label="Your decision"><Button aria-pressed={decision==='approve'} variant={decision==='approve'?'primary':'secondary'} onClick={()=>setDecision('approve')}>Approve</Button><Button aria-pressed={decision==='interview'} variant={decision==='interview'?'primary':'secondary'} onClick={()=>setDecision('interview')}>Request interview</Button><Button aria-pressed={decision==='hold'} variant={decision==='hold'?'primary':'secondary'} onClick={()=>setDecision('hold')}>Hold</Button><Button aria-pressed={decision==='reject'} variant={decision==='reject'?'danger':'secondary'} onClick={()=>setDecision('reject')}>Reject</Button></div><div className="stack"><Field label="Your name"><Input value={name} onChange={(event)=>setName(event.target.value)}/></Field><Field label="Feedback"><Textarea value={comments} onChange={(event)=>setComments(event.target.value)}/></Field>{mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}<Button disabled={!decision||mutation.isPending} onClick={()=>mutation.mutate()}>{mutation.isPending?'Saving…':'Save feedback'}</Button></div></article>}

export function PublicReviewPage(){const {token=''}=useParams();const query=useQuery({queryKey:['public-review',token],enabled:Boolean(token),queryFn:()=>resolveReview(token)});if(query.isLoading)return <LoadingState label="Opening secure candidate review…"/>;if(query.error||!query.data)return <ErrorState error={query.error}/>;return <main className="review-page"><ReviewHeader pkg={query.data.package} documents={query.data.documents} branding={query.data.branding}/><section className="review-grid">{query.data.candidates.map((candidate)=><ReviewCandidate key={candidate.submission_id} token={token} candidate={candidate}/>)}</section></main>}
