# P0B operational readiness register

Snapshot: 2026-08-09

This register separates controls proven by code and release automation from controls that require
infrastructure or client evidence. An unchecked external gate is a release blocker, not an implied
success. Record the accountable person rather than adding another dashboard.

## Verified baseline

| Control | Status | Evidence |
| --- | --- | --- |
| Production P0 baseline | Verified before P0B | `main` commit `0d04f4a`; atomic recruitment writes, durable delivery, one follow-up source, retention/audit controls, and one active placement per job are present in migrations `20260808010000` through `20260808050000`. |
| Previous full release gate | Verified before P0B | GitHub Actions run [31285076058](https://github.com/satyamertanadi/agency-ats-crm/actions/runs/31285076058) passed for the production baseline. |
| P0B local application checks | Verified locally | Extension lint/typecheck/build and 4 session-security tests pass; repository lint, application typecheck, production build, 49 test files / 357 tests, 5 job workspace capability tests, and the Calendar sync Deno check pass. The PR's clean-schema, RLS, E2E, provider, and authenticated-browser gates remain authoritative. |
| Migration delivery route | Verified | `.github/workflows/deploy.yml` owns staging migration, Edge Function deployment, compatible production migration, browser verification, and exact-artifact promotion. Do not push production migrations by hand. |

## External release blockers

| Gate | Status | Accountable owner | Evidence required to close |
| --- | --- | --- | --- |
| Automated backups or PITR | **Not verified** | Vendor support administrator | Supabase project name/ref, plan/tier, enabled backup mode, retention window, most recent recovery point, and dated dashboard/API evidence for both staging and production. The locally linked ref is `wemsimkwwcfsyalnbepn`, but the Management API login is unavailable and its backup status must not be inferred. |
| Isolated restore drill | **Not run** | Vendor support administrator + client owner approver | Restore a selected recovery point into a temporary isolated project, never over the only staging or production copy. Record requested recovery point, start/end timestamps, achieved RPO/RTO, migration version, organization/member counts, representative document checks, pipeline/audit/financial reconciliation, RLS/workflow smoke results, approver, and cleanup evidence. Follow `docs/runbooks.md`. |
| DPA, privacy, retention and export terms | **Not signed in repository evidence** | Client owner + vendor commercial owner | Signed DPA/order form or approved contract link covering controller/processor roles, subprocessors, region, retention, legal holds, export/deletion, breach notification, support access, and exit handling. Do not place the signed agreement or personal signatures in Git. |
| Named operational owners | **Not recorded** | Client owner | Names for incident lead, restore approver, Google/Resend administrator, production deployment approver, and vendor support administrator. Store the restricted contact details outside Git and link the controlled record. |

## Restore drill acceptance record

Complete this section in the controlled operations record, then link redacted evidence here:

- Source project and recovery point:
- Temporary isolated target project:
- Drill start and end time:
- Achieved RPO and RTO:
- Expected versus restored organizations, members, candidates, jobs, activities, audit rows, placements, and invoices:
- Representative private document access check:
- Cross-tenant RLS test result:
- Candidate-to-placement smoke result:
- Missing or inconsistent data:
- Approver and date:
- Temporary restore cleanup confirmation:

## Release decision

P0B code may proceed through CI and staging. Agency production readiness remains **blocked** until the
PITR, isolated restore, DPA, and named-owner rows above have dated evidence and the corresponding
items in `docs/pilot-release-checklist.md` are checked.
