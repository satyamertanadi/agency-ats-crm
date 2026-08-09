begin;

-- Pre-launch subtraction: drop the schema nothing can reach.
--
-- Every table below was verified against src/, supabase/functions/ and extension/src/ before being
-- listed here: no reads, no writes, no edge-function use. Some are wholly unreferenced; the rest
-- ("effectively dead") are touched only by merge/retention housekeeping and are never populated by
-- anything. Doing this before migration day is the difference between a DROP and a data migration.
--
-- NOT dropped, despite appearing on the audit's "truly dead" list: public.ai_evaluations. It is
-- live and load-bearing -- generate-candidate-profile inserts a row per generation and updates it
-- on completion, candidate_profile_versions.ai_evaluation_id is a NOT NULL foreign key to it,
-- finalize_candidate_profile checks its status, and candidate_profile_token_spend_this_month sums
-- it to enforce the monthly AI cost ceiling. Dropping it would break candidate profile generation
-- and remove the only cap on ANTHROPIC_API_KEY spend.

-- Dependent objects first. Policies and constraints go with their table via cascade, but plpgsql
-- function bodies are only resolved at call time, so a reference to a dropped table would sit there
-- as a latent runtime failure. Each affected function is redefined below without those statements.

-- merge_candidates: loses its candidate_consents, candidate_preferred_locations and note_links
-- statements. The ai_evaluations reparent stays -- that table is not going anywhere.
create or replace function public.merge_candidates(p_organization_id uuid,p_kept_candidate_id uuid,p_merged_candidate_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare kept public.candidates;merged public.candidates;kept_private public.candidate_private_details;merged_private public.candidate_private_details;
begin
  if p_kept_candidate_id=p_merged_candidate_id then raise exception 'same_candidate'; end if;
  if not public.has_permission(p_organization_id,'candidates.write') or not public.has_permission(p_organization_id,'candidates_private.read') then raise exception 'permission_denied'; end if;
  select * into kept from public.candidates where id=p_kept_candidate_id and organization_id=p_organization_id for update;
  select * into merged from public.candidates where id=p_merged_candidate_id and organization_id=p_organization_id for update;
  if kept.id is null or merged.id is null then raise exception 'candidate_not_found'; end if;
  if exists(select 1 from public.job_candidates a join public.job_candidates b on b.job_id=a.job_id where a.candidate_id=p_kept_candidate_id and b.candidate_id=p_merged_candidate_id) then raise exception 'merge_conflicting_job_assignments'; end if;

  select * into kept_private from public.candidate_private_details where candidate_id=p_kept_candidate_id;
  select * into merged_private from public.candidate_private_details where candidate_id=p_merged_candidate_id;
  if merged_private.candidate_id is not null then
    if kept_private.candidate_id is null then update public.candidate_private_details set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
    else
      delete from public.candidate_private_details where candidate_id=p_merged_candidate_id;
      update public.candidate_private_details set
        email=coalesce(email,merged_private.email),phone=coalesce(phone,merged_private.phone),current_salary=coalesce(current_salary,merged_private.current_salary),expected_salary=coalesce(expected_salary,merged_private.expected_salary),salary_currency=coalesce(salary_currency,merged_private.salary_currency),work_authorization=coalesce(work_authorization,merged_private.work_authorization),
        consent_status=case when consent_status='withdrawn' or merged_private.consent_status='withdrawn' then 'withdrawn' when consent_status='granted' or merged_private.consent_status='granted' then 'granted' else consent_status end,
        consent_expires_at=coalesce(consent_expires_at,merged_private.consent_expires_at),legal_hold=legal_hold or merged_private.legal_hold,updated_at=now()
      where candidate_id=p_kept_candidate_id;
    end if;
  end if;

  update public.candidates set current_company=coalesce(current_company,merged.current_company),current_position=coalesce(current_position,merged.current_position),location=coalesce(location,merged.location),linkedin_url=coalesce(linkedin_url,merged.linkedin_url),portfolio_url=coalesce(portfolio_url,merged.portfolio_url),owner_member_id=coalesce(owner_member_id,merged.owner_member_id),source=concat_ws(' / ',nullif(source,''),nullif(merged.source,'')),status=case when status='do_not_contact' or merged.status='do_not_contact' then 'do_not_contact' else status end,updated_by=auth.uid(),updated_at=now() where id=p_kept_candidate_id;
  update public.job_candidates set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.placements set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.candidate_employment set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.candidate_education set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  insert into public.candidate_skills(candidate_id,skill_id,organization_id,proficiency,years_experience) select p_kept_candidate_id,skill_id,organization_id,proficiency,years_experience from public.candidate_skills where candidate_id=p_merged_candidate_id on conflict(candidate_id,skill_id) do nothing;
  delete from public.candidate_skills where candidate_id=p_merged_candidate_id;
  insert into public.candidate_languages(candidate_id,organization_id,language,proficiency) select p_kept_candidate_id,organization_id,language,proficiency from public.candidate_languages where candidate_id=p_merged_candidate_id on conflict(candidate_id,language) do nothing;
  delete from public.candidate_languages where candidate_id=p_merged_candidate_id;
  insert into public.candidate_tags(candidate_id,tag_id,organization_id) select p_kept_candidate_id,tag_id,organization_id from public.candidate_tags where candidate_id=p_merged_candidate_id on conflict(candidate_id,tag_id) do nothing;
  delete from public.candidate_tags where candidate_id=p_merged_candidate_id;
  update public.activity_links set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.task_links set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.document_links set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  update public.ai_evaluations set candidate_id=p_kept_candidate_id where candidate_id=p_merged_candidate_id;
  insert into public.candidate_merge_history(organization_id,kept_candidate_id,merged_candidate_id,merged_by,reason) values(p_organization_id,p_kept_candidate_id,p_merged_candidate_id,auth.uid(),coalesce(nullif(trim(p_reason),''),'Duplicate record'));
  update public.candidates set status='archived',deleted_at=now(),updated_by=auth.uid(),updated_at=now() where id=p_merged_candidate_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(p_organization_id,auth.uid(),'candidate.merged','candidate',p_kept_candidate_id,jsonb_build_object('merged_candidate_id',p_merged_candidate_id,'reason',p_reason));
  return p_kept_candidate_id;
end $$;
revoke all on function public.merge_candidates(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.merge_candidates(uuid,uuid,uuid,text) to authenticated;

-- anonymize_candidate_for_retention: loses its notes, guarantee_events, referrals,
-- candidate_preferred_locations and candidate_consents statements. Nothing stops being anonymized
-- that was not already covered -- the extension's capture note is now an activity, and the
-- activities redaction immediately above it handles those.
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

  update public.candidate_merge_history set reason='Candidate merge retained for integrity.'
  where kept_candidate_id=p_candidate_id or merged_candidate_id=p_candidate_id;

  delete from public.candidate_employment where candidate_id=p_candidate_id;
  delete from public.candidate_education where candidate_id=p_candidate_id;
  delete from public.candidate_skills where candidate_id=p_candidate_id;
  delete from public.candidate_languages where candidate_id=p_candidate_id;
  delete from public.candidate_tags where candidate_id=p_candidate_id;
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
revoke all on function public.anonymize_candidate_for_retention(uuid,text[],timestamptz) from public, anon, authenticated;
grant execute on function public.anonymize_candidate_for_retention(uuid,text[],timestamptz) to service_role;

-- candidate_retention_storage_paths unions in referral resume paths. It is `language sql` with a
-- string body, so Postgres tracks no dependency on the table and the drop would leave it to fail at
-- call time -- inside the hourly retention worker, which is the worst place for it. Same function
-- without that branch; referral resumes cease to exist along with the table.
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
  ) paths
$$;

revoke all on function public.candidate_retention_storage_paths(uuid) from public, anon, authenticated;

-- Referrals: a whole page, public link minting with revocation, an inbox with four status filters,
-- an accept/reject flow, three tables, five RPCs and a public route -- for an activity a six-person
-- headhunting desk does over WhatsApp. "Add candidate" with source 'referral' records the same fact
-- in one step, and nothing in the recruitment workflow depended on any of it.
drop function if exists public.accept_referral(uuid,uuid);
drop function if exists public.submit_internal_referral(uuid,jsonb);
drop function if exists public.submit_referral(text,jsonb);
drop function if exists public.resolve_referral_link(text);
drop function if exists public.create_referral_link(uuid,text,uuid,integer);

drop table if exists public.referral_link_events cascade;
drop table if exists public.referrals cascade;
drop table if exists public.referral_links cascade;

-- The write-only note path (see 20260810020000_capture_prospect_note_to_activity.sql):
-- capture_prospect now logs an activity, so nothing writes here and nothing ever read it.
drop table if exists public.note_links cascade;
drop table if exists public.notes cascade;

-- Wholly unreferenced.
drop table if exists public.background_jobs cascade;
drop table if exists public.integrations cascade;
drop table if exists public.task_reminders cascade;
drop table if exists public.job_target_companies cascade;
drop table if exists public.company_tags cascade;
drop table if exists public.contact_tags cascade;
drop table if exists public.job_tags cascade;
drop table if exists public.exports cascade;

-- Effectively dead: only merge/retention housekeeping ever touched these and nothing ever wrote a
-- row. Consent lives on candidate_private_details (consent_status / consent_expires_at), and the
-- real guarantee field is placements.guarantee_days.
drop table if exists public.candidate_preferred_locations cascade;
drop table if exists public.candidate_consents cascade;
drop table if exists public.guarantee_events cascade;

-- exports.manage is now orphaned: the only table it ever governed is gone. Remove the grants first,
-- then the key, so no role keeps a permission that cannot mean anything.
delete from public.role_permissions where permission_key='exports.manage';
delete from public.permissions where key='exports.manage';

commit;
