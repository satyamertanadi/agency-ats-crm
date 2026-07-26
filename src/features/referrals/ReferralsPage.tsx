import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Check,Copy,Link2,Plus,X} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {acceptReferral,createReferralLink,listJobs,listReferralLinks,listReferrals,rejectReferral,revokeReferralLink,submitInternalReferral} from '../core/repository'
import type {ReferralStatus} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Drawer} from '../../shared/ui/Drawer'
import {Page,Panel,StatusBadge} from '../../shared/ui/Page'
import {referralStatus} from '../../shared/lib/status'
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/States'
import {Table} from '../../shared/ui/Table'
import {ConfirmDialog} from '../../shared/ui/ConfirmDialog'
import {useToast} from '../../shared/ui/Toast'
import {formatDate} from '../../shared/lib/format'

const statusFilters:Array<{key:ReferralStatus|'all';label:string}>=[{key:'new',label:'New'},{key:'accepted',label:'Accepted'},{key:'duplicate',label:'Already in ATS'},{key:'rejected',label:'Not pursued'},{key:'all',label:'All'}]

export function ReferralsPage(){
  const {organization}=useOrganization();const cache=useQueryClient();const toast=useToast()
  // Rejecting tells the referrer nothing and cannot be re-offered, so it asks first.
  const [rejectTarget,setRejectTarget]=useState<{id:string;name:string}|null>(null)
  const [tab,setTab]=useState<'inbox'|'links'>('inbox')
  const [filter,setFilter]=useState<ReferralStatus|'all'>('new')
  const [referOpen,setReferOpen]=useState(false)
  const [banner,setBanner]=useState<string|null>(null)

  const referrals=useQuery({queryKey:['referrals',organization?.id,filter],enabled:Boolean(organization),queryFn:()=>listReferrals(organization!.id,filter)})
  const links=useQuery({queryKey:['referral-links',organization?.id],enabled:Boolean(organization)&&tab==='links',queryFn:()=>listReferralLinks(organization!.id)})
  const jobs=useQuery({queryKey:['jobs',organization?.id],enabled:Boolean(organization),queryFn:()=>listJobs(organization!.id)})

  const accept=useMutation({mutationFn:(id:string)=>acceptReferral(organization!.id,id),onSuccess:async(result)=>{setBanner(result.deduped?'This person was already in your ATS — their record was updated and linked.':'Candidate created from the referral.');await cache.invalidateQueries({queryKey:['referrals',organization?.id]})},onError:(error)=>toast.error(error,'No candidate was created from the referral.')})
  const reject=useMutation({mutationFn:(id:string)=>rejectReferral(id),onSuccess:async()=>{toast.success('Referral marked as not pursued.');setRejectTarget(null);await cache.invalidateQueries({queryKey:['referrals',organization?.id]})},onError:(error)=>toast.error(error,'The referral is unchanged.')})

  const invalidate=()=>cache.invalidateQueries({queryKey:['referral-links',organization?.id]})

  return <Page title="Referrals" eyebrow="Talent network" description="Candidates introduced by your network and your team — review, then add them to your pipeline."
    actions={<Button leadingIcon={<Plus size={15}/>} onClick={()=>setReferOpen(true)}>Refer a candidate</Button>}
    tabs={<><button className={tab==='inbox'?'active':''} onClick={()=>setTab('inbox')}>Inbox</button><button className={tab==='links'?'active':''} onClick={()=>setTab('links')}>Sharing links</button></>}>

    {banner&&<div className="callout callout-info" role="status"><span>{banner}</span><button className="icon-button" aria-label="Dismiss" onClick={()=>setBanner(null)}><X size={14}/></button></div>}

    {tab==='inbox'?<Panel>
      <div className="segmented-control referral-filter" aria-label="Filter referrals by status">{statusFilters.map((option)=><button key={option.key} className={filter===option.key?'active':''} onClick={()=>setFilter(option.key)}>{option.label}</button>)}</div>
      {referrals.isLoading?<LoadingState/>:referrals.error?<ErrorState error={referrals.error}/>:referrals.data?.length===0?<EmptyState title="No referrals here" description="Share a referral link, or refer a candidate yourself, and they'll show up for review."/>:
      <Table caption="Referred candidates awaiting review" headers={['Candidate','Referred by','Role','Received','Status','']}>{referrals.data?.map((referral)=><tr key={referral.id}>
        <td><strong>{referral.candidate_full_name}</strong><span>{[referral.candidate_email,referral.candidate_linkedin_url&&'LinkedIn'].filter(Boolean).join(' · ')||'No contact details'}</span>{referral.candidate_note&&<span className="muted">“{referral.candidate_note}”</span>}</td>
        <td>{referral.referrer_member_id?(referral.organization_members?.profiles?.full_name||'Team member'):(referral.referrer_name||'Anonymous')}{referral.referrer_email&&<span>{referral.referrer_email}</span>}</td>
        <td>{referral.jobs?.title||'General'}</td>
        <td>{formatDate(referral.created_at)}</td>
        <td><StatusBadge map={referralStatus} value={referral.status}/></td>
        <td>{referral.status==='new'?<div className="row-actions"><Button size="sm" leadingIcon={<Check size={14}/>} loading={accept.isPending&&accept.variables===referral.id} onClick={()=>accept.mutate(referral.id)}>Accept</Button><Button size="sm" variant="quiet" loading={reject.isPending&&reject.variables===referral.id} onClick={()=>setRejectTarget({id:referral.id,name:referral.candidate_full_name})}>Reject</Button></div>:referral.created_candidate_id?<a className="record-link" href={`/app/${organization?.slug}/candidates/${referral.created_candidate_id}`}>View candidate</a>:null}</td>
      </tr>)}</Table>}
    </Panel>:<ReferralLinksPanel links={links} onInvalidate={invalidate}/>}

    <ReferCandidateDrawer open={referOpen} onClose={()=>setReferOpen(false)} jobs={jobs.data||[]} onDone={()=>cache.invalidateQueries({queryKey:['referrals',organization?.id]})}/>
    <ConfirmDialog open={Boolean(rejectTarget)} title="Mark this referral as not pursued?" confirmLabel="Not pursued" loading={reject.isPending}
      body={`${rejectTarget?.name??'This person'} will not be added to the ATS and the referral leaves the inbox. The referrer is not notified either way.`}
      onClose={()=>setRejectTarget(null)} onConfirm={()=>{if(rejectTarget)reject.mutate(rejectTarget.id)}}/>
  </Page>
}

function ReferralLinksPanel({links,onInvalidate}:{links:ReturnType<typeof useQuery>;onInvalidate:()=>void}){
  const {organization}=useOrganization();const toast=useToast()
  const [label,setLabel]=useState('')
  const [minted,setMinted]=useState<string|null>(null)
  const [copied,setCopied]=useState(false)
  const create=useMutation({mutationFn:()=>createReferralLink(organization!.id,{label:label||undefined}),onSuccess:async(result)=>{toast.success('Sharing link created.','Copy it from the banner below — it is shown once.');setMinted(`${window.location.origin}/refer/${result.token}`);setLabel('');await onInvalidate()},onError:(error)=>toast.error(error,'No sharing link was created.')})
  const revoke=useMutation({mutationFn:(id:string)=>revokeReferralLink(id),onSuccess:async()=>{toast.success('Sharing link revoked.','Anyone holding it can no longer submit referrals.');await onInvalidate()},onError:(error)=>toast.error(error,'The link is still live.')})
  const copy=async()=>{if(minted){await navigator.clipboard.writeText(minted);setCopied(true);setTimeout(()=>setCopied(false),1500)}}
  const rows=(links.data||[]) as Array<{id:string;label:string|null;token_prefix:string;created_at:string}>
  return <Panel title="Shareable referral links" subtitle="Send a link to your network. Anyone with it can refer a candidate — no login needed.">
    <form className="inline-form" onSubmit={(event)=>{event.preventDefault();create.mutate()}}>
      <Field label="Label (optional)"><Input value={label} onChange={(event)=>setLabel(event.target.value)} placeholder="e.g. LinkedIn post, Alumni network"/></Field>
      <Button type="submit" leadingIcon={<Link2 size={15}/>} loading={create.isPending}>Create link</Button>
    </form>
    {minted&&<div className="callout callout-info"><code className="token-url">{minted}</code><Button size="sm" variant="secondary" leadingIcon={copied?<Check size={14}/>:<Copy size={14}/>} onClick={copy}>{copied?'Copied':'Copy'}</Button></div>}
    {links.isLoading?<LoadingState/>:rows.length===0?<EmptyState title="No links yet" description="Create your first referral link above."/>:
      <Table caption="Active referral links" headers={['Label','Prefix','Created','']}>{rows.map((link)=><tr key={link.id}><td>{link.label||'Untitled link'}</td><td><code>{link.token_prefix}…</code></td><td>{formatDate(link.created_at)}</td><td><Button size="sm" variant="quiet" loading={revoke.isPending&&revoke.variables===link.id} onClick={()=>revoke.mutate(link.id)}>Revoke</Button></td></tr>)}</Table>}
  </Panel>
}

function ReferCandidateDrawer({open,onClose,jobs,onDone}:{open:boolean;onClose:()=>void;jobs:Array<{id:string;title:string}>;onDone:()=>void}){
  const {organization}=useOrganization();const toast=useToast()
  const [form,setForm]=useState({candidate_full_name:'',candidate_email:'',candidate_linkedin_url:'',candidate_note:'',target_job_id:''})
  const set=(key:keyof typeof form)=>(event:{target:{value:string}})=>setForm((prev)=>({...prev,[key]:event.target.value}))
  const mutation=useMutation({mutationFn:()=>submitInternalReferral(organization!.id,form),onSuccess:async()=>{toast.success(`${form.candidate_full_name} referred.`,'It appears in the referral inbox for review.');setForm({candidate_full_name:'',candidate_email:'',candidate_linkedin_url:'',candidate_note:'',target_job_id:''});onClose();await onDone()},onError:(error)=>toast.error(error,'The referral was not submitted.')})
  return <Drawer title="Refer a candidate" description="Add someone from your own network. They'll land in the referral inbox for review." open={open} onClose={onClose}>
    <form className="form-grid" onSubmit={(event)=>{event.preventDefault();mutation.mutate()}}>
      <Field label="Candidate name"><Input autoFocus required value={form.candidate_full_name} onChange={set('candidate_full_name')}/></Field>
      <Field label="Email"><Input type="email" value={form.candidate_email} onChange={set('candidate_email')}/></Field>
      <Field label="LinkedIn profile"><Input type="url" placeholder="https://linkedin.com/in/…" value={form.candidate_linkedin_url} onChange={set('candidate_linkedin_url')}/></Field>
      <Field label="Role"><Select value={form.target_job_id} onChange={set('target_job_id')}><option value="">No specific role — general</option>{jobs.map((job)=><option key={job.id} value={job.id}>{job.title}</option>)}</Select></Field>
      <Field label="Why are they a good fit?"><Textarea value={form.candidate_note} onChange={set('candidate_note')} rows={3}/></Field>
      {mutation.error&&<p className="form-error full" role="alert">{(mutation.error as Error).message}</p>}
      <div className="form-actions full"><Button type="button" variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" loading={mutation.isPending} disabled={!form.candidate_full_name.trim()}>Submit referral</Button></div>
    </form>
  </Drawer>
}
