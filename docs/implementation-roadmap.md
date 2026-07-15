# Implementation roadmap

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
