-- P1: make accepted CV evidence searchable and make the default pipeline match the seven phases
-- consultants actually work in. Legacy/imported stage keys remain mapped by the existing phase
-- trigger; only default templates are reduced, so historical job-stage rows are never deleted.
begin;

create table public.candidate_search_documents (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  extracted_content jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (
    jsonb_to_tsvector('simple'::regconfig,extracted_content,'["string"]'::jsonb)
  ) stored,
  updated_at timestamptz not null default now()
);
create index candidate_search_documents_vector_idx
  on public.candidate_search_documents using gin(search_vector);
create index candidate_search_documents_organization_idx
  on public.candidate_search_documents(organization_id,candidate_id);

alter table public.candidate_search_documents enable row level security;
revoke insert,update,delete on public.candidate_search_documents from anon,authenticated;
create policy candidate_search_documents_read on public.candidate_search_documents
for select to authenticated using (
  public.has_permission(organization_id,'candidates.read')
);

create or replace function public.sync_candidate_search_document_from_parse()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='accepted' and new.accepted_candidate_id is not null and new.extracted_data is not null then
    insert into public.candidate_search_documents(candidate_id,organization_id,extracted_content,updated_at)
    values(new.accepted_candidate_id,new.organization_id,new.extracted_data-'private',now())
    on conflict(candidate_id) do update set
      organization_id=excluded.organization_id,
      extracted_content=excluded.extracted_content,
      updated_at=excluded.updated_at;
  end if;
  return new;
end $$;
revoke all on function public.sync_candidate_search_document_from_parse() from public,anon,authenticated;

create trigger sync_candidate_search_document_after_cv_accept
after insert or update of status,accepted_candidate_id,extracted_data
on public.candidate_cv_parses
for each row execute function public.sync_candidate_search_document_from_parse();

insert into public.candidate_search_documents(candidate_id,organization_id,extracted_content,updated_at)
select distinct on (parse.accepted_candidate_id)
  parse.accepted_candidate_id,parse.organization_id,parse.extracted_data-'private',coalesce(parse.accepted_at,parse.updated_at)
from public.candidate_cv_parses parse
where parse.status='accepted' and parse.accepted_candidate_id is not null and parse.extracted_data is not null
order by parse.accepted_candidate_id,coalesce(parse.accepted_at,parse.updated_at) desc
on conflict(candidate_id) do update set
  organization_id=excluded.organization_id,
  extracted_content=excluded.extracted_content,
  updated_at=excluded.updated_at;

create or replace function public.search_candidates_page(
  p_organization_id uuid,
  p_query text default null,
  p_status text default null,
  p_location text default null,
  p_source text default null,
  p_owner_member_id uuid default null,
  p_tag text default null,
  p_skill text default null,
  p_availability text default null,
  p_consent_status text default null,
  p_sort text default 'updated',
  p_direction text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0
) returns table(
  id uuid,organization_id uuid,full_name text,current_company text,current_position text,location text,
  linkedin_url text,status text,source text,availability text,owner_member_id uuid,created_at timestamptz,
  updated_at timestamptz,consent_status text,owner_name text,tag_names text[],skill_names text[],total_count bigint
) language sql stable security invoker set search_path=public as $$
  select c.id,c.organization_id,c.full_name,c.current_company,c.current_position,c.location,c.linkedin_url,
    c.status,c.source,c.availability,c.owner_member_id,c.created_at,c.updated_at,private.consent_status,
    coalesce(nullif(trim(profile.full_name),''),profile.email) as owner_name,
    coalesce(tags.names,'{}'::text[]) as tag_names,coalesce(skills.names,'{}'::text[]) as skill_names,
    count(*) over() as total_count
  from public.candidates c
  left join public.candidate_private_details private on private.candidate_id=c.id
  left join public.candidate_search_documents search on search.candidate_id=c.id and search.organization_id=c.organization_id
  left join public.organization_members owner on owner.id=c.owner_member_id
  left join public.profiles profile on profile.id=owner.user_id
  left join lateral (
    select array_agg(tag.name order by tag.name) as names
    from public.candidate_tags candidate_tag join public.tags tag on tag.id=candidate_tag.tag_id
    where candidate_tag.candidate_id=c.id
  ) tags on true
  left join lateral (
    select array_agg(skill.name order by skill.name) as names
    from public.candidate_skills candidate_skill join public.skills skill on skill.id=candidate_skill.skill_id
    where candidate_skill.candidate_id=c.id
  ) skills on true
  where c.organization_id=p_organization_id and c.deleted_at is null
    and public.has_permission(p_organization_id,'candidates.read')
    and (nullif(trim(p_query),'') is null
      or c.full_name ilike '%'||trim(p_query)||'%'
      or c.current_company ilike '%'||trim(p_query)||'%'
      or c.current_position ilike '%'||trim(p_query)||'%'
      or private.email ilike '%'||trim(p_query)||'%'
      or (trim(p_query) ~ '[0-9]' and regexp_replace(coalesce(private.phone,''),'[^0-9]','','g') ilike '%'||regexp_replace(trim(p_query),'[^0-9]','','g')||'%')
      or search.search_vector @@ websearch_to_tsquery('simple'::regconfig,trim(p_query)))
    and (nullif(p_status,'') is null or c.status=p_status)
    and (nullif(trim(p_location),'') is null or c.location ilike '%'||trim(p_location)||'%')
    and (nullif(trim(p_source),'') is null or c.source ilike '%'||trim(p_source)||'%')
    and (p_owner_member_id is null or c.owner_member_id=p_owner_member_id)
    and (nullif(trim(p_tag),'') is null or exists(select 1 from public.candidate_tags ct join public.tags t on t.id=ct.tag_id where ct.candidate_id=c.id and t.name ilike '%'||trim(p_tag)||'%'))
    and (nullif(trim(p_skill),'') is null or exists(select 1 from public.candidate_skills cs join public.skills s on s.id=cs.skill_id where cs.candidate_id=c.id and s.name ilike '%'||trim(p_skill)||'%'))
    and (nullif(trim(p_availability),'') is null or c.availability ilike '%'||trim(p_availability)||'%')
    and (nullif(p_consent_status,'') is null or private.consent_status=p_consent_status)
  order by
    case when p_sort='name' and p_direction='asc' then lower(c.full_name) end asc,
    case when p_sort='name' and p_direction='desc' then lower(c.full_name) end desc,
    case when p_sort='location' and p_direction='asc' then lower(c.location) end asc nulls last,
    case when p_sort='location' and p_direction='desc' then lower(c.location) end desc nulls last,
    case when p_sort='created' and p_direction='asc' then c.created_at end asc,
    case when p_sort='created' and p_direction='desc' then c.created_at end desc,
    case when p_sort='updated' and p_direction='asc' then c.updated_at end asc,
    c.updated_at desc,c.id
  limit least(greatest(p_limit,1),5000) offset greatest(p_offset,0)
$$;
revoke all on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.search_candidates_page(uuid,text,text,text,text,uuid,text,text,text,text,text,text,integer,integer) to authenticated;

-- Older production data contains some direct references to template stages. Repair the foreign keys
-- to the identically named stage in each job's own pipeline. This does not move a candidate or alter
-- history; it restores the isolation create_job_with_pipeline was always meant to establish.
-- Some legacy/imported jobs point at the default template itself. Give each one the dedicated copy
-- the current creation RPC guarantees before touching the template.
with affected(job_id,organization_id,title,source_pipeline_id) as (
  select job.id,job.organization_id,job.title,template.id
  from public.jobs job
  join public.pipelines template on template.id=job.pipeline_id and template.kind='template' and template.is_default
  union
  select job.id,job.organization_id,job.title,template.id
  from public.job_candidates candidate
  join public.jobs job on job.id=candidate.job_id and job.pipeline_id is null
  join public.pipeline_stages stage on stage.id=candidate.current_stage_id
  join public.pipelines template on template.id=stage.pipeline_id and template.kind='template' and template.is_default
)
insert into public.pipelines(organization_id,name,kind,source_pipeline_id,job_id)
select affected.organization_id,affected.title||' pipeline','job',affected.source_pipeline_id,affected.job_id
from affected
where not exists(select 1 from public.pipelines existing where existing.job_id=affected.job_id)
on conflict(job_id) do nothing;

insert into public.pipeline_stages(organization_id,pipeline_id,name,stage_key,stage_type,phase_key,position,color,is_client_visible)
select destination.organization_id,destination.id,source.name,source.stage_key,source.stage_type,source.phase_key,source.position,source.color,source.is_client_visible
from public.pipelines destination
join public.jobs job on job.id=destination.job_id
join public.pipeline_stages source on source.pipeline_id=destination.source_pipeline_id
join public.pipelines template on template.id=source.pipeline_id and template.kind='template' and template.is_default
where destination.kind='job' and (job.pipeline_id is null or job.pipeline_id=destination.source_pipeline_id)
  and not exists(select 1 from public.pipeline_stages existing where existing.pipeline_id=destination.id);

update public.jobs job
set pipeline_id=destination.id,updated_at=job.updated_at
from public.pipelines destination
where destination.job_id=job.id and destination.kind='job'
  and (job.pipeline_id is null or job.pipeline_id=destination.source_pipeline_id);

-- A few older jobs were created before later template stages existed. Materialize only the missing
-- referenced stage in that historical job before remapping it; new jobs still receive only the ten
-- canonical stages seeded below.
with referenced as (
  select candidate.organization_id,job.pipeline_id,source.name,source.stage_key,source.stage_type,source.phase_key,source.color,source.is_client_visible
  from public.job_candidates candidate
  join public.jobs job on job.id=candidate.job_id
  join public.pipeline_stages source on source.id=candidate.current_stage_id
  join public.pipelines template on template.id=source.pipeline_id and template.kind='template' and template.is_default
  union
  select candidate.organization_id,job.pipeline_id,source.name,source.stage_key,source.stage_type,source.phase_key,source.color,source.is_client_visible
  from public.stage_history history
  join public.job_candidates candidate on candidate.id=history.job_candidate_id
  join public.jobs job on job.id=candidate.job_id
  join public.pipeline_stages source on source.id=history.from_stage_id
  join public.pipelines template on template.id=source.pipeline_id and template.kind='template' and template.is_default
  union
  select candidate.organization_id,job.pipeline_id,source.name,source.stage_key,source.stage_type,source.phase_key,source.color,source.is_client_visible
  from public.stage_history history
  join public.job_candidates candidate on candidate.id=history.job_candidate_id
  join public.jobs job on job.id=candidate.job_id
  join public.pipeline_stages source on source.id=history.to_stage_id
  join public.pipelines template on template.id=source.pipeline_id and template.kind='template' and template.is_default
), needed as (
  select distinct on (reference.pipeline_id,reference.stage_key) reference.*
  from referenced reference
  where reference.pipeline_id is not null and not exists(
    select 1 from public.pipeline_stages target
    where target.pipeline_id=reference.pipeline_id and target.stage_key=reference.stage_key
  )
  order by reference.pipeline_id,reference.stage_key
), ranked as (
  select needed.*,
    coalesce((select max(existing.position)+1 from public.pipeline_stages existing where existing.pipeline_id=needed.pipeline_id),0)
      +row_number() over(partition by needed.pipeline_id order by needed.stage_key)-1 as new_position
  from needed
)
insert into public.pipeline_stages(organization_id,pipeline_id,name,stage_key,stage_type,phase_key,position,color,is_client_visible)
select organization_id,pipeline_id,name,stage_key,stage_type,phase_key,new_position::integer,color,is_client_visible
from ranked;

update public.job_candidates candidate
set current_stage_id=target.id
from public.pipeline_stages source,public.pipelines template,public.jobs job,public.pipeline_stages target
where candidate.current_stage_id=source.id
  and template.id=source.pipeline_id and template.kind='template' and template.is_default
  and job.id=candidate.job_id and target.pipeline_id=job.pipeline_id and target.stage_key=source.stage_key;

update public.stage_history history
set from_stage_id=target.id
from public.job_candidates candidate,public.jobs job,public.pipeline_stages source,public.pipelines template,public.pipeline_stages target
where history.job_candidate_id=candidate.id and history.from_stage_id=source.id
  and template.id=source.pipeline_id and template.kind='template' and template.is_default
  and job.id=candidate.job_id and target.pipeline_id=job.pipeline_id and target.stage_key=source.stage_key;

update public.stage_history history
set to_stage_id=target.id
from public.job_candidates candidate,public.jobs job,public.pipeline_stages source,public.pipelines template,public.pipeline_stages target
where history.job_candidate_id=candidate.id and history.to_stage_id=source.id
  and template.id=source.pipeline_id and template.kind='template' and template.is_default
  and job.id=candidate.job_id and target.pipeline_id=job.pipeline_id and target.stage_key=source.stage_key;

-- If any reference cannot be mapped one-for-one, abort rather than lose or reinterpret it.
do $$
declare v_details jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'stage_key',stage.stage_key,
    'candidate_refs',(select count(*) from public.job_candidates candidate where candidate.current_stage_id=stage.id),
    'history_from_refs',(select count(*) from public.stage_history history where history.from_stage_id=stage.id),
    'history_to_refs',(select count(*) from public.stage_history history where history.to_stage_id=stage.id)
  ) order by stage.stage_key) into v_details
  from public.pipeline_stages stage
  join public.pipelines pipeline on pipeline.id=stage.pipeline_id
  where pipeline.kind='template' and pipeline.is_default
    and (exists(select 1 from public.job_candidates candidate where candidate.current_stage_id=stage.id)
      or exists(select 1 from public.stage_history history where history.from_stage_id=stage.id or history.to_stage_id=stage.id));
  if v_details is not null then
    raise exception 'default_pipeline_stage_in_use' using detail=v_details::text;
  end if;
end $$;

delete from public.pipeline_stages stage
using public.pipelines pipeline
where stage.pipeline_id=pipeline.id and pipeline.kind='template' and pipeline.is_default;

with canonical(name,stage_key,stage_type,phase_key,position,visible) as (values
  ('Sourcing','sourced','active','sourcing',0,false),
  ('Screening','screening','active','screening',1,false),
  ('Shortlist','shortlisted','active','shortlist',2,false),
  ('Client review','submitted_to_client','active','client_review',3,true),
  ('Interview','interview_scheduled','active','interview',4,true),
  ('Offer','offer','active','offer',5,true),
  ('Placed','placed','placed','placed',6,true),
  ('Rejected','rejected','rejected','other',7,false),
  ('Withdrawn','withdrawn','withdrawn','other',8,false),
  ('On hold','on_hold','on_hold','other',9,false)
)
insert into public.pipeline_stages(organization_id,pipeline_id,name,stage_key,stage_type,phase_key,position,is_client_visible)
select pipeline.organization_id,pipeline.id,canonical.name,canonical.stage_key,canonical.stage_type,canonical.phase_key,canonical.position,canonical.visible
from public.pipelines pipeline cross join canonical
where pipeline.kind='template' and pipeline.is_default;

-- Job creation must copy the phase identity too. The older function predated phase_key and relied on
-- a trigger that cannot infer custom phases and historically left outcome phases null.
create or replace function public.create_job_with_pipeline(
  p_organization_id uuid,p_company_id uuid,p_title text,p_owner_member_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare source_id uuid; new_pipeline uuid; new_job uuid;
begin
  if not public.has_permission(p_organization_id,'jobs.write') then raise exception 'Access denied'; end if;
  if not exists(select 1 from public.companies where id=p_company_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'company_not_found' using errcode='P0002'; end if;
  select id into source_id from public.pipelines where organization_id=p_organization_id and kind='template' and is_default;
  if source_id is null then raise exception 'default_pipeline_not_found' using errcode='P0002'; end if;
  insert into public.jobs(organization_id,company_id,title,owner_member_id,created_by,opened_at) values(p_organization_id,p_company_id,trim(p_title),p_owner_member_id,auth.uid(),now()) returning id into new_job;
  insert into public.pipelines(organization_id,name,kind,source_pipeline_id,job_id) values(p_organization_id,p_title||' pipeline','job',source_id,new_job) returning id into new_pipeline;
  insert into public.pipeline_stages(organization_id,pipeline_id,name,stage_key,stage_type,phase_key,position,color,is_client_visible)
    select p_organization_id,new_pipeline,name,stage_key,stage_type,phase_key,position,color,is_client_visible
    from public.pipeline_stages where pipeline_id=source_id order by position;
  update public.jobs set pipeline_id=new_pipeline where id=new_job;
  return new_job;
end $$;
revoke all on function public.create_job_with_pipeline(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.create_job_with_pipeline(uuid,uuid,text,uuid) to authenticated;

create or replace function public.create_organization(p_name text,p_slug text,p_currency char(3) default 'USD',p_timezone text default 'UTC')
returns uuid language plpgsql security definer set search_path=public as $$
declare org_id uuid; member_id uuid; owner_role uuid; pipeline_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.organizations(name,slug,base_currency,timezone,created_by) values(trim(p_name),lower(trim(p_slug)),upper(p_currency),p_timezone,auth.uid()) returning id into org_id;
  insert into public.organization_settings(organization_id) values(org_id);
  insert into public.organization_members(organization_id,user_id,status) values(org_id,auth.uid(),'active') returning id into member_id;
  perform public.seed_organization_roles(org_id);
  select id into owner_role from public.roles where organization_id=org_id and role_key='owner';
  insert into public.member_roles(member_id,role_id) values(member_id,owner_role);
  insert into public.pipelines(organization_id,name,kind,is_default) values(org_id,'Agency recruitment','template',true) returning id into pipeline_id;
  insert into public.pipeline_stages(organization_id,pipeline_id,name,stage_key,stage_type,phase_key,position,is_client_visible)
  select org_id,pipeline_id,stage.name,stage.stage_key,stage.stage_type,stage.phase_key,stage.position,stage.visible
  from (values
    ('Sourcing','sourced','active','sourcing',0,false),('Screening','screening','active','screening',1,false),
    ('Shortlist','shortlisted','active','shortlist',2,false),('Client review','submitted_to_client','active','client_review',3,true),
    ('Interview','interview_scheduled','active','interview',4,true),('Offer','offer','active','offer',5,true),
    ('Placed','placed','placed','placed',6,true),('Rejected','rejected','rejected','other',7,false),
    ('Withdrawn','withdrawn','withdrawn','other',8,false),('On hold','on_hold','on_hold','other',9,false)
  ) as stage(name,stage_key,stage_type,phase_key,position,visible);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) values(org_id,auth.uid(),'organization.created','organization',org_id);
  return org_id;
end $$;
revoke all on function public.create_organization(text,text,char,text) from public,anon;
grant execute on function public.create_organization(text,text,char,text) to authenticated;

commit;
