# Operations runbooks

## User onboarding and offboarding

Onboarding: owner enters the exact verified Google email, selects Owner or Consultant, sends the invitation, and confirms delivery. The user signs in with that same Google account. Record role changes and never share accounts.

Offboarding: suspend first to remove database access immediately, transfer owned jobs/candidates/tasks, revoke pending invitations and Calendar connection, then remove access. Retain the audit record. Vendor support access follows the same named-account process.

## Revoked Google token or Calendar failure

The interview remains authoritative in the ATS. Confirm `calendar_sync_status` and request ID without copying attendees or candidate data into a ticket. Ask the organizer to reconnect in Settings, then retry. If Google is unavailable, continue scheduling in the ATS and communicate invitations manually; do not repeatedly create replacement interviews. After recovery, retry the original record and confirm its deterministic event ID prevents duplicates.

## Rotating the Calendar token encryption key

Stored Google refresh tokens are encrypted with `CALENDAR_TOKEN_ENCRYPTION_KEY`, versioned so a rotation cannot destroy every stored token (the wire format used to carry no key identifier at all). A deployment that has never rotated needs no configuration beyond the one key; the steps below only apply when actually rotating it.

1. Choose a new key and a new version label (any string, distinct from every label ever used before; must not contain a literal `.`). If this is the organization's first rotation, the existing label is implicitly `1`.
2. Set `CALENDAR_TOKEN_ENCRYPTION_KEY_PREVIOUS` to the current (soon-to-be-old) key value, and `CALENDAR_TOKEN_ENCRYPTION_KEY_PREVIOUS_VERSION` to its current label (`1` if this is the first rotation).
3. Set `CALENDAR_TOKEN_ENCRYPTION_KEY` to the new key value, and `CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION` to the new label. Deploy all four together in one Function secrets update -- new writes take the new key immediately, and every existing row keeps decrypting via the previous key in the same deploy.
4. Confirm in staging first: connect a test Google Calendar account before rotating, rotate, then reconnect/sync and verify the pre-rotation connection still syncs (proves the previous-key path) and a fresh connection round-trips under the new key.
5. Existing connections re-encrypt under the new key automatically the next time their token is refreshed (every `calendar-sync` refresh calls `encryptSecret` again); nothing needs to be backfilled by hand.
6. Once confident every stored token predates the rotation by less than a refresh cycle (or after force-disconnecting and asking affected users to reconnect), remove `CALENDAR_TOKEN_ENCRYPTION_KEY_PREVIOUS` and `CALENDAR_TOKEN_ENCRYPTION_KEY_PREVIOUS_VERSION`. Until then, leave them set -- removing them early makes any row still under the old key permanently undecryptable again.

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
