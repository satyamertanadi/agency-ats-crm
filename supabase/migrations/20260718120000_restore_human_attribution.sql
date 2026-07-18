begin;

-- Profiles were self-readable only. PostgREST could resolve the created_by -> profiles foreign key,
-- but RLS removed every colleague from the embedded result, which made all team activity anonymous.
-- A suspended member remains a subject so historical attribution survives deactivation; the viewer
-- must still be an active member of at least one organization shared with that subject.
create policy profiles_shared_organization_read
on public.profiles for select to authenticated
using (
  id=auth.uid()
  or exists (
    select 1
    from public.organization_members viewer
    join public.organization_members subject on subject.organization_id=viewer.organization_id
    where viewer.user_id=auth.uid()
      and viewer.status='active'
      and subject.user_id=profiles.id
  )
);

-- The snapshot is additive and intentionally denormalized: it is historical evidence, not another
-- editable profile field. Future profile changes must not erase who authored an old event.
alter table public.activities add column actor_name_snapshot text;

update public.activities activity
set actor_name_snapshot=coalesce(nullif(trim(profile.full_name),''),profile.email)
from public.profiles profile
where profile.id=activity.created_by;

create or replace function public.log_activity(
  p_organization_id uuid,
  p_type text,
  p_summary text,
  p_subject text default null,
  p_direction text default null,
  p_actor uuid default null,
  p_links jsonb default '[]'::jsonb,
  p_occurred_at timestamptz default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare activity_id uuid; link jsonb; actor uuid := coalesce(p_actor,auth.uid()); actor_name text;
begin
  if actor is null then return null; end if;

  select coalesce(nullif(trim(full_name),''),email) into actor_name from public.profiles where id=actor;
  insert into public.activities(organization_id,activity_type,direction,subject,summary,created_by,actor_name_snapshot,occurred_at)
  values(p_organization_id,p_type,p_direction,p_subject,p_summary,actor,actor_name,coalesce(p_occurred_at,now()))
  returning id into activity_id;

  for link in select * from jsonb_array_elements(coalesce(p_links,'[]'::jsonb)) loop
    insert into public.activity_links(activity_id,organization_id,candidate_id,company_id,contact_id,job_id,candidate_submission_id,placement_id)
    values(activity_id,p_organization_id,
      nullif(link->>'candidate_id','')::uuid,
      nullif(link->>'company_id','')::uuid,
      nullif(link->>'contact_id','')::uuid,
      nullif(link->>'job_id','')::uuid,
      nullif(link->>'candidate_submission_id','')::uuid,
      nullif(link->>'placement_id','')::uuid);
  end loop;
  return activity_id;
end $$;

revoke all on function public.log_activity(uuid,text,text,text,text,uuid,jsonb,timestamptz) from public,anon,authenticated;

commit;
