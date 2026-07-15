-- Activity feed.
--
-- The activities and activity_links tables, their RLS policies, and the activities.read/.write
-- permissions for consultant/sourcer/bd have existed since the initial schema, but nothing ever
-- wrote to them: the dashboard's "Recent activity" panel could never populate, and a recruiter had
-- no way to record a phone call -- the most frequent action in an ATS.
--
-- Writes live in the existing security definer RPCs rather than in triggers. activities.created_by
-- is `not null references auth.users(id)`, and execute-import runs as service_role where auth.uid()
-- is null, so a trigger on job_candidates would fail every import. A trigger would also emit one
-- activity per imported row and drown the feed. Routing through the RPCs means imports skip the
-- feed, which is the desired outcome rather than a gap.

-- One activity, many link rows: activity_links checks num_nonnulls(...)=1 per row, so a stage move
-- writes {candidate_id} and {job_id} as separate rows and surfaces on both feeds from one activity.
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
declare activity_id uuid; link jsonb; actor uuid := coalesce(p_actor, auth.uid());
begin
  -- created_by is NOT NULL. Rather than fail the caller's real work (a stage move, a placement)
  -- because we could not attribute it, skip the journal entry.
  if actor is null then return null; end if;

  insert into public.activities(organization_id,activity_type,direction,subject,summary,created_by,occurred_at)
  values(p_organization_id,p_type,p_direction,p_subject,p_summary,actor,coalesce(p_occurred_at,now()))
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

revoke all on function public.log_activity(uuid,text,text,text,text,uuid,jsonb,timestamptz) from public, anon, authenticated;

-- The recruiter-facing entry point. Deliberately narrower than log_activity: it accepts only the
-- types a human records by hand, so status_change/submission/placement/client_feedback remain
-- provable system output that a consultant cannot forge. Writing the activity and its links in one
-- security definer call also keeps them atomic, which a client-side insert pair could not be.
create or replace function public.log_manual_activity(
  p_organization_id uuid,
  p_type text,
  p_summary text,
  p_subject text default null,
  p_direction text default null,
  p_occurred_at timestamptz default null,
  p_links jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
begin
  if not public.has_permission(p_organization_id,'activities.write') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_type not in ('call','email','whatsapp','meeting','other') then raise exception 'invalid_activity_type' using errcode='22023'; end if;
  if p_direction is not null and p_direction not in ('inbound','outbound','internal') then raise exception 'invalid_direction' using errcode='22023'; end if;
  if coalesce(trim(p_summary),'')='' then raise exception 'summary_required' using errcode='22023'; end if;
  if p_occurred_at is not null and p_occurred_at > now() + interval '1 minute' then raise exception 'occurred_at_in_future' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(p_links,'[]'::jsonb))=0 then raise exception 'link_required' using errcode='22023'; end if;
  return public.log_activity(p_organization_id,p_type,p_summary,p_subject,p_direction,auth.uid(),p_links,p_occurred_at);
end $$;

revoke all on function public.log_manual_activity(uuid,text,text,text,text,timestamptz,jsonb) from public, anon;
grant execute on function public.log_manual_activity(uuid,text,text,text,text,timestamptz,jsonb) to authenticated;

-- Stage moves: journal alongside the stage_history and audit_logs writes already in this
-- transaction, so the feed cannot diverge from the history it describes.
create or replace function public.move_job_candidate_stage(p_job_candidate_id uuid,p_stage_id uuid,p_note text default null,p_source text default 'manual')
returns public.job_candidates language plpgsql security definer set search_path=public as $$
declare item public.job_candidates; old_stage uuid; to_stage_name text; from_stage_name text;
begin
  select * into item from public.job_candidates where id=p_job_candidate_id;
  if item.id is null or not public.has_permission(item.organization_id,'pipeline.move') then raise exception 'Record not found'; end if;
  if not exists(select 1 from public.pipeline_stages s join public.jobs j on j.pipeline_id=s.pipeline_id where s.id=p_stage_id and j.id=item.job_id and s.organization_id=item.organization_id) then raise exception 'Invalid pipeline stage'; end if;
  old_stage:=item.current_stage_id;
  update public.job_candidates set current_stage_id=p_stage_id,updated_at=now() where id=item.id returning * into item;
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
grant execute on function public.move_job_candidate_stage(uuid,uuid,text,text) to authenticated;

-- Submissions: one activity fanned out to the vacancy, the client contact, and every candidate in
-- the package, so each candidate's feed records that they were put forward.
create or replace function public.create_submission_package(p_organization_id uuid,p_job_id uuid,p_title text,p_items jsonb,p_contact_id uuid default null,p_message text default null,p_recipient_name text default null,p_recipient_email text default null,p_expiry_days integer default 7)
returns jsonb language plpgsql security definer set search_path=public as $$
declare package_id uuid; link_id uuid; raw_token text; item jsonb; jc public.job_candidates; expires timestamptz; links jsonb; company_name text; candidate_count integer:=0;
begin
  if not public.has_permission(p_organization_id,'submissions.write') then raise exception 'Access denied'; end if;
  if p_expiry_days not between 1 and 30 then raise exception 'Expiry must be 1 to 30 days'; end if;
  insert into public.submission_packages(organization_id,job_id,contact_id,title,message,status,created_by) values(p_organization_id,p_job_id,p_contact_id,p_title,p_message,'shared',auth.uid()) returning id into package_id;
  links:=jsonb_build_array(jsonb_build_object('job_id',p_job_id));
  if p_contact_id is not null then links:=links||jsonb_build_array(jsonb_build_object('contact_id',p_contact_id)); end if;
  for item in select * from jsonb_array_elements(p_items) loop
    select * into jc from public.job_candidates where id=(item->>'job_candidate_id')::uuid and job_id=p_job_id and organization_id=p_organization_id;
    if jc.id is null then raise exception 'Candidate not found'; end if;
    insert into public.candidate_submissions(organization_id,package_id,job_candidate_id,candidate_summary,recruiter_comments,suitability_assessment,relevant_experience,expected_salary,currency,notice_period,availability,motivation,relocation_willingness,interview_availability)
    values(p_organization_id,package_id,jc.id,coalesce(item->>'candidate_summary',''),item->>'recruiter_comments',item->>'suitability_assessment',item->>'relevant_experience',nullif(item->>'expected_salary','')::numeric,item->>'currency',item->>'notice_period',item->>'availability',item->>'motivation',item->>'relocation_willingness',item->>'interview_availability');
    links:=links||jsonb_build_array(jsonb_build_object('candidate_id',jc.candidate_id));
    candidate_count:=candidate_count+1;
  end loop;
  raw_token:=encode(extensions.gen_random_bytes(32),'base64'); raw_token:=replace(replace(replace(raw_token,'+','-'),'/','_'),'=',''); expires:=now()+make_interval(days=>p_expiry_days);
  insert into public.public_submission_links(organization_id,package_id,token_hash,token_prefix,recipient_name,recipient_email,expires_at,created_by)
  values(p_organization_id,package_id,encode(extensions.digest(raw_token,'sha256'),'hex'),left(raw_token,8),p_recipient_name,public.normalize_email(p_recipient_email),expires,auth.uid()) returning id into link_id;

  select co.name into company_name from public.jobs j join public.companies co on co.id=j.company_id where j.id=p_job_id;
  perform public.log_activity(p_organization_id,'submission',
    format('%s candidate%s sent to %s for review',candidate_count,case when candidate_count=1 then '' else 's' end,coalesce(company_name,'the client')),
    p_title,'outbound',auth.uid(),links);
  return jsonb_build_object('package_id',package_id,'link_id',link_id,'token',raw_token,'expires_at',expires);
end $$;
grant execute on function public.create_submission_package(uuid,uuid,text,jsonb,uuid,text,text,text,integer) to authenticated;

-- Client feedback already wrote an activity but never linked it, so it appeared on no record's feed.
create or replace function public.submit_submission_feedback(p_token text,p_candidate_submission_id uuid,p_decision text,p_comments text default null,p_reviewer_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.public_submission_links; submission public.candidate_submissions; feedback_id uuid; jc public.job_candidates; package_owner uuid;
begin
  if p_decision not in ('approve','reject','interview','hold') then raise exception 'Invalid decision'; end if;
  select * into link from public.public_submission_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null and expires_at>now();
  if link.id is null then raise exception 'Link not found'; end if;
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
revoke all on function public.submit_submission_feedback(text,uuid,text,text,text) from public;
grant execute on function public.submit_submission_feedback(text,uuid,text,text,text) to anon,authenticated;

-- Placements: logged after the stage move, which suppresses its own status_change for this source.
create or replace function public.create_placement_from_offer(p_offer_id uuid,p_fee numeric,p_guarantee_days integer default 90)
returns uuid language plpgsql security definer set search_path=public as $$
declare o public.offers; jc public.job_candidates; j public.jobs; new_id uuid; placed_stage uuid; candidate_name text; company_name text;
begin
  select * into o from public.offers where id=p_offer_id and status='accepted';
  if o.id is null or not public.has_permission(o.organization_id,'placements.write') then raise exception 'Offer not found'; end if;
  select * into jc from public.job_candidates where id=o.job_candidate_id; select * into j from public.jobs where id=jc.job_id;
  insert into public.placements(organization_id,job_candidate_id,offer_id,candidate_id,job_id,company_id,start_date,salary,placement_fee,fee_percentage,fixed_fee,currency,owner_member_id,guarantee_days,created_by)
  values(o.organization_id,jc.id,o.id,jc.candidate_id,j.id,j.company_id,coalesce(o.start_date,current_date),o.salary,p_fee,j.placement_fee_percentage,j.fixed_fee,o.currency,jc.owner_member_id,p_guarantee_days,auth.uid()) returning id into new_id;
  select id into placed_stage from public.pipeline_stages where pipeline_id=j.pipeline_id and stage_type='placed' order by position limit 1;
  if placed_stage is not null then perform public.move_job_candidate_stage(jc.id,placed_stage,'Placement created','placement'); end if;
  update public.candidates set status='placed',updated_by=auth.uid() where id=jc.candidate_id; update public.jobs set status='filled',updated_by=auth.uid() where id=j.id;

  select full_name into candidate_name from public.candidates where id=jc.candidate_id;
  select name into company_name from public.companies where id=j.company_id;
  perform public.log_activity(o.organization_id,'placement',
    format('%s placed at %s as %s',coalesce(candidate_name,'Candidate'),coalesce(company_name,'the client'),j.title),
    'Placement confirmed','internal',auth.uid(),
    jsonb_build_array(jsonb_build_object('candidate_id',jc.candidate_id),jsonb_build_object('job_id',j.id),jsonb_build_object('placement_id',new_id)));
  return new_id;
end $$;
grant execute on function public.create_placement_from_offer(uuid,numeric,integer) to authenticated;
