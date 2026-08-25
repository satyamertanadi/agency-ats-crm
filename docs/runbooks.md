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

## Background data cleanup has stopped

The Admin banner names the layer that broke; work it from there rather than re-running the deploy and hoping. The stage comes from `get_maintenance_health`, and the timestamps under the banner are the evidence for it.

**Scheduler** — nothing has fired: `last attempt` is Never. The pg_cron job is missing. Re-run the production promotion (its "Schedule in-project maintenance cron" step calls `schedule_maintenance_cron`, which is idempotent), then confirm `Schedule` shows a cron expression and check back after the next hour. If it still shows Not registered, pg_cron is not installed on the project.

**Delivery** — the schedule fires but the worker never starts: `last attempt` is recent, `last start` is Never or older. Read `Worker responded` in the banner. A `401` means the credential the cron carries no longer matches the function's environment — almost always a rotated service role key that `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` in GitHub no longer matches. Update that secret and re-run the promotion; the cron command embeds the secret, so it must be re-registered, not just re-deployed. No status at all means the request never completed: check `Transport error` for DNS/TLS, and confirm the function URL.

**Execution** — the run starts each hour and never finishes: `last start` is recent, `last finish` is Never or older. The run is being cut off or is crashing partway. This was the original 2026-08 failure: `net.http_post` defaults to a 5 second timeout and the command did not pass one, so any run carrying a real backlog was severed before it could record anything. Both sides are fixed (a 90s timeout, and the retention loop runs six candidates at a time instead of up to 200 sequential round trips), so a recurrence here means the batch has grown beyond even that — check `last_detail` on `maintenance_heartbeats` for the counts and consider lowering the batch limits in the function.

**Run failed** — it completed and reported failure: `Last error` is populated. Most often candidates whose storage objects could not be removed, which is deliberately *not* recorded as success; a persistent storage failure must not sit behind a green heartbeat.

Never clear the banner by editing `maintenance_heartbeats` directly. It is derived from whether a successful run is actually on record, and the retention, anonymisation and expired-CV guarantees are genuinely unenforced until one is. `run_scheduled_maintenance` and `schedule_maintenance_cron` are trusted-setup only and revoked from every client role — invoke them with the service role key, never from a browser session.

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
