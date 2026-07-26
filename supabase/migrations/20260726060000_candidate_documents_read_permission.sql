-- candidate_documents_read gated on is_organization_member -- ANY active member of the
-- organization, regardless of role -- while the documents table that indexes these same objects
-- (and document_links alongside it) is gated on candidates.read. So a member whose role has no
-- candidates.* permission at all (the seeded 'finance' role is the clean example: companies.read,
-- jobs.read, placements.*, finance.*, reports.read, tasks.* -- nothing candidate-shaped) cannot read
-- the documents row that names a file, but can list and download every object under their
-- organization's prefix in candidate-documents directly via Supabase Storage: every CV, every
-- generated candidate profile DOCX.
--
-- candidate_documents_write is also fixed here, not left alone: it is a FOR ALL policy, whose USING
-- clause satisfies SELECT too (the same class of widening as the FOR ALL policies split in
-- 20260726050000_split_write_only_policies.sql), and permissive policies OR together -- so even
-- after tightening candidate_documents_read, a role with candidates.write but not candidates.read
-- would still get SELECT through the write policy alone. Splitting it into
-- INSERT/UPDATE/DELETE on the same candidates.write predicate closes that without changing what
-- candidates.write can already do.
--
-- Verified before writing this: every direct client write to this bucket
-- (uploadCandidateDocument, uploadCandidateProfileDocument, discardCandidateProfileDocument,
-- deleteCandidateDocument, startCandidateCvParse in src/features/core/commercialRepository.ts)
-- already requires candidates.write for an unrelated reason (the app-level flow that reaches
-- storage), so tightening the write policy to the same predicate changes nothing there. The one
-- direct client read (listCandidateDocuments -> createSignedUrl) already requires candidates.read
-- to pass the documents/document_links table RLS gate before it ever reaches storage, so it is
-- unaffected either. Edge Functions (parse-candidate-cv, public-review, refer) all use the
-- service_role admin client, which bypasses storage RLS entirely regardless of this change, as does
-- refer's signed-upload-URL flow (validated by the token itself, not by re-evaluating RLS).
--
-- Existing signed URLs already issued keep working until their own expiry (300s at every call
-- site) -- this only changes who can mint a new one or list the bucket going forward.
begin;

drop policy candidate_documents_read on storage.objects;
create policy candidate_documents_read on storage.objects for select to authenticated
  using(bucket_id='candidate-documents' and public.has_permission((storage.foldername(name))[1]::uuid,'candidates.read'));

drop policy candidate_documents_write on storage.objects;
create policy candidate_documents_insert on storage.objects for insert to authenticated
  with check(bucket_id='candidate-documents' and public.has_permission((storage.foldername(name))[1]::uuid,'candidates.write'));
create policy candidate_documents_update on storage.objects for update to authenticated
  using(bucket_id='candidate-documents' and public.has_permission((storage.foldername(name))[1]::uuid,'candidates.write'))
  with check(bucket_id='candidate-documents' and public.has_permission((storage.foldername(name))[1]::uuid,'candidates.write'));
create policy candidate_documents_delete on storage.objects for delete to authenticated
  using(bucket_id='candidate-documents' and public.has_permission((storage.foldername(name))[1]::uuid,'candidates.write'));

commit;
