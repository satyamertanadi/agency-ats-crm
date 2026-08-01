import { useState,type CSSProperties } from 'react'
import { useMutation,useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { supabase } from '../../shared/lib/supabase'
import { requestReferralUpload,resolveReferralLink,submitReferral } from '../core/repository'
import type { PublicReferral } from '../../shared/types/domain'
import { Button } from '../../shared/ui/Button'
import { Field,Input,Select,Textarea } from '../../shared/ui/Field'
import { ErrorState,LoadingState } from '../../shared/ui/States'

// Public, unauthenticated. Routed outside <Protected/> and OrganizationProvider (App.tsx), so it
// hydrates purely from the token via the `refer` edge function -- the same shape PublicReviewPage uses.
// Wears the agency's identity (accent + logo from the resolve payload), scoped to this element so an
// agency accent cannot leak elsewhere.
function ReferralHeader({branding}:{branding:PublicReferral['branding']}){
  const accent=branding.primary_color&&/^#[0-9a-f]{6}$/i.test(branding.primary_color)?branding.primary_color:null
  const logoUrl=branding.logo_path?supabase.storage.from('organization-assets').getPublicUrl(branding.logo_path).data.publicUrl:null
  const style=accent?{'--color-sidebar':accent,'--color-slate':accent} as CSSProperties:undefined
  return <header className="review-header" style={style}>
    {(logoUrl||branding.organization_name)&&<div className="review-brand">
      {logoUrl?<img src={logoUrl} alt={branding.organization_name||'Agency logo'}/>:<span aria-hidden="true">{branding.organization_name?.slice(0,2).toUpperCase()}</span>}
      {branding.organization_name&&<strong>{branding.organization_name}</strong>}
    </div>}
    <p className="eyebrow">Refer a candidate</p>
    <h1>Know someone great?</h1>
    <p>Introduce a candidate to {branding.organization_name||'our team'}. Pick a role or submit generally — we&apos;ll take it from here.</p>
  </header>
}

export function PublicReferralPage(){
  const {token=''}=useParams()
  const query=useQuery({queryKey:['public-referral',token],enabled:Boolean(token),queryFn:()=>resolveReferralLink(token)})
  const [form,setForm]=useState({referrer_name:'',referrer_email:'',candidate_full_name:'',candidate_email:'',candidate_linkedin_url:'',candidate_note:'',target_job_id:''})
  const [resume,setResume]=useState<File|null>(null)
  const set=(key:keyof typeof form)=>(event:{target:{value:string}})=>setForm((prev)=>({...prev,[key]:event.target.value}))

  const mutation=useMutation({
    mutationFn:async()=>{
      let resume_path:string|undefined
      if(resume){
        const upload=await requestReferralUpload(token,resume.name)
        const {error}=await supabase.storage.from('candidate-documents').uploadToSignedUrl(upload.path,upload.token,resume)
        if(error)throw new Error('Could not upload the resume. You can submit without it.')
        resume_path=upload.path
      }
      return submitReferral(token,{...form,resume_path})
    },
  })

  if(query.isLoading)return <LoadingState label="Opening referral form…"/>
  if(query.error||!query.data)return <ErrorState error={query.error}/>
  if(mutation.isSuccess)return <main className="review-page"><ReferralHeader branding={query.data.branding}/><section className="review-card"><h2>Thank you</h2><p>Your referral of <strong>{form.candidate_full_name}</strong> has been received. The team will review it shortly.</p></section></main>

  return <main className="review-page"><ReferralHeader branding={query.data.branding}/>
    <section className="review-card">
      <form className="stack" onSubmit={(event)=>{event.preventDefault();mutation.mutate()}}>
        <h2>Your details</h2>
        <Field label="Your name"><Input value={form.referrer_name} onChange={set('referrer_name')} autoComplete="name"/></Field>
        <Field label="Your email"><Input type="email" value={form.referrer_email} onChange={set('referrer_email')} autoComplete="email"/></Field>
        <h2>Who are you referring?</h2>
        <Field label="Candidate name"><Input required value={form.candidate_full_name} onChange={set('candidate_full_name')}/></Field>
        <Field label="Candidate email"><Input type="email" value={form.candidate_email} onChange={set('candidate_email')}/></Field>
        <Field label="LinkedIn profile"><Input type="url" placeholder="https://linkedin.com/in/…" value={form.candidate_linkedin_url} onChange={set('candidate_linkedin_url')}/></Field>
        <Field label="Which role?"><Select value={form.target_job_id} onChange={set('target_job_id')}>
          <option value="">No specific role — general referral</option>
          {query.data.jobs.map((job)=><option key={job.id} value={job.id}>{job.title}{job.company_name?` · ${job.company_name}`:''}{job.location?` · ${job.location}`:''}</option>)}
        </Select></Field>
        <Field label="Why are they a good fit? (optional)"><Textarea value={form.candidate_note} onChange={set('candidate_note')} rows={3}/></Field>
        <Field label="Attach a resume (optional)"><input className="input" type="file" accept=".pdf,.doc,.docx" onChange={(event)=>setResume(event.target.files?.[0]||null)}/></Field>
        {mutation.error&&<p className="form-error" role="alert">{(mutation.error as Error).message}</p>}
        <Button type="submit" loading={mutation.isPending} disabled={!form.candidate_full_name.trim()}>{'Submit referral'}</Button>
      </form>
    </section>
  </main>
}
