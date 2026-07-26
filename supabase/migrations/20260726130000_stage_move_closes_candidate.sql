-- job_candidates.closed_at has existed since the initial schema and has never been written by
-- anything. Every query that filters `closed_at is null` -- which is how "still in play" is expressed
-- across the pipeline reads -- has therefore been a no-op returning rejected and withdrawn candidates
-- alongside live ones, and the only reason the boards look right is that outcome stages are filtered
-- out of the columns separately (isOutcomeStage in workflow.ts).
--
-- Moving a candidate to a rejected or withdrawn stage is exactly the event that closes their run, and
-- this function is the single path every stage change goes through, so it is the one correct place to
-- stamp it.
--
-- Three deliberate choices:
--
-- 1. 'on_hold' does NOT close. It is an outcome stage for board-layout purposes (it gets a counter
--    rather than a column) but the candidate is still in play -- closing them would hide a paused
--    candidate from every "still open" count, which is the opposite of what on-hold means.
--
-- 2. Moving back out of a closed stage clears closed_at, so reinstating a rejected candidate reopens
--    them with no extra call. Reinstatement is a plain stage move; it should not need its own RPC.
--
-- 3. Re-closing an already-closed candidate keeps the original timestamp (coalesce on the pre-update
--    value). Changing an outcome from rejected to withdrawn is a correction of *why* they closed, not
--    a claim that they closed today -- and time-to-close reporting reads this column.
--
-- Same signature, so tests/rls/rpc-acl.expected.json needs no change. Body is otherwise reproduced
-- verbatim from 20260715001000_activity_feed.sql.
begin;

create or replace function public.move_job_candidate_stage(p_job_candidate_id uuid,p_stage_id uuid,p_note text default null,p_source text default 'manual')
returns public.job_candidates language plpgsql security definer set search_path=public as $$
declare item public.job_candidates; old_stage uuid; to_stage_name text; from_stage_name text; target_type text;
begin
  select * into item from public.job_candidates where id=p_job_candidate_id;
  if item.id is null or not public.has_permission(item.organization_id,'pipeline.move') then raise exception 'Record not found'; end if;
  if not exists(select 1 from public.pipeline_stages s join public.jobs j on j.pipeline_id=s.pipeline_id where s.id=p_stage_id and j.id=item.job_id and s.organization_id=item.organization_id) then raise exception 'Invalid pipeline stage'; end if;
  old_stage:=item.current_stage_id;
  select stage_type into target_type from public.pipeline_stages where id=p_stage_id;
  update public.job_candidates set current_stage_id=p_stage_id,
    closed_at=case when target_type in ('rejected','withdrawn') then coalesce(item.closed_at,now()) else null end,
    updated_at=now() where id=item.id returning * into item;
  insert into public.stage_history(organization_id,job_candidate_id,from_stage_id,to_stage_id,changed_by,source,note) values(item.organization_id,item.id,old_stage,p_stage_id,auth.uid(),p_source,p_note);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(item.organization_id,auth.uid(),'pipeline.stage_changed','job_candidate',item.id,jsonb_build_object('from',old_stage,'to',p_stage_id));

  -- create_placement_from_offer moves the candidate to the placed stage itself and logs a richer
  -- 'placement' activity; without this the feed would carry both for one event.
  if p_source is distinct from 'placement' then
    select name into to_stage_name from public.pipeline_stages where id=p_stage_id;
    select name into from_stage_name from public.pipeline_stages where id=old_stage;
    perform public.log_activity(
      item.organization_id,'status_change',
      coalesce(nullif(p_note,''), case when from_stage_name is null then format('Moved to %s',to_stage_name) else format('Moved from %s to %s',from_stage_name,to_stage_name) end),
      format('Pipeline: %s',coalesce(to_stage_name,'stage changed')),'internal',auth.uid(),
      jsonb_build_array(jsonb_build_object('candidate_id',item.candidate_id),jsonb_build_object('job_id',item.job_id)));
  end if;
  return item;
end $$;
revoke all on function public.move_job_candidate_stage(uuid,uuid,text,text) from public,anon;
grant execute on function public.move_job_candidate_stage(uuid,uuid,text,text) to authenticated;

commit;
