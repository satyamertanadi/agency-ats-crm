# Migration and cutover guide

## Canonical worksheet order

1. Companies and candidates
2. Candidate employment, education, and languages
3. Contacts and jobs
4. Job candidates (pipeline assignment and stage)
5. Tasks and activities
6. Interviews and offers
7. Placements
8. Revenue splits and invoices

Every row requires a stable `legacy_id`. Dependent worksheets use `candidate_legacy_id`, `company_legacy_id`, `job_legacy_id`, `job_candidate_legacy_id`, or `placement_legacy_id`. Owner assignment and splits use the exact invited `owner_email`/`member_email`. Do not invent missing required data.

## Rehearsal

Use representative, privacy-approved files in staging. Map source columns, stage the batch, download invalid rows, resolve duplicates/orphans, approve the dry run, and commit in dependency order. Compare source, valid, rejected, existing-ID, and committed counts. Exercise rollback before sign-off. If historical documents are supplied, validate the ZIP manifest against structured candidate IDs and record omissions.

Imported future interviews intentionally have `calendar_sync_status=not_requested`; the client owner reviews and activates Calendar only after cutover.

## Final cutover

1. Obtain rehearsal and reconciliation approval.
2. Announce source freeze and capture a final source export/hash.
3. Run a delta dry run and resolve all orphan/duplicate changes.
4. Commit parents before dependants; capture each batch reconciliation.
5. Verify record counts, sampled private fields, pipeline stages, documents, open tasks, future interviews, placements, split totals, and invoices.
6. Have the owner approve Calendar activation for future interviews.
7. Obtain written reconciliation and cutover sign-off before opening user access.

If a batch fails, use its recorded change log to roll it back, correct the canonical file, and rerun with the same legacy IDs. A rerun treats existing legacy mappings idempotently instead of duplicating records.
