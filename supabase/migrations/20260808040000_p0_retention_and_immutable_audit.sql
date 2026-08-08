begin;

-- Audit history is evidence, not ordinary organization data. The original generic
-- write policy allowed an organization administrator to alter or delete it.
drop policy if exists audit_logs_write on public.audit_logs;
revoke insert,update,delete on public.audit_logs from anon,authenticated;
-- This unused generic RPC let any member append an arbitrary action and metadata,
-- making forged events indistinguishable from system evidence.
revoke all on function public.record_audit_event(uuid,text,text,uuid,jsonb) from public,anon,authenticated;

-- Older invitation events duplicated the recipient email into the permanent
-- ledger even though the invitation row already owns it. Remove that copy before
-- the immutability guard is installed, and prevent the legacy invitation RPC
-- from adding it to future audit rows.
update public.audit_logs set metadata=metadata-'email'
where action='invitation.created' and metadata?'email';

create or replace function public.minimize_audit_log_metadata()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.action='invitation.created' then new.metadata:=coalesce(new.metadata,'{}'::jsonb)-'email'; end if;
  return new;
end $$;
revoke all on function public.minimize_audit_log_metadata() from public,anon,authenticated;

drop trigger if exists audit_logs_minimize_metadata on public.audit_logs;
create trigger audit_logs_minimize_metadata
  before insert on public.audit_logs
  for each row execute function public.minimize_audit_log_metadata();

create or replace function public.prevent_audit_log_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  -- A deliberate organization deletion must be able to satisfy the existing
  -- ON DELETE CASCADE and erase the tenant's audit data too. Direct row edits and
  -- direct deletes remain forbidden for every database role, including service.
  if tg_op='DELETE' and pg_trigger_depth()>1
    and not exists(select 1 from public.organizations where id=old.organization_id) then
    return old;
  end if;
  raise exception 'audit_logs_are_immutable' using errcode='55000';
end $$;
revoke all on function public.prevent_audit_log_mutation() from public,anon,authenticated;

drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_log_mutation();

-- Record which fields changed and tamper-evident row hashes without copying PII,
-- salary, notes, or tokens into a second long-lived table.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare
  before_data jsonb:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  after_data jsonb:=case when tg_op='DELETE' then null else to_jsonb(new) end;
  row_data jsonb:=coalesce(after_data,before_data);
  org_id uuid;
  entity_id uuid;
  changed_fields jsonb;
begin
  org_id:=nullif(row_data->>'organization_id','')::uuid;
  -- Cascading tenant deletion may fire child-table audit triggers after the
  -- organization row is already gone. Do not recreate evidence for a tenant
  -- that is being deliberately deleted (or violate the audit FK while doing so).
  if org_id is null or not exists(select 1 from public.organizations where id=org_id) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  entity_id:=coalesce(
    nullif(row_data->>'id','')::uuid,
    nullif(row_data->>'candidate_id','')::uuid,
    nullif(row_data->>'placement_id','')::uuid,
    nullif(row_data->>'job_candidate_id','')::uuid
  );

  select coalesce(jsonb_agg(field order by field),'[]'::jsonb)
    into changed_fields
  from (
    select key as field
    from jsonb_object_keys(coalesce(before_data,'{}'::jsonb)||coalesce(after_data,'{}'::jsonb)) as keys(key)
    where before_data->key is distinct from after_data->key
  ) changed;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(
    org_id,auth.uid(),lower(tg_table_name)||'.'||lower(tg_op),tg_table_name,entity_id,
    jsonb_strip_nulls(jsonb_build_object(
      'changed_at',now(),
      'changed_fields',changed_fields,
      'before_hash',case when before_data is null then null else encode(digest(before_data::text,'sha256'),'hex') end,
      'after_hash',case when after_data is null then null else encode(digest(after_data::text,'sha256'),'hex') end
    ))
  );
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.audit_row_change() from public,anon,authenticated;

-- Membership-role and role-permission links do not carry organization_id, so
-- the generic trigger cannot attribute them. These are the highest-risk access
-- changes in the system and need the same immutable, hash-only evidence.
create or replace function public.audit_access_link_change()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare
  before_data jsonb:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  after_data jsonb:=case when tg_op='DELETE' then null else to_jsonb(new) end;
  row_data jsonb:=coalesce(after_data,before_data);
  org_id uuid;
  entity_id uuid;
  changed_fields jsonb;
begin
  if tg_table_name='member_roles' then
    select organization_id into org_id
    from public.organization_members
    where id=nullif(row_data->>'member_id','')::uuid;
    entity_id:=nullif(row_data->>'member_id','')::uuid;
  elsif tg_table_name='role_permissions' then
    select organization_id into org_id
    from public.roles
    where id=nullif(row_data->>'role_id','')::uuid;
    entity_id:=nullif(row_data->>'role_id','')::uuid;
  else
    raise exception 'unsupported_access_audit_table' using errcode='22023';
  end if;

  if org_id is null or not exists(select 1 from public.organizations where id=org_id) then
    return case when tg_op='DELETE' then old else new end;
  end if;

  select coalesce(jsonb_agg(field order by field),'[]'::jsonb)
    into changed_fields
  from (
    select key as field
    from jsonb_object_keys(coalesce(before_data,'{}'::jsonb)||coalesce(after_data,'{}'::jsonb)) as keys(key)
    where before_data->key is distinct from after_data->key
  ) changed;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(
    org_id,auth.uid(),lower(tg_table_name)||'.'||lower(tg_op),tg_table_name,entity_id,
    jsonb_strip_nulls(jsonb_build_object(
      'changed_at',now(),
      'changed_fields',changed_fields,
      'before_hash',case when before_data is null then null else encode(digest(before_data::text,'sha256'),'hex') end,
      'after_hash',case when after_data is null then null else encode(digest(after_data::text,'sha256'),'hex') end
    ))
  );
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.audit_access_link_change() from public,anon,authenticated;

drop trigger if exists member_roles_audit on public.member_roles;
create trigger member_roles_audit
  after insert or update or delete on public.member_roles
  for each row execute function public.audit_access_link_change();
drop trigger if exists role_permissions_audit on public.role_permissions;
create trigger role_permissions_audit
  after insert or update or delete on public.role_permissions
  for each row execute function public.audit_access_link_change();

-- Cover security/organization configuration plus the candidate detail tables
-- and core workflow links that were previously invisible in audit history.
do $$ declare table_name text; begin
  foreach table_name in array array[
    'organization_settings','organization_members','roles','organization_invitations',
    'commercial_terms','pipelines','pipeline_stages','templates','job_contacts','job_team_members',
    'candidate_private_details','candidate_employment','candidate_education',
    'candidate_skills','candidate_languages','candidate_consents','candidate_tags',
    'job_candidates','stage_history','submission_packages','candidate_submissions',
    'submission_feedback','activities','notes','task_links','interviews','offers',
    'guarantee_events','documents','document_links'
  ] loop
    if not exists(select 1 from pg_trigger where tgname=table_name||'_audit') then
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
        table_name||'_audit',table_name
      );
    end if;
  end loop;
end $$;

-- Inactivity is broader than candidates.updated_at: a recent pipeline move or
-- logged activity means the consultant is still actively working the person.
create or replace function public.candidate_is_due_for_retention(p_candidate_id uuid,p_as_of timestamptz default now())
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((
    select
      c.deleted_at is null
      and not coalesce(private.legal_hold,false)
      and greatest(
        c.updated_at,
        coalesce(c.last_contacted_at,c.created_at),
        coalesce((select max(jc.updated_at) from public.job_candidates jc where jc.candidate_id=c.id),c.created_at),
        coalesce((
          select max(activity.occurred_at)
          from public.activity_links link
          join public.activities activity on activity.id=link.activity_id
          where link.candidate_id=c.id
        ),c.created_at)
      ) < p_as_of-make_interval(months=>settings.candidate_retention_months)
      and not exists(
        select 1 from public.job_candidates jc
        join public.jobs job on job.id=jc.job_id
        where jc.candidate_id=c.id and jc.closed_at is null
          and job.deleted_at is null and job.status in ('draft','open','on_hold')
      )
    from public.candidates c
    join public.organization_settings settings on settings.organization_id=c.organization_id
    left join public.candidate_private_details private on private.candidate_id=c.id
    where c.id=p_candidate_id
  ),false)
$$;
revoke all on function public.candidate_is_due_for_retention(uuid,timestamptz) from public,anon,authenticated;

create or replace function public.candidate_retention_storage_paths(p_candidate_id uuid)
returns text[] language sql stable security definer set search_path=public as $$
  select coalesce(array_agg(distinct paths.storage_path order by paths.storage_path),'{}'::text[])
  from (
    select document.storage_path
    from public.document_links link
    join public.documents document on document.id=link.document_id and document.deleted_at is null
    where link.candidate_id=p_candidate_id
    union
    select document.storage_path
    from public.job_candidates jc
    join public.candidate_submissions submission on submission.job_candidate_id=jc.id
    join public.submission_documents attached on attached.candidate_submission_id=submission.id
    join public.documents document on document.id=attached.document_id and document.deleted_at is null
    where jc.candidate_id=p_candidate_id
    union
    select document.storage_path
    from public.candidate_profile_versions profile
    join public.documents document on document.id in (profile.docx_document_id,profile.pdf_document_id)
      and document.deleted_at is null
    where profile.candidate_id=p_candidate_id
    union
    select parse.storage_path
    from public.candidate_cv_parses parse
    where parse.target_candidate_id=p_candidate_id and parse.status not in ('cancelled','expired')
    union
    select referral.resume_path
    from public.referrals referral
    where referral.created_candidate_id=p_candidate_id and referral.resume_path is not null
  ) paths
$$;
revoke all on function public.candidate_retention_storage_paths(uuid) from public,anon,authenticated;

create or replace function public.list_candidates_due_for_retention(p_limit integer default 100,p_as_of timestamptz default now())
returns table(candidate_id uuid,storage_paths text[])
language sql stable security definer set search_path=public as $$
  select candidate.id,public.candidate_retention_storage_paths(candidate.id)
  from public.candidates candidate
  where public.candidate_is_due_for_retention(candidate.id,p_as_of)
  order by candidate.updated_at,candidate.id
  limit greatest(1,least(coalesce(p_limit,100),500))
$$;
revoke all on function public.list_candidates_due_for_retention(integer,timestamptz) from public,anon,authenticated;
grant execute on function public.list_candidates_due_for_retention(integer,timestamptz) to service_role;

create or replace function public.preview_candidate_retention(p_organization_id uuid)
returns table(due_count bigint,legal_hold_count bigint,oldest_due_at timestamptz)
language sql stable security definer set search_path=public as $$
  select
    count(*) filter(where public.candidate_is_due_for_retention(candidate.id,now())),
    count(*) filter(where coalesce(private.legal_hold,false)),
    min(candidate.updated_at) filter(where public.candidate_is_due_for_retention(candidate.id,now()))
  from public.candidates candidate
  left join public.candidate_private_details private on private.candidate_id=candidate.id
  where candidate.organization_id=p_organization_id and candidate.deleted_at is null
    and public.has_permission(p_organization_id,'organization.manage')
$$;
revoke all on function public.preview_candidate_retention(uuid) from public,anon;
grant execute on function public.preview_candidate_retention(uuid) to authenticated;

create or replace function public.set_candidate_legal_hold(
  p_organization_id uuid,p_candidate_id uuid,p_legal_hold boolean,p_reason text
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.has_permission(p_organization_id,'organization.manage') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(trim(coalesce(p_reason,'')))<5 then
    raise exception 'legal_hold_reason_required' using errcode='22023';
  end if;
  if not exists(select 1 from public.candidates where id=p_candidate_id and organization_id=p_organization_id) then
    raise exception 'candidate_not_found' using errcode='P0002';
  end if;
  update public.candidate_private_details set legal_hold=p_legal_hold,updated_at=now()
  where candidate_id=p_candidate_id and organization_id=p_organization_id;
  if not found then raise exception 'candidate_private_details_not_found' using errcode='P0002'; end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),case when p_legal_hold then 'candidate.legal_hold_set' else 'candidate.legal_hold_removed' end,
    'candidates',p_candidate_id,jsonb_build_object('reason',trim(p_reason),'changed_at',now()));
end $$;
revoke all on function public.set_candidate_legal_hold(uuid,uuid,boolean,text) from public,anon;
grant execute on function public.set_candidate_legal_hold(uuid,uuid,boolean,text) to authenticated;

create or replace function public.anonymize_candidate_for_retention(
  p_candidate_id uuid,p_removed_storage_paths text[] default '{}'::text[],p_as_of timestamptz default now()
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  candidate_row public.candidates%rowtype;
  current_paths text[];
  policy_months integer;
begin
  select * into candidate_row from public.candidates where id=p_candidate_id for update;
  if candidate_row.id is null then raise exception 'candidate_not_found' using errcode='P0002'; end if;
  if not public.candidate_is_due_for_retention(p_candidate_id,p_as_of) then
    raise exception 'candidate_not_due_for_retention' using errcode='55000';
  end if;

  current_paths:=public.candidate_retention_storage_paths(p_candidate_id);
  if not current_paths <@ coalesce(p_removed_storage_paths,'{}'::text[]) then
    raise exception 'retention_storage_changed' using errcode='40001';
  end if;

  select candidate_retention_months into policy_months
  from public.organization_settings where organization_id=candidate_row.organization_id;

  update public.activities activity set subject=null,summary='Candidate activity removed under retention policy.'
  where exists(
    select 1 from public.activity_links link where link.activity_id=activity.id and (
      link.candidate_id=p_candidate_id
      or exists(select 1 from public.candidate_submissions submission join public.job_candidates jc on jc.id=submission.job_candidate_id where submission.id=link.candidate_submission_id and jc.candidate_id=p_candidate_id)
      or exists(select 1 from public.placements placement where placement.id=link.placement_id and placement.candidate_id=p_candidate_id)
    )
  );
  update public.notes note set content='Candidate note removed under retention policy.'
  where exists(
    select 1 from public.note_links link where link.note_id=note.id and (
      link.candidate_id=p_candidate_id
      or exists(select 1 from public.candidate_submissions submission join public.job_candidates jc on jc.id=submission.job_candidate_id where submission.id=link.candidate_submission_id and jc.candidate_id=p_candidate_id)
      or exists(select 1 from public.placements placement where placement.id=link.placement_id and placement.candidate_id=p_candidate_id)
    )
  );
  update public.tasks task set title='Retained candidate follow-up',description=null,
    status=case when task.status in ('open','in_progress') then 'cancelled' else task.status end,
    due_at=null,updated_at=now()
  where exists(
    select 1 from public.task_links link where link.task_id=task.id and (
      link.candidate_id=p_candidate_id
      or exists(select 1 from public.candidate_submissions submission join public.job_candidates jc on jc.id=submission.job_candidate_id where submission.id=link.candidate_submission_id and jc.candidate_id=p_candidate_id)
      or exists(select 1 from public.placements placement where placement.id=link.placement_id and placement.candidate_id=p_candidate_id)
    )
  );

  update public.stage_history history set note=null
  where exists(select 1 from public.job_candidates jc where jc.id=history.job_candidate_id and jc.candidate_id=p_candidate_id);
  update public.interviews interview set notes=null,meeting_url=null,location=null
  where exists(select 1 from public.job_candidates jc where jc.id=interview.job_candidate_id and jc.candidate_id=p_candidate_id);
  delete from public.interview_attendees attendee
  where attendee.external_email is not null and exists(
    select 1 from public.interviews interview
    join public.job_candidates jc on jc.id=interview.job_candidate_id
    where interview.id=attendee.interview_id and jc.candidate_id=p_candidate_id
  );

  update public.offers offer set notes=null
  where exists(select 1 from public.job_candidates jc where jc.id=offer.job_candidate_id and jc.candidate_id=p_candidate_id);
  update public.placements placement set notes=null
  where placement.candidate_id=p_candidate_id;
  update public.guarantee_events event set notes=null
  where exists(select 1 from public.placements placement where placement.id=event.placement_id and placement.candidate_id=p_candidate_id);

  update public.candidate_submissions submission set
    candidate_summary='Candidate details removed under retention policy.',recruiter_comments=null,
    suitability_assessment=null,relevant_experience=null,salary=null,expected_salary=null,
    notice_period=null,availability=null,motivation=null,relocation_willingness=null,
    interview_availability=null
  where exists(select 1 from public.job_candidates jc where jc.id=submission.job_candidate_id and jc.candidate_id=p_candidate_id);
  update public.submission_feedback feedback set comments=null
  where exists(
    select 1 from public.candidate_submissions submission
    join public.job_candidates jc on jc.id=submission.job_candidate_id
    where submission.id=feedback.candidate_submission_id and jc.candidate_id=p_candidate_id
  );
  update public.ai_evaluations set evidence='[]'::jsonb,matched_requirements='[]'::jsonb,
    missing_requirements='[]'::jsonb,uncertainties='[]'::jsonb,summary=null,score=null,raw_response=null
  where candidate_id=p_candidate_id;
  update public.candidate_profile_versions set generated_content='{"retained":true}'::jsonb,
    reviewed_content=case when reviewed_content is null then null else '{"retained":true}'::jsonb end,
    template_snapshot='{"retained":true}'::jsonb,input_versions='{}'::jsonb,export_failure_reason=null
  where candidate_id=p_candidate_id;

  update public.documents document set deleted_at=coalesce(deleted_at,now()),is_current=false,
    file_name='retained-'||document.id::text,original_filename=null
  where document.storage_path=any(current_paths);
  update public.candidate_cv_parses set status='expired',original_filename='retained-'||id::text,
    storage_path='retained/'||organization_id::text||'/'||id::text,
    extracted_data=null,field_evidence='{}'::jsonb,uncertainties='[]'::jsonb,error_code=null,error_message=null
  where target_candidate_id=p_candidate_id;

  update public.referrals set candidate_full_name='Retained candidate',candidate_email=null,
    candidate_linkedin_url=null,candidate_note=null,resume_path=null
  where created_candidate_id=p_candidate_id;
  update public.candidate_merge_history set reason='Candidate merge retained for integrity.'
  where kept_candidate_id=p_candidate_id or merged_candidate_id=p_candidate_id;

  delete from public.candidate_employment where candidate_id=p_candidate_id;
  delete from public.candidate_education where candidate_id=p_candidate_id;
  delete from public.candidate_skills where candidate_id=p_candidate_id;
  delete from public.candidate_languages where candidate_id=p_candidate_id;
  delete from public.candidate_preferred_locations where candidate_id=p_candidate_id;
  delete from public.candidate_tags where candidate_id=p_candidate_id;
  update public.candidate_consents set evidence=null where candidate_id=p_candidate_id;
  update public.candidate_private_details set email=null,phone=null,current_salary=null,expected_salary=null,
    salary_currency=null,work_authorization=null,consent_status='expired',consent_expires_at=coalesce(consent_expires_at,now()),updated_at=now()
  where candidate_id=p_candidate_id;
  update public.candidates set full_name='Retained candidate '||left(id::text,8),current_company=null,
    current_position=null,location=null,linkedin_url=null,portfolio_url=null,status='archived',
    source=null,availability=null,notice_period_days=null,last_contacted_at=null,owner_member_id=null,
    updated_by=null,deleted_at=now(),updated_at=now()
  where id=p_candidate_id;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(candidate_row.organization_id,null,'candidate.retained','candidates',p_candidate_id,
    jsonb_build_object('policy_months',policy_months,'files_removed',cardinality(current_paths),'retained_at',now()));
  return true;
end $$;
revoke all on function public.anonymize_candidate_for_retention(uuid,text[],timestamptz) from public,anon,authenticated;
grant execute on function public.anonymize_candidate_for_retention(uuid,text[],timestamptz) to service_role;

-- Import rows are a temporary migration aid, not a second permanent candidate
-- database. Once the rollback window has passed, keep reconciliation counts and
-- mappings but remove the raw spreadsheet payload and potentially identifying
-- filenames for every completed/rolled-back batch.
create or replace function public.redact_expired_import_payloads(p_before timestamptz default now()-interval '30 days')
returns bigint language plpgsql security definer set search_path=public as $$
declare redacted_count bigint;
begin
  update public.import_rows row set source_data='{"retained":true}'::jsonb,mapped_data='{"retained":true}'::jsonb
  where exists(
    select 1 from public.imports batch
    where batch.id=row.import_id and batch.status in ('completed','rolled_back')
      and coalesce(batch.completed_at,batch.rolled_back_at,batch.created_at)<p_before
  ) and (row.source_data<>'{"retained":true}'::jsonb or row.mapped_data is distinct from '{"retained":true}'::jsonb);
  get diagnostics redacted_count=row_count;
  update public.imports batch set file_name='retained-'||batch.id::text,
    source_filename=case when source_filename is null then null else 'retained-'||batch.id::text end
  where batch.status in ('completed','rolled_back')
    and coalesce(batch.completed_at,batch.rolled_back_at,batch.created_at)<p_before
    and (batch.file_name<>('retained-'||batch.id::text) or (batch.source_filename is not null and batch.source_filename<>('retained-'||batch.id::text)));
  return redacted_count;
end $$;
revoke all on function public.redact_expired_import_payloads(timestamptz) from public,anon,authenticated;
grant execute on function public.redact_expired_import_payloads(timestamptz) to service_role;

commit;
