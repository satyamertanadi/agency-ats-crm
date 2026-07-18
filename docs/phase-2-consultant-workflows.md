# Phase 2 — Consultant workflow depth

## Root causes addressed

- Candidate search loaded a page and filtered it in the browser, so results, counts, sorting, and bulk actions could disagree. The list also exposed private contact and salary fields by default.
- Candidate-to-job placement existed only inside a job workspace and used separate client-side checks. There was no candidate-centric view of concurrent pipelines.
- The jobs screen was a directory. Pipeline distribution, ownership gaps, age, inactivity, commercial value, and the next operational action were hidden until a user opened each job.
- Commercial terms existed in the schema but account defaults were not maintainable in the consultant-first experience and were not reflected in job health.
- Task capture was tied to individual pages instead of being a fast, pre-linked workspace action.
- Activity history presented detailed stage names as the primary business language and made exact timestamps pointer-only.

## Implementation

`20260718130000_phase2_consultant_workflows.sql` adds four narrow database APIs:

- `search_candidates_page` performs permission-aware filtering, sorting, totals, and readiness metadata server-side.
- `list_job_health` aggregates job age, owner, candidates by phase, waiting candidates, activity, salary, effective fee source, expected fee, and candidate membership.
- `add_candidates_to_job` atomically validates an open job, active starting stage, candidate status, organization boundary, and duplicate membership before inserting one or many candidates.
- `set_company_default_fee` versions the active account agreement and enforces commercial-term permission.

The UI consumes these APIs for the candidate list and bulk placement, candidate pipeline history, job health filters, inline owner assignment, commercial terms, global linked task capture, and phase-aware activity wording.

## Integrity and privacy behavior

- Do-not-contact and archived candidates are blocked in both UI and database placement paths.
- Consent that is not granted is visible as a warning; internal pipeline work remains possible, while the existing submission gate continues to enforce consent before external disclosure.
- Candidate PII and salary are absent from the default database list response and table columns.
- Job fee precedence is job override first, then the current active account agreement. The source is shown with the computed expected fee.
- Candidate/job uniqueness remains protected by the existing database constraint and is also checked by the atomic placement function for a useful error.

## Migration and rollback risks

- The migration is additive: three indexes and four functions. Existing tables and rows are not rewritten.
- Account fee updates intentionally expire the previous active term. Rollback should be a forward migration that restores the desired term status; dropping the function does not undo term history.
- Job-health phase counts depend on `pipeline_stages.phase_key`. Unmapped custom stages are reported as `other` until an administrator maps them.
- The candidate consent filter follows private-detail RLS. A role without private-detail read access receives no private consent value rather than bypassing that boundary.
- If rollback is required, revoke/drop the four function signatures and remove the new indexes in a forward migration after reverting application callers. Do not edit an applied migration.
