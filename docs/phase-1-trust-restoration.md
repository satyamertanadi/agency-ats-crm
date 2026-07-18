# Phase 1 — trust restoration

## Root causes confirmed

- **Cold protected routes:** `OrganizationProvider` selects a workspace in an effect. `Protected`
  previously allowed the route tree to render after memberships loaded but before that selection.
  Capability-gated routes then evaluated `organization!.slug` while `organization` was null. Ordinary
  list routes survived the transient state; admin routes could throw before making a data request.
- **Blank render failures:** the application had no React error boundary, so this route race and any
  lazy-component render error removed the entire root without a recovery surface.
- **Anonymous colleagues:** `profiles_self` allowed a user to select only their own profile. The
  foreign keys added in `20260715091311_profiles_relationships.sql` made teammate embeds resolvable,
  but profile RLS still filtered the embedded row. The UI therefore received null and rendered
  “A teammate” or “Team member.”
- **Stale placement recommendations:** Today loaded offers but not placements, so the eligibility
  builder had no fact with which to dismiss an accepted-offer recommendation after placement.
- **Impossible funnel:** reports compared package count with interview-event count and stage-history
  event count. Repeated interview moves and packages containing multiple candidates mixed units and
  allowed conversion above 100%.
- **Overdue disagreement:** the report fetched tasks created inside the selected report period while
  Today classified every currently open task. Old overdue tasks appeared on one surface only.

## Implementation and risks

- Route rendering now waits for an explicit selected workspace, capability redirects are null-safe,
  auth/workspace load failures render an error state, and root plus route-aware boundaries provide a
  reference ID, retry, and Return to Today recovery.
- A new additive activity snapshot preserves the author's display name at event creation. Shared-org
  profile reads require an active viewer membership but permit suspended subjects, preserving former
  colleague attribution. This expands profile visibility to people in the same workspace; that is
  already the intended team-directory boundary and remains protected by organization membership.
- Today suppresses accepted offers when a non-cancelled placement exists for the same job-candidate.
- Reports now use a unique submitted candidate/job cohort, shared overdue classification, current
  active-job workload, explicit placement terminology, and workspace-timezone date boundaries.
- The database change is additive. Rollback should be a corrective forward migration: restore the
  prior `log_activity` body, drop `profiles_shared_organization_read`, then drop
  `actor_name_snapshot` only after the UI no longer selects it. Existing activity, stage, offer, and
  placement records are not rewritten (the snapshot backfill only copies current author labels).

## Verification contract

- Unit tests cover stale placement dismissal, duplicate offer recommendations, withdrawn-offer copy,
  funnel cohort math, overdue classification, placement terminology, timezone bounds, and boundary
  recovery.
- Build, lint, full Vitest, RLS, and desktop/mobile Playwright smoke checks remain release gates.
- The production migration must be followed by reconciliation queries for unnamed activities,
  candidate-level funnel totals, current overdue tasks, and placement counts before promotion.
