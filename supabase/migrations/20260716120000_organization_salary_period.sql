-- Give salary figures a period, so a number stops being a guess.
--
-- Expected salary was stored as a bare numeric + currency and rendered as "IDR 497,500,000". That
-- reads as a formatting defect, but the defect is semantic: nothing in the schema said whether the
-- figure was annual or monthly. It matters most in exactly the market this workspace serves --
-- Indonesian salaries are commonly quoted per month, and IDR 497.5M/year is IDR 41.5M/month. A
-- consultant reading an unlabelled figure has to already know the convention to use it, and a client
-- reading one on the review page cannot know it at all.
--
-- Why this lives on organizations rather than on each candidate:
--
-- It is a market convention, not a property of a person. An agency quotes consistently across its
-- desk; a single candidate row does not choose its own unit. That is the same shape as
-- organizations.base_currency and organizations.timezone, and shared/lib/format.ts already documents
-- this exact split -- "currency <- organization.base_currency, overridable per record". Salary
-- period is another axis of the same workspace convention, so it is configured once and read by
-- formatSalary() rather than plumbed through every write path.
--
-- The alternative (a column on candidate_private_details AND candidate_submissions) would need
-- update_candidate_profile, accept_candidate_cv_parse and create_submission_package all redefined to
-- carry a value that, in practice, is identical for every row an agency owns. The per-record
-- override still exists where it is genuinely needed: formatSalary takes an explicit period argument.
--
-- 'annual' is the safe default: it is what the existing data means (demo salaries are annual, and the
-- CSV import contract documents annual figures), so no backfill changes the meaning of a stored row.

alter table public.organizations
  add column if not exists salary_period text not null default 'annual';

alter table public.organizations
  drop constraint if exists organizations_salary_period_check;

alter table public.organizations
  add constraint organizations_salary_period_check check (salary_period in ('annual', 'monthly'));

-- The client review page renders expected salary too, and it is the one screen a paying client
-- opens -- an unlabelled figure there is the most expensive place to be ambiguous. `org` is already
-- joined and grouped here, so this only widens the branding object.
--
-- Consistent with the note on 20260715220154_review_branding.sql: this exposes a display convention,
-- not a new RLS surface. Nothing further from organization_settings is revealed.
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
    'branding',jsonb_build_object('organization_name',org.name,'primary_color',os.primary_color,'logo_path',os.logo_path,'salary_period',org.salary_period),
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
