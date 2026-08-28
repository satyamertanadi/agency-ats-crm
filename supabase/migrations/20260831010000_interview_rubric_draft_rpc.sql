begin;

/* Writes a generated blueprint draft and its items in one transaction.
 *
 * The Edge Function could insert the rubric and then its items over two PostgREST calls, but a
 * failure between them leaves an empty blueprint sitting in the job's drawer looking like a draft
 * somebody abandoned -- and activate_interview_rubric would refuse it with "add at least one
 * question", which is a confusing thing to tell someone who never wrote it.
 *
 * Service-role only: the caller is the generation worker, which has already checked the feature flag
 * and interview_intelligence.configure. p_created_by is passed explicitly because auth.uid() is null
 * under the service role, and created_by is NOT NULL.
 */
create or replace function public.create_interview_rubric_draft(
  p_organization_id uuid,
  p_job_id uuid,
  p_created_by uuid,
  p_name text,
  p_source_document_id uuid,
  p_job_brief_hash text,
  p_ai_evaluation_id uuid,
  p_items jsonb
)
returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid; next_version integer; item jsonb; inserted integer:=0;
begin
  if not exists(
    select 1 from public.jobs j
    where j.id=p_job_id and j.organization_id=p_organization_id and j.deleted_at is null
  ) then raise exception 'job_not_found'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'interview_rubric_empty';
  end if;

  -- Versions count every blueprint this job has ever had, including archived ones, so a version
  -- number is never reused and an analysis citing v2 always means the same v2.
  select coalesce(max(version),0)+1 into next_version
  from public.interview_rubrics
  where job_id=p_job_id and rubric_type='job';

  insert into public.interview_rubrics(
    organization_id,job_id,rubric_type,name,version,status,job_brief_hash,source_document_id,ai_evaluation_id,created_by
  ) values (
    p_organization_id,p_job_id,'job',p_name,next_version,'draft',p_job_brief_hash,p_source_document_id,p_ai_evaluation_id,p_created_by
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

  return new_id;
end $$;
revoke all on function public.create_interview_rubric_draft(uuid,uuid,uuid,text,uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.create_interview_rubric_draft(uuid,uuid,uuid,text,uuid,text,uuid,jsonb) to service_role;

commit;
