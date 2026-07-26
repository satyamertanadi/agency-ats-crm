-- Two related fixes to the public rate limiters shared by resolve_submission_link,
-- submit_submission_feedback, resolve_referral_link, and submit_referral.
--
-- 1. request_ip_hash() took the LEFTMOST X-Forwarded-For element via split_part(...,',',1). In the
--    standard XFF convention each hop APPENDS its own observed address to the right, so the leftmost
--    element is exactly whatever the client itself supplied -- and public-review/index.ts and
--    refer/index.ts both forward the client's raw header onto the service-role connection verbatim.
--    Sending a random X-Forwarded-For value on every request mints a fresh rate-limit bucket every
--    time, defeating all four limits below. Switched to the RIGHTMOST element: for a single-value
--    header (no comma) this is unchanged, so it cannot make a correctly-configured single-hop setup
--    worse; for a multi-hop header it now reads the value nearest the connection that actually
--    reached this deployment rather than the value furthest from it. Verified the parsing (multi-value,
--    single-value, and missing-header cases) against a live Postgres 17 instance before writing this.
--
-- 2. Every limit was a non-atomic "select count(*) ... if >= limit then raise" followed by a separate
--    insert -- two statements under READ COMMITTED, so N concurrent requests can each read a count
--    below the limit and each insert, making the effective limit `limit + concurrency` rather than
--    `limit`. An advisory transaction lock keyed on (link, ip, event type) now serializes the
--    check-and-insert per bucket: concurrent requests for the SAME link+ip+event queue up and see
--    each other's inserts in turn; concurrent requests for different buckets never contend.
--    pg_advisory_xact_lock releases automatically at the end of the calling transaction, whether it
--    commits or the `raise exception` rolls it back, so no exit path can leak the lock.
--
-- Existing submission_link_events/referral_link_events rows were hashed under the old (leftmost)
-- rule and will not match new lookups computed under the new (rightmost) rule -- this resets every
-- in-flight one-hour rate window once. Harmless: the windows are one hour, and nothing reads these
-- rows beyond that horizon.
begin;

create or replace function public.request_ip_hash()
returns text language sql stable security definer set search_path=public as $$
  with parts as (
    select string_to_array(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-forwarded-for', ',') as xs
  )
  select encode(extensions.digest(coalesce(nullif(btrim(xs[array_length(xs,1)]),''),'unknown'),'sha256'),'hex') from parts
$$;
revoke all on function public.request_ip_hash() from public;

-- Body otherwise unchanged from 20260716120000_organization_salary_period.sql; grant untouched
-- (service_role only, per 20260717070000_reharden_resolve_submission_link.sql).
create or replace function public.resolve_submission_link(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.public_submission_links; result jsonb;
begin
  select * into link from public.public_submission_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null and expires_at>now();
  if link.id is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext(link.id::text||public.request_ip_hash()||'view'));
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

-- Body otherwise unchanged from 20260726010000_reharden_submit_submission_feedback.sql; grant
-- untouched (service_role only).
create or replace function public.submit_submission_feedback(p_token text,p_candidate_submission_id uuid,p_decision text,p_comments text default null,p_reviewer_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.public_submission_links; submission public.candidate_submissions; feedback_id uuid; jc public.job_candidates; package_owner uuid;
begin
  if p_decision not in ('approve','reject','interview','hold') then raise exception 'Invalid decision'; end if;
  if length(coalesce(p_comments,'')) > 4000 then raise exception 'comments_too_long' using errcode='22023'; end if;
  if length(coalesce(p_reviewer_name,'')) > 120 then raise exception 'reviewer_name_too_long' using errcode='22023'; end if;
  select * into link from public.public_submission_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null and expires_at>now();
  if link.id is null then raise exception 'Link not found'; end if;
  perform pg_advisory_xact_lock(hashtext(link.id::text||public.request_ip_hash()||'feedback'));
  if (select count(*) from public.submission_link_events where link_id=link.id and event_type='feedback' and ip_hash=public.request_ip_hash() and occurred_at>now()-interval '1 hour')>=10 then raise exception 'rate_limited' using errcode='P0001'; end if;
  select * into submission from public.candidate_submissions where id=p_candidate_submission_id and package_id=link.package_id;
  if submission.id is null then raise exception 'Candidate not found'; end if;
  insert into public.submission_feedback(organization_id,link_id,candidate_submission_id,decision,comments,reviewer_name)
  values(link.organization_id,link.id,submission.id,p_decision,p_comments,p_reviewer_name)
  on conflict(link_id,candidate_submission_id) do update set decision=excluded.decision,comments=excluded.comments,reviewer_name=excluded.reviewer_name,updated_at=now() returning id into feedback_id;
  insert into public.submission_link_events(link_id,event_type,ip_hash) values(link.id,'feedback',public.request_ip_hash());

  select * into jc from public.job_candidates where id=submission.job_candidate_id;
  -- The reviewer is an anonymous client, so auth.uid() is null here; attribute to whoever sent it.
  select created_by into package_owner from public.submission_packages where id=link.package_id;
  perform public.log_activity(link.organization_id,'client_feedback',
    coalesce(nullif(p_comments,''),coalesce(p_reviewer_name,'The client')||' selected '||p_decision),
    format('Client feedback: %s',p_decision),'inbound',package_owner,
    jsonb_build_array(jsonb_build_object('candidate_id',jc.candidate_id),jsonb_build_object('job_id',jc.job_id),jsonb_build_object('candidate_submission_id',submission.id)));
  return jsonb_build_object('ok',true,'feedback_id',feedback_id);
end $$;

-- Body otherwise unchanged from 20260718001000_referrals.sql; grant untouched (service_role only).
create or replace function public.resolve_referral_link(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.referral_links; result jsonb;
begin
  select * into link from public.referral_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null and (expires_at is null or expires_at>now());
  if link.id is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext(link.id::text||public.request_ip_hash()||'view'));
  if (select count(*) from public.referral_link_events where link_id=link.id and event_type='view' and ip_hash=public.request_ip_hash() and occurred_at>now()-interval '1 hour')>=60 then raise exception 'rate_limited' using errcode='P0001'; end if;
  insert into public.referral_link_events(link_id,event_type,ip_hash) values(link.id,'view',public.request_ip_hash());
  select jsonb_build_object(
    'branding',jsonb_build_object('organization_name',org.name,'primary_color',os.primary_color,'logo_path',os.logo_path),
    'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'title',j.title,'company_name',co.name,'location',j.location) order by j.title)
      from public.jobs j join public.companies co on co.id=j.company_id
      where j.organization_id=link.organization_id and j.status='open' and j.deleted_at is null),'[]'::jsonb)
  ) into result
  from public.organizations org left join public.organization_settings os on os.organization_id=org.id
  where org.id=link.organization_id;
  return result;
end $$;

-- Body otherwise unchanged from 20260718001000_referrals.sql; grant untouched (service_role only).
create or replace function public.submit_referral(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.referral_links; v_full_name text; v_job_id uuid; referral_id uuid;
begin
  select * into link from public.referral_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null and (expires_at is null or expires_at>now());
  if link.id is null then raise exception 'link_not_found' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtext(link.id::text||public.request_ip_hash()||'submit'));
  if (select count(*) from public.referral_link_events where link_id=link.id and event_type='submit' and ip_hash=public.request_ip_hash() and occurred_at>now()-interval '1 hour')>=10 then raise exception 'rate_limited' using errcode='P0001'; end if;
  v_full_name:=nullif(trim(p_payload->>'candidate_full_name'),'');
  if v_full_name is null or length(v_full_name)<2 then raise exception 'candidate_name_required' using errcode='22023'; end if;
  v_job_id:=nullif(p_payload->>'target_job_id','')::uuid;
  if v_job_id is not null and not exists(select 1 from public.jobs where id=v_job_id and organization_id=link.organization_id and status='open' and deleted_at is null) then v_job_id:=null; end if;
  insert into public.referrals(organization_id,referral_link_id,referrer_name,referrer_email,candidate_full_name,candidate_email,candidate_linkedin_url,candidate_note,resume_path,target_job_id)
  values(link.organization_id,link.id,nullif(trim(p_payload->>'referrer_name'),''),public.normalize_email(p_payload->>'referrer_email'),v_full_name,nullif(trim(p_payload->>'candidate_email'),''),nullif(trim(p_payload->>'candidate_linkedin_url'),''),nullif(trim(p_payload->>'candidate_note'),''),nullif(trim(p_payload->>'resume_path'),''),v_job_id)
  returning id into referral_id;
  insert into public.referral_link_events(link_id,event_type,ip_hash) values(link.id,'submit',public.request_ip_hash());
  return jsonb_build_object('status','received','referral_id',referral_id);
end $$;

commit;
