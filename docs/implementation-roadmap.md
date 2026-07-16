# Implementation roadmap

## Current six-month focus

The product promise is: turn a CV into a reviewed, role-tailored, client-ready profile in under five minutes. The code path is implemented behind the `profile_v1` organization setting; the operating rollout is tracked in [design-partner-profile-rollout.md](design-partner-profile-rollout.md).

Careers/apply remains conditional. It must not enter implementation until all three partners are live, each has two weekly active recruiters, median reviewed-profile time is at most five minutes, generation succeeds at least 95% of the time, and no severity-1/2 or tenant-isolation defect remains open.

## Code-complete pilot foundation

- Invitation-only team access and pilot role matrix
- Full recruitment records and operational workflow
- Secure client submissions and documents
- One-way Google Calendar synchronization
- Controlled full-data migration and rollback
- Placement finance and date-range reporting
- Generated schema types, clean-reset CI, RLS, monitoring hooks, and runbooks

## External launch sequence

1. Provision separate staging and production resources.
2. Configure Google, Resend, domains, backups, monitoring, and exact redirects/CORS.
3. Run migration rehearsal and client reconciliation in staging.
4. Complete restore, rollback, Calendar outage, and email outage drills.
5. Complete six-user UAT with zero critical/high defects.
6. Freeze source data, perform delta import, approve future interviews, and obtain sign-off.
7. Run the 30-day paid pilot and exit only with written acceptance and no unresolved severity-1/2 incidents.
