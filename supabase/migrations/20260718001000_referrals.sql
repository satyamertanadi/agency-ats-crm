-- Referral system: external (public tokenized link) and internal (member) referrals of candidates.
--
-- Reuses the tokenized public-write pattern proven by public_submission_links / resolve_submission_link
-- (sha256-hashed tokens, service_role-only resolver + submitter reached through the rate-limited `refer`
-- edge function, IP-hash rate limiting via an events table). Accepting a referral routes through the
-- shared capture_prospect() RPC so a referred person becomes a candidate with the same dedup/merge
-- behaviour as a LinkedIn capture, tagged source='Referral' and optionally dropped into the chosen job.
--
-- Permission model: management (creating links, reading/accepting referrals) reuses `candidates.write`
-- -- referrals exist to produce candidates, and every role that can write candidates should manage them,
-- so no new permission key + role backfill is needed. The public resolver/submitter are service_role
-- only, exactly like resolve_submission_link post-hardening.

create table public.referral_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid references public.organization_members(id),      -- the internal owner of a personal link, if any
  label text,
  token_hash text not null unique,
  token_prefix text not null,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz,                                          -- null = does not expire (personal links are long-lived)
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.referral_link_events (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.referral_links(id) on delete cascade,
  event_type text not null, ip_hash text, occurred_at timestamptz not null default now()
);
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  referral_link_id uuid references public.referral_links(id),
  referrer_member_id uuid references public.organization_members(id),  -- set for internal referrals
  referrer_name text,
  referrer_email text,
  candidate_full_name text not null,
  candidate_email text,
  candidate_linkedin_url text,
  candidate_note text,
  resume_path text,
  target_job_id uuid references public.jobs(id),                   -- referrer's chosen role, or null for general
  status text not null default 'new' check (status in ('new','accepted','rejected','duplicate')),
  created_candidate_id uuid references public.candidates(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index referrals_org_status on public.referrals(organization_id, status);

-- RLS: new tables get anon/authenticated table grants automatically now (default privileges), so RLS
-- is the real gate and must be enabled. Management is gated on candidates.write; the public tables are
-- reachable only through the service_role RPCs (no authenticated/anon policy).
alter table public.referral_links enable row level security;
alter table public.referral_link_events enable row level security;
alter table public.referrals enable row level security;
create policy referral_links_manage on public.referral_links for all to authenticated
  using(public.has_permission(organization_id,'candidates.write')) with check(public.has_permission(organization_id,'candidates.write'));
create policy referrals_manage on public.referrals for all to authenticated
  using(public.has_permission(organization_id,'candidates.write')) with check(public.has_permission(organization_id,'candidates.write'));
-- referral_link_events: no policy -> only security-definer RPCs / service_role touch it.

-- Mint a shareable referral link. Returns the raw token once (never stored in the clear).
create or replace function public.create_referral_link(p_organization_id uuid, p_label text default null, p_member_id uuid default null, p_expiry_days integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare raw_token text; link_id uuid; expires timestamptz;
begin
  if not public.has_permission(p_organization_id,'candidates.write') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_member_id is not null and not exists(select 1 from public.organization_members where id=p_member_id and organization_id=p_organization_id) then raise exception 'member_not_found' using errcode='22023'; end if;
  raw_token:=encode(extensions.gen_random_bytes(32),'base64'); raw_token:=replace(replace(replace(raw_token,'+','-'),'/','_'),'=','');
  expires:=case when p_expiry_days is null then null else now()+make_interval(days=>p_expiry_days) end;
  insert into public.referral_links(organization_id,member_id,label,token_hash,token_prefix,created_by,expires_at)
  values(p_organization_id,p_member_id,nullif(trim(p_label),''),encode(extensions.digest(raw_token,'sha256'),'hex'),left(raw_token,8),auth.uid(),expires)
  returning id into link_id;
  return jsonb_build_object('link_id',link_id,'token',raw_token,'expires_at',expires);
end $$;
revoke all on function public.create_referral_link(uuid,text,uuid,integer) from public, anon;
grant execute on function public.create_referral_link(uuid,text,uuid,integer) to authenticated;

-- Public resolver: branding + the open-jobs picker. Service_role only (reached via the refer edge
-- function). Rate-limited 60 views/hour/IP, mirroring resolve_submission_link.
create or replace function public.resolve_referral_link(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.referral_links; result jsonb;
begin
  select * into link from public.referral_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null and (expires_at is null or expires_at>now());
  if link.id is null then return null; end if;
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
revoke all on function public.resolve_referral_link(text) from public, anon, authenticated;
grant execute on function public.resolve_referral_link(text) to service_role;

-- Public submitter: records a referral. Service_role only. Rate-limited 10 submits/hour/IP. A chosen
-- job that is no longer open is downgraded to a general referral rather than rejected.
create or replace function public.submit_referral(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.referral_links; v_full_name text; v_job_id uuid; referral_id uuid;
begin
  select * into link from public.referral_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null and (expires_at is null or expires_at>now());
  if link.id is null then raise exception 'link_not_found' using errcode='P0001'; end if;
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
revoke all on function public.submit_referral(text,jsonb) from public, anon, authenticated;
grant execute on function public.submit_referral(text,jsonb) to service_role;

-- Internal referral: a logged-in member refers someone. referrer_member_id is resolved server-side
-- from the caller so it cannot be spoofed. Same table as external referrals.
create or replace function public.submit_internal_referral(p_organization_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_member uuid; v_full_name text; v_job_id uuid; referral_id uuid;
begin
  if not public.has_permission(p_organization_id,'candidates.write') then raise exception 'permission_denied' using errcode='42501'; end if;
  select id into v_member from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() and status='active';
  v_full_name:=nullif(trim(p_payload->>'candidate_full_name'),'');
  if v_full_name is null or length(v_full_name)<2 then raise exception 'candidate_name_required' using errcode='22023'; end if;
  v_job_id:=nullif(p_payload->>'target_job_id','')::uuid;
  if v_job_id is not null and not exists(select 1 from public.jobs where id=v_job_id and organization_id=p_organization_id and status='open' and deleted_at is null) then v_job_id:=null; end if;
  insert into public.referrals(organization_id,referrer_member_id,referrer_name,candidate_full_name,candidate_email,candidate_linkedin_url,candidate_note,target_job_id)
  values(p_organization_id,v_member,nullif(trim(p_payload->>'referrer_name'),''),v_full_name,nullif(trim(p_payload->>'candidate_email'),''),nullif(trim(p_payload->>'candidate_linkedin_url'),''),nullif(trim(p_payload->>'candidate_note'),''),v_job_id)
  returning id into referral_id;
  return referral_id;
end $$;
revoke all on function public.submit_internal_referral(uuid,jsonb) from public, anon;
grant execute on function public.submit_internal_referral(uuid,jsonb) to authenticated;

-- Accept a referral: create/merge the candidate via capture_prospect (source='Referral', into the
-- chosen job), stamp the referral, and journal the referrer attribution on the candidate timeline.
create or replace function public.accept_referral(p_organization_id uuid, p_referral_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.referrals; capture jsonb; v_candidate uuid; v_deduped boolean; v_referrer text;
begin
  if not public.has_permission(p_organization_id,'candidates.write') then raise exception 'permission_denied' using errcode='42501'; end if;
  select * into r from public.referrals where id=p_referral_id and organization_id=p_organization_id for update;
  if r.id is null then raise exception 'referral_not_found' using errcode='22023'; end if;
  if r.status<>'new' then raise exception 'referral_not_pending' using errcode='22023'; end if;

  capture:=public.capture_prospect(p_organization_id,'candidate',
    jsonb_build_object('full_name',r.candidate_full_name,'email',r.candidate_email,'linkedin_url',r.candidate_linkedin_url,'source','Referral'),
    r.target_job_id);
  v_candidate:=(capture->>'id')::uuid;
  v_deduped:=(capture->>'deduped')::boolean;

  update public.referrals set status=case when v_deduped then 'duplicate' else 'accepted' end, created_candidate_id=v_candidate, reviewed_by=auth.uid(), reviewed_at=now() where id=r.id;

  v_referrer:=coalesce(nullif(trim(r.referrer_name),''),(select full_name from public.profiles p join public.organization_members m on m.user_id=p.id where m.id=r.referrer_member_id),'a referral');
  perform public.log_activity(p_organization_id,'other',v_referrer||' referred this candidate',null,'inbound',auth.uid(),jsonb_build_array(jsonb_build_object('candidate_id',v_candidate)),now());

  return jsonb_build_object('candidate_id',v_candidate,'deduped',v_deduped);
end $$;
revoke all on function public.accept_referral(uuid,uuid) from public, anon;
grant execute on function public.accept_referral(uuid,uuid) to authenticated;
