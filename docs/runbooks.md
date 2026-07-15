# Operations runbooks

## User onboarding and offboarding

Onboarding: owner enters the exact verified Google email, selects Owner or Consultant, sends the invitation, and confirms delivery. The user signs in with that same Google account. Record role changes and never share accounts.

Offboarding: suspend first to remove database access immediately, transfer owned jobs/candidates/tasks, revoke pending invitations and Calendar connection, then remove access. Retain the audit record. Vendor support access follows the same named-account process.

## Revoked Google token or Calendar failure

The interview remains authoritative in the ATS. Confirm `calendar_sync_status` and request ID without copying attendees or candidate data into a ticket. Ask the organizer to reconnect in Settings, then retry. If Google is unavailable, continue scheduling in the ATS and communicate invitations manually; do not repeatedly create replacement interviews. After recovery, retry the original record and confirm its deterministic event ID prevents duplicates.

## Email provider outage

Do not expose a raw invitation or review token in chat. Confirm the ATS delivery record and provider status, pause bulk retries, and use resend after recovery. If an urgent client package must be delivered outside the system, owner approval and a secure approved channel are required; record the exception and revoke the unused ATS link.

## Data correction

Prefer normal edit/history operations. Use candidate merge only after reviewing same-job conflicts, private details, consent, and do-not-contact state. For bulk corrections, stage a new import batch, review its dry run, and preserve legacy IDs. Never patch production with an unreviewed spreadsheet.

## Security incident

1. Stop the suspected access path: suspend account, revoke link/token, disconnect integration, or roll back deployment.
2. Preserve audit logs, request IDs, deployment ID, and timestamps without expanding PII exposure.
3. Notify the client security contact and incident owner under the agreed response target.
4. Determine affected tenants, records, fields, accounts, documents, and time window.
5. Rotate relevant credentials, remediate, validate RLS/storage/Edge boundaries, and document notification obligations.
6. Obtain approval before restoring service and complete a blameless follow-up.

## Backup restoration

Restore into an isolated staging project, never over the only production copy. Verify schema migration version, organization/member counts, representative candidate documents, pipeline relationships, audit history, and financial totals. Run RLS and workflow smoke tests. Record recovery point, recovery duration, missing interval, approver, and cleanup of the temporary restore.

## Deployment rollback

Stop promotion, identify the last known-good Vercel deployment and compatible migration state, and assess whether the database change is backward compatible. Prefer application rollback plus a forward corrective migration; never edit an applied migration or run destructive down SQL without reviewed backup evidence. Run production smoke and one authenticated workflow after rollback.

## Client termination and export

Confirm authority and effective date, suspend users, disconnect Calendar, revoke public links, stop email delivery, and create the agreed structured export plus document manifest. Reconcile counts and obtain receipt. Apply the retention/deletion schedule, preserve legally required audit evidence, remove vendor access, rotate client-specific secrets, and document final deletion or retained legal hold.
