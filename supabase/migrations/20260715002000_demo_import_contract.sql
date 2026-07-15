begin;

alter table public.imports drop constraint if exists imports_entity_type_check;
alter table public.imports add constraint imports_entity_type_check check(entity_type in (
  'candidates','candidate_employment','candidate_education','candidate_languages',
  'companies','contacts','jobs','job_candidates','submissions','tasks','activities',
  'interviews','offers','placements','revenue_splits','invoices'
));

-- Keep the existing submission behavior, but return the journal activity ID as well as the
-- package ID so controlled imports can track and fully roll back every side effect.
create or replace function public.create_submission_package(
  p_organization_id uuid,
  p_job_id uuid,
  p_title text,
  p_items jsonb,
  p_contact_id uuid default null,
  p_message text default null,
  p_recipient_name text default null,
  p_recipient_email text default null,
  p_expiry_days integer default 7
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  package_id uuid;
  link_id uuid;
  activity_id uuid;
  raw_token text;
  item jsonb;
  jc public.job_candidates;
  expires timestamptz;
  links jsonb;
  company_name text;
  candidate_count integer:=0;
begin
  if not public.has_permission(p_organization_id,'submissions.write') then raise exception 'Access denied'; end if;
  if p_expiry_days not between 1 and 30 then raise exception 'Expiry must be 1 to 30 days'; end if;

  insert into public.submission_packages(organization_id,job_id,contact_id,title,message,status,created_by)
    values(p_organization_id,p_job_id,p_contact_id,p_title,p_message,'shared',auth.uid())
    returning id into package_id;

  links:=jsonb_build_array(jsonb_build_object('job_id',p_job_id));
  if p_contact_id is not null then links:=links||jsonb_build_array(jsonb_build_object('contact_id',p_contact_id)); end if;

  for item in select * from jsonb_array_elements(p_items) loop
    select * into jc from public.job_candidates
      where id=(item->>'job_candidate_id')::uuid and job_id=p_job_id and organization_id=p_organization_id;
    if jc.id is null then raise exception 'Candidate not found'; end if;
    insert into public.candidate_submissions(
      organization_id,package_id,job_candidate_id,candidate_summary,recruiter_comments,
      suitability_assessment,relevant_experience,expected_salary,currency,notice_period,
      availability,motivation,relocation_willingness,interview_availability
    ) values(
      p_organization_id,package_id,jc.id,coalesce(item->>'candidate_summary',''),item->>'recruiter_comments',
      item->>'suitability_assessment',item->>'relevant_experience',nullif(item->>'expected_salary','')::numeric,
      item->>'currency',item->>'notice_period',item->>'availability',item->>'motivation',
      item->>'relocation_willingness',item->>'interview_availability'
    );
    links:=links||jsonb_build_array(jsonb_build_object('candidate_id',jc.candidate_id));
    candidate_count:=candidate_count+1;
  end loop;

  raw_token:=encode(extensions.gen_random_bytes(32),'base64');
  raw_token:=replace(replace(replace(raw_token,'+','-'),'/','_'),'=','');
  expires:=now()+make_interval(days=>p_expiry_days);
  insert into public.public_submission_links(
    organization_id,package_id,token_hash,token_prefix,recipient_name,recipient_email,expires_at,created_by
  ) values(
    p_organization_id,package_id,encode(extensions.digest(raw_token,'sha256'),'hex'),left(raw_token,8),
    p_recipient_name,public.normalize_email(p_recipient_email),expires,auth.uid()
  ) returning id into link_id;

  select co.name into company_name from public.jobs j join public.companies co on co.id=j.company_id where j.id=p_job_id;
  activity_id:=public.log_activity(
    p_organization_id,'submission',
    format('%s candidate%s sent to %s for review',candidate_count,case when candidate_count=1 then '' else 's' end,coalesce(company_name,'the client')),
    p_title,'outbound',auth.uid(),links
  );

  return jsonb_build_object(
    'package_id',package_id,
    'link_id',link_id,
    'activity_id',activity_id,
    'token',raw_token,
    'expires_at',expires
  );
end $$;

grant execute on function public.create_submission_package(uuid,uuid,text,jsonb,uuid,text,text,text,integer) to authenticated;

commit;
