# Phase 4 — Agency CRM and commercial operating system

## Root causes addressed

- `business_development_stage` existed on every company since the initial migration but was rendered only on the account detail page. The Clients list showed name, location, contact count, account status, and updated date — none of which answer "which prospect is going cold". There was no cross-account view of business development anywhere in the product.
- The Clients list loaded companies and contacts separately and counted in the browser, which is why it could not show open jobs, follow-ups, commercial state, or ownership at all. Those facts live across four tables.
- Consultant performance was computed inline inside `ReportsPage` and reachable only through `/admin/reports` behind `canViewTeamReports`. An individual consultant could not see their own numbers without manager permissions.
- `saved_views` has existed as a table since the initial migration and was never read or written by any code path.
- Placements snapshot their own economics (`fee_percentage`, `fixed_fee`, `guarantee_days`, `currency`) but recorded no link to *which* agreement produced them, so a later fee change left historical placements unexplainable.

## Implementation

`20260719000000_phase4_business_development.sql` adds:

- `list_company_pipeline` — one aggregated row per company: BD stage, owner, contacts, open jobs, active candidates, next follow-up, last activity, placements, commercial-term state, and expected fee across open roles. The board and the list read the same row, so they cannot disagree.
- `set_company_bd_stage` — validates the stage vocabulary and permission, then journals the move to the activity feed. The column is the current position; the activity is the history.
- `is_default` on `saved_views`, plus replaced RLS policies (see below).
- `placements.commercial_term_id` and `placements.fee_source` — provenance, not a second copy of the money.

`bdPipeline.ts` holds the board's derivations (stage grouping, account risk, summary) as pure functions with 11 tests. `buildConsultantRows` moved out of `ReportsPage` into `reportMetrics.ts` so the team report and the new personal scorecard render from one builder. `SavedViewBar` and `csv.ts` are shared across list surfaces.

## Security change worth flagging

The original `saved_views` policies came from the bulk RLS loop as `('saved_views','reports.read','reports.read')`. That granted every holder of `reports.read` both read **and write** access to every other member's saved views — including renaming and deleting them — and `is_shared` had no enforcement behind it at all.

The new policies scope reads to shared-or-own and writes to owner-only in every direction. This strictly narrows access: nothing previously denied becomes allowed. `tests/rls/saved-views-and-bd.test.ts` covers this: a private view stays invisible to a colleague, and a shared one is readable but not editable or deletable by anyone but its author.

## Integrity and privacy behavior

- Accounts whose stage is outside the default flow get their own trailing column rather than being dropped or relabelled. A workspace that imported its own vocabulary keeps every client visible.
- Risk flags apply only to accounts still being worked. Lost and dormant accounts are exempt, because flagging a closed account for having no next action trains people to ignore the flags that matter.
- Commercial gaps are raised only once an account is winnable (won, or already carrying open roles). Chasing a brand-new lead for a signed fee agreement is not a real finding.
- Pipeline value counts accounts in play only, so the headline cannot drift upward forever.
- "No next action" and "follow-up overdue" are mutually exclusive, so one account cannot be double-counted against the at-risk total.
- Exports refetch the whole filtered set rather than writing the page on screen, and report the cap explicitly when a view exceeds it.
- The scorecard is filtered from the team builder rather than recomputed, so a consultant's totals reconcile with their manager's by construction. This is asserted directly by a test.

## Migration and rollback risks

- `business_development_stage` has no database check constraint and is not given one here. Existing rows holding other values are untouched; the vocabulary is enforced at write time by the RPC only. Adding a constraint later requires auditing existing values first.
- `saved_views` is reused, not recreated. `create table if not exists` would have silently no-opped against the existing shape (`owner_member_id`/`filters`/`columns`), so the migration adapts to the real table.
- Rolling back the RLS change means restoring the two original policies; the new ones are named separately (`saved_views_insert/update/delete`) and `saved_views_write` is dropped, so a rollback must recreate it.
- `commercial_term_id` and `fee_source` are nullable and deliberately **not** backfilled. Inferring which agreement priced a historical placement would be a guess presented as a record.
- Generated types were hand-edited to match what the Supabase CLI produces. If CI regenerates and diffs, verify the two new function entries, `is_default`, and the two placement columns before assuming a mismatch is a schema drift.

## Verification

- `tests/rls/saved-views-and-bd.test.ts` (11) — the tightened saved-view boundary (private stays private, shared is readable but not editable or deletable by colleagues, no forging another member's ownership, no cross-tenant leak) and the BD RPCs (activity journalling, stage vocabulary, tenant isolation of both the mutation and the aggregate). **These require a local Supabase and have not been executed here.**
- `bdPipeline.test.ts` (11) — stage grouping including unknown stages, each risk rule and its exemptions, and summary scoping.
- `reportMetrics.test.ts` (+8) — unique-per-milestone counting, cancelled/draft exclusion, deactivated members retaining their work, unknown former actors, unassigned overdue work, no invented exchange rate, and the scorecard/team reconciliation.
- `csv.test.ts` (5) — quoting of commas, quotes and newlines, empty views, column order, dated filenames.
- `typecheck` and `lint` (eslint + stylelint) clean.

## Completing migration

`20260719010000_phase4_commercial_provenance.sql` is a forward migration rather than an edit to the
one above, because that one may already be applied and correcting an applied migration in place is
how two environments come to disagree about what the schema is. It adds:

- `payment_terms_days`, `tax_treatment`, `replacement_terms`, `agreement_document_url`,
  `approval_status`, and `notes` on `commercial_terms`. All nullable, no backfill: an agreement
  signed before these fields existed genuinely has no recorded payment terms, and defaulting them
  would manufacture commercial facts nobody agreed to.
- The write path for `placements.commercial_term_id` and `placements.fee_source`, which the previous
  migration added but nothing populated.

`fee_source` is **stated by the caller**, not inferred. The fee is passed into
`create_placement_from_offer`, so the function cannot know which source produced it without being
told, and comparing the number against what each source would have computed would record a guess as
provenance — unresolvable when two sources agree on a value. `commercial_term_id` is different:
which agreement was in force is a fact the database can establish, so it is recorded regardless of
which source set the fee. The placement form surfaces the expected fee with a "Use this fee" action
that states the source, warns when a job has no agreed terms, and shows what will be recorded.

Both `create_placement_from_offer` and `set_company_default_fee` drop their previous signatures. With
the new parameters defaulted, keeping the old arities would make every existing call ambiguous and
fail rather than resolve.

## What remains in Phase 4

- **Configurable BD stages** — the vocabulary is a product constant enforced by `set_company_bd_stage`.
  Making it per-workspace means a stage table and a migration path for existing values.
- **Commercial fields in the UI** — the columns, RPC parameters, and repository arguments all exist,
  but `CompanyCommercialTerms` still only edits fee type, percentage, currency, and guarantee days.
  The remaining fields are writable through the API and not yet through a form.
