begin;

-- The administration surface Interview Intelligence shipped without.
--
-- Everything the feature needs to be switched on lived only in the database: the workspace toggles,
-- the digest recipient list, and -- worst of the three -- the agency core rubric, which every
-- analysis requires and which no code path could create. create_interview_rubric_draft raises
-- job_not_found without a job and hardcodes rubric_type='job', so a workspace could generate a job
-- blueprint, import a transcript, map its speakers, and then be refused with core_rubric_required
-- at the last step, with nowhere in the product to resolve it.
--
-- No new tables and no new permissions: the columns, the recipients table and
-- interview_intelligence.configure all already exist. What was missing was a way in.

-- ---------------------------------------------------------------------------------------------
-- The agency core rubric
-- ---------------------------------------------------------------------------------------------

/* Creates the organisation-wide core rubric as a draft.
 *
 * Deliberately a sibling of create_interview_rubric_draft rather than a widening of it. That function
 * proves the job exists before writing anything, which is the check that makes a job blueprint safe;
 * relaxing it to accept a null job would turn a required guard into an optional one for every caller,
 * to serve the one case that has no job at all.
 *
 * Draft, never active. It is activated through activate_interview_rubric like any other rubric --
 * that function already archives the previous active core rubric and takes the same permission -- so
 * there is exactly one place where a rubric becomes the one analyses read.
 */
create or replace function public.create_interview_core_rubric_draft(
  p_organization_id uuid,
  p_name text,
  p_items jsonb
)
returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid; next_version integer; item jsonb; inserted integer:=0;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.can_configure_interview_intelligence(p_organization_id) then
    raise exception 'permission_denied';
  end if;

  -- An empty rubric would let an analysis report full coverage of nothing.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'interview_rubric_empty';
  end if;

  /* One draft at a time. A second draft is almost always somebody opening the page twice, and two
   * drafts with no way to tell them apart is how the wrong one gets activated. */
  if exists(
    select 1 from public.interview_rubrics
    where organization_id=p_organization_id and rubric_type='core' and status='draft'
  ) then raise exception 'interview_core_rubric_draft_exists'; end if;

  -- Versions count every core rubric the agency has ever had, archived ones included, so a version
  -- number is never reused and an analysis citing v2 always means the same v2.
  select coalesce(max(version),0)+1 into next_version
  from public.interview_rubrics
  where organization_id=p_organization_id and rubric_type='core';

  insert into public.interview_rubrics(
    organization_id,job_id,rubric_type,name,version,status,created_by
  ) values (
    p_organization_id,null,'core',coalesce(nullif(trim(p_name),''),'Agency core rubric'),
    next_version,'draft',auth.uid()
  ) returning id into new_id;

  for item in select * from jsonb_array_elements(p_items) loop
    insert into public.interview_rubric_items(
      organization_id,rubric_id,dimension,item_type,label,question_text,evidence_expected,requirement_level,weight,sort_order
    ) values (
      p_organization_id,new_id,
      item->>'dimension',
      item->>'item_type',
      item->>'label',
      nullif(item->>'question_text',''),
      nullif(item->>'evidence_expected',''),
      coalesce(nullif(item->>'requirement_level',''),'nice_to_have'),
      coalesce((item->>'weight')::numeric,1),
      inserted
    );
    inserted:=inserted+1;
  end loop;

  -- Identifiers and counts only, never rubric content.
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_rubric.core_draft_created','interview_rubric',new_id,
    jsonb_build_object('version',next_version,'item_count',inserted));

  return new_id;
end $$;
revoke all on function public.create_interview_core_rubric_draft(uuid,text,jsonb) from public, anon;
grant execute on function public.create_interview_core_rubric_draft(uuid,text,jsonb) to authenticated;

/* Discards a core rubric draft.
 *
 * Drafts only. An active or archived rubric is evidence: an analysis cites the rubric it was judged
 * against, and deleting one would leave assessments explaining themselves against something that no
 * longer exists.
 */
create or replace function public.discard_interview_core_rubric_draft(
  p_organization_id uuid,
  p_rubric_id uuid
)
returns boolean language plpgsql security definer set search_path=public as $$
declare target public.interview_rubrics;
begin
  if not public.can_configure_interview_intelligence(p_organization_id) then
    raise exception 'permission_denied';
  end if;

  select * into target from public.interview_rubrics
  where id=p_rubric_id and organization_id=p_organization_id and rubric_type='core';
  if target.id is null then raise exception 'interview_rubric_not_found'; end if;
  if target.status <> 'draft' then raise exception 'interview_rubric_not_a_draft'; end if;

  delete from public.interview_rubrics where id=p_rubric_id;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_rubric.core_draft_discarded','interview_rubric',p_rubric_id,'{}'::jsonb);
  return true;
end $$;
revoke all on function public.discard_interview_core_rubric_draft(uuid,uuid) from public, anon;
grant execute on function public.discard_interview_core_rubric_draft(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Workspace switches
-- ---------------------------------------------------------------------------------------------

/* The four switches, written through one function gated on interview_intelligence.configure.
 *
 * NOT through the organization_settings table policy, which is gated on organization.manage. Those
 * are different grants held by different people by design: managing a workspace is not the same
 * authority as deciding that every interview on the desk gets analysed by a model. The edge
 * functions already check interview_intelligence.configure, and this keeps one answer to "who may
 * configure this feature" rather than two that can disagree.
 *
 * Null means "leave alone", so a panel can save one switch without restating the others -- and a
 * client that has not been redeployed cannot blank a setting it does not know about yet.
 */
create or replace function public.update_interview_intelligence_settings(
  p_organization_id uuid,
  p_intelligence_enabled boolean default null,
  p_rubric_generation_enabled boolean default null,
  p_meet_auto_import_enabled boolean default null,
  p_auto_analysis_enabled boolean default null,
  p_digest_enabled boolean default null,
  p_digest_local_time time default null,
  p_digest_skip_empty boolean default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare updated public.organization_settings;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.can_configure_interview_intelligence(p_organization_id) then
    raise exception 'permission_denied';
  end if;

  update public.organization_settings set
    interview_intelligence_enabled=coalesce(p_intelligence_enabled,interview_intelligence_enabled),
    interview_rubric_generation_enabled=coalesce(p_rubric_generation_enabled,interview_rubric_generation_enabled),
    interview_meet_auto_import_enabled=coalesce(p_meet_auto_import_enabled,interview_meet_auto_import_enabled),
    interview_auto_analysis_enabled=coalesce(p_auto_analysis_enabled,interview_auto_analysis_enabled),
    interview_digest_enabled=coalesce(p_digest_enabled,interview_digest_enabled),
    interview_digest_local_time=coalesce(p_digest_local_time,interview_digest_local_time),
    interview_digest_skip_empty=coalesce(p_digest_skip_empty,interview_digest_skip_empty),
    updated_at=now(),
    updated_by=auth.uid()
  where organization_id=p_organization_id
  returning * into updated;
  if updated.organization_id is null then raise exception 'organization_not_found'; end if;

  /* Which switches were touched, never a bulk dump of settings. Turning automatic analysis on is a
   * decision about money and about colleagues' work, and it should be answerable later. */
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'interview_intelligence.settings_updated','organization',p_organization_id,
    jsonb_strip_nulls(jsonb_build_object(
      'intelligence_enabled',p_intelligence_enabled,
      'rubric_generation_enabled',p_rubric_generation_enabled,
      'meet_auto_import_enabled',p_meet_auto_import_enabled,
      'auto_analysis_enabled',p_auto_analysis_enabled,
      'digest_enabled',p_digest_enabled,
      'digest_skip_empty',p_digest_skip_empty)));

  return jsonb_build_object(
    'intelligence_enabled',updated.interview_intelligence_enabled,
    'rubric_generation_enabled',updated.interview_rubric_generation_enabled,
    'meet_auto_import_enabled',updated.interview_meet_auto_import_enabled,
    'auto_analysis_enabled',updated.interview_auto_analysis_enabled,
    'digest_enabled',updated.interview_digest_enabled,
    'digest_local_time',updated.interview_digest_local_time,
    'digest_skip_empty',updated.interview_digest_skip_empty);
end $$;
revoke all on function public.update_interview_intelligence_settings(uuid,boolean,boolean,boolean,boolean,boolean,time,boolean) from public, anon;
grant execute on function public.update_interview_intelligence_settings(uuid,boolean,boolean,boolean,boolean,boolean,time,boolean) to authenticated;

/* Reading the same settings back.
 *
 * SECURITY INVOKER so the organization_settings read policy decides who sees the switches -- the
 * panel needs no visibility rule of its own, and cannot acquire one that drifts from the table's.
 */
create or replace function public.get_interview_intelligence_settings(p_organization_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'intelligence_enabled',s.interview_intelligence_enabled,
    'rubric_generation_enabled',s.interview_rubric_generation_enabled,
    'meet_auto_import_enabled',s.interview_meet_auto_import_enabled,
    'auto_analysis_enabled',s.interview_auto_analysis_enabled,
    'digest_enabled',s.interview_digest_enabled,
    'digest_local_time',s.interview_digest_local_time,
    'digest_skip_empty',s.interview_digest_skip_empty,
    'digest_last_success_at',s.interview_digest_last_success_at,
    'timezone',o.timezone,
    'core_rubric_id',(select r.id from public.interview_rubrics r
      where r.organization_id=p_organization_id and r.rubric_type='core' and r.status='active'),
    'core_rubric_draft_id',(select r.id from public.interview_rubrics r
      where r.organization_id=p_organization_id and r.rubric_type='core' and r.status='draft'))
  from public.organization_settings s
  join public.organizations o on o.id=s.organization_id
  where s.organization_id=p_organization_id
$$;
revoke all on function public.get_interview_intelligence_settings(uuid) from public, anon;
grant execute on function public.get_interview_intelligence_settings(uuid) to authenticated;

commit;
