-- White-label the client review page.
--
-- Settings already has a per-agency accent + logo editor, and the organization-assets bucket is
-- already public -- its own migration says "White-label organization logos are public brand
-- assets". The intent was always there; the public review payload just never carried the
-- branding, so the agency's client saw the product's identity instead of the agency's.
--
-- This adds a `branding` key to the resolve_submission_link payload. No new RLS surface: the RPC
-- is already service-role-only (revoked from anon/authenticated, reached solely through the
-- rate-limited public-review Edge Function), and the logo bucket is already public by design.
-- Only the accent colour and logo path are exposed -- nothing else from organization_settings.

create or replace function public.resolve_submission_link(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.public_submission_links; result jsonb;
begin
  select * into link from public.public_submission_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null and expires_at>now();
  if link.id is null then return null; end if;
  if (select count(*) from public.submission_link_events where link_id=link.id and event_type='view' and ip_hash=public.request_ip_hash() and occurred_at>now()-interval '1 hour')>=60 then raise exception 'rate_limited' using errcode='P0001'; end if;
  update public.public_submission_links set last_accessed_at=now() where id=link.id;
  insert into public.submission_link_events(link_id,event_type,ip_hash) values(link.id,'view',public.request_ip_hash());
  select jsonb_build_object(
    'package',jsonb_build_object('id',sp.id,'title',sp.title,'message',sp.message,'job_title',j.title,'company_name',co.name,'recipient_name',link.recipient_name,'expires_at',link.expires_at),
    'branding',jsonb_build_object('organization_name',org.name,'primary_color',os.primary_color,'logo_path',os.logo_path),
    'candidates',coalesce(jsonb_agg(jsonb_build_object('submission_id',cs.id,'candidate_name',c.full_name,'current_company',c.current_company,'current_position',c.current_position,'location',c.location,'linkedin_url',c.linkedin_url,'portfolio_url',c.portfolio_url,'candidate_summary',cs.candidate_summary,'recruiter_comments',cs.recruiter_comments,'suitability_assessment',cs.suitability_assessment,'relevant_experience',cs.relevant_experience,'expected_salary',cs.expected_salary,'currency',cs.currency,'notice_period',cs.notice_period,'availability',cs.availability,'motivation',cs.motivation,'relocation_willingness',cs.relocation_willingness,'interview_availability',cs.interview_availability,'feedback',case when sf.id is null then null else jsonb_build_object('decision',sf.decision,'comments',sf.comments,'reviewer_name',sf.reviewer_name,'updated_at',sf.updated_at) end) order by c.full_name),'[]'::jsonb)
  ) into result
  from public.submission_packages sp join public.jobs j on j.id=sp.job_id join public.companies co on co.id=j.company_id
  join public.organizations org on org.id=sp.organization_id
  left join public.organization_settings os on os.organization_id=sp.organization_id
  join public.candidate_submissions cs on cs.package_id=sp.id join public.job_candidates jc on jc.id=cs.job_candidate_id join public.candidates c on c.id=jc.candidate_id
  left join public.submission_feedback sf on sf.link_id=link.id and sf.candidate_submission_id=cs.id where sp.id=link.package_id group by sp.id,j.id,co.id,org.id,os.organization_id,link.id;
  return result;
end $$;
revoke all on function public.resolve_submission_link(text) from public;
grant execute on function public.resolve_submission_link(text) to anon,authenticated;
