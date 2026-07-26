-- Live bug, not a hypothetical: every candidate-documents policy casts the first path segment to uuid
-- (`(storage.foldername(name))[1]::uuid`) on the assumption that every object in the bucket is stored
-- under an organization-id prefix. The refer Edge Function breaks that assumption -- it uploads referral
-- resumes to `referrals/{token16}/{uuid}/{filename}` (supabase/functions/refer/index.ts, the
-- 'upload-url' action) because at signed-URL time it was only scoping the path under the link.
--
-- A uuid cast does not merely fail to match on 'referrals', it RAISES. Since an RLS predicate is
-- evaluated per candidate row, a single referral resume anywhere in the bucket makes *every*
-- authenticated read of candidate-documents fail for *every* user:
--
--   set local role authenticated; select count(*) from storage.objects where bucket_id='candidate-documents';
--   ERROR:  invalid input syntax for type uuid: "referrals"
--
-- Reproduced against the local stack before writing this. It predates
-- 20260726060000_candidate_documents_read_permission.sql, which changed the predicate from
-- is_organization_member to has_permission but inherited the same cast, and predates that again in the
-- initial migration. It has stayed invisible because the app never lists the bucket -- it reads the
-- `documents` table and mints signed URLs for individual known paths -- so nothing has yet run the one
-- query shape that trips it.
--
-- Fixed by resolving the prefix through a helper that returns null instead of raising, so a
-- non-organization prefix is simply "not yours" rather than an error. has_permission(null,...) is
-- false, so such objects become invisible to every authenticated user, which is the correct answer for
-- an object nobody's organization claims. Service-role callers (all four Edge Functions, including
-- refer's own signed-upload flow) bypass storage RLS entirely and are unaffected.
--
-- 20260726120000_referral_resume_under_org_prefix.sql then moves NEW referral uploads under the
-- organization prefix so they are readable and linkable as candidate documents. Objects already
-- uploaded under the old prefix stay unreadable by design -- they are not silently reassigned to an
-- organization, and the accompanying application change surfaces them as "uploaded before this was
-- supported" rather than pretending they are gone.
begin;

/* Returns the organization id a storage object's path is scoped to, or null when the leading segment is
 * not a uuid at all. `nullif(...,'')::uuid` would still raise on 'referrals'; a regex test is what makes
 * this total rather than partial. Kept immutable + strict so the planner can inline it into the policy
 * predicates below. */
create or replace function public.storage_prefix_organization(p_name text)
returns uuid language sql immutable strict set search_path=public as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
  end
$$;
revoke all on function public.storage_prefix_organization(text) from public,anon;
grant execute on function public.storage_prefix_organization(text) to authenticated;

drop policy candidate_documents_read on storage.objects;
create policy candidate_documents_read on storage.objects for select to authenticated
  using(bucket_id='candidate-documents' and public.has_permission(public.storage_prefix_organization(name),'candidates.read'));

drop policy candidate_documents_insert on storage.objects;
create policy candidate_documents_insert on storage.objects for insert to authenticated
  with check(bucket_id='candidate-documents' and public.has_permission(public.storage_prefix_organization(name),'candidates.write'));

drop policy candidate_documents_update on storage.objects;
create policy candidate_documents_update on storage.objects for update to authenticated
  using(bucket_id='candidate-documents' and public.has_permission(public.storage_prefix_organization(name),'candidates.write'))
  with check(bucket_id='candidate-documents' and public.has_permission(public.storage_prefix_organization(name),'candidates.write'));

drop policy candidate_documents_delete on storage.objects;
create policy candidate_documents_delete on storage.objects for delete to authenticated
  using(bucket_id='candidate-documents' and public.has_permission(public.storage_prefix_organization(name),'candidates.write'));

-- The exports bucket carries the same cast and the same latent break; every object there is written by
-- an Edge Function under an organization prefix today, but the policy should not be the thing relying
-- on that.
drop policy exports_read on storage.objects;
create policy exports_read on storage.objects for select to authenticated
  using(bucket_id='exports' and public.has_permission(public.storage_prefix_organization(name),'exports.manage'));

commit;
