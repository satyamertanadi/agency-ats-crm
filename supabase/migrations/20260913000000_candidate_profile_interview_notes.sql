-- Recruiter interview notes as a profile generation input.
--
-- A candidate profile is generated from the candidate record, the parsed CV, the CV document and the
-- vacancy's requirement set. None of that holds what the consultant learned by talking to the person,
-- so a requirement they confirmed in an interview an hour ago still comes back "missing" and gets
-- corrected by hand afterwards -- which is edit work the assessment was supposed to remove.
--
-- Notes are stored on the VERSION rather than on the candidate. They are the notes that produced this
-- particular profile, so a document already sent to a client stays auditable against what informed
-- it, and regenerating for a different vacancy does not silently reuse notes written for another one.
--
-- Deliberately its own column rather than a field inside generated_content: notes are an INPUT, and
-- generated_content is model output that finalize_candidate_profile's jsonb_set restore chain exists
-- to protect from a tampering caller. Mixing an input into that payload would put it under a
-- protection built for a different purpose.
--
-- public.notes / public.note_links already exist in this schema and are entirely unused by the
-- application -- there is no from('notes') call site anywhere in src/. Reusing them would mean
-- building a notes feature first, so they are left alone.

begin;

alter table public.candidate_profile_versions
  add column if not exists interview_notes text;

/* Matches the cap the edge function and the form enforce. Bounded because this text goes into a
 * prompt on the expensive evaluation model: an unbounded paste costs real money on every generation
 * for this candidate and makes the assessment worse, not better, by burying the interview in it. */
alter table public.candidate_profile_versions
  drop constraint if exists candidate_profile_versions_interview_notes_length;
alter table public.candidate_profile_versions
  add constraint candidate_profile_versions_interview_notes_length
  check (interview_notes is null or length(interview_notes) <= 4000);

comment on column public.candidate_profile_versions.interview_notes is
  'Optional recruiter-authored interview notes supplied when this version was generated. A first-class evidence source: requirement_evidence entries may cite it with source=interview_notes and a verbatim excerpt, which generate-candidate-profile verifies against this text before accepting. Internal only -- never rendered into the client DOCX.';

commit;
