# Security and RLS

- Active organization membership plus role permission is the database authorization boundary; UI checks are not trusted.
- Production access is invitation-only Google OAuth. Verified email must exactly match an active invitation or membership. Password auth exists only behind a local-development flag.
- Consultant access covers recruitment delivery but excludes team administration, integration secrets, bulk imports/exports, and organization-wide finance administration.
- Encrypted Google refresh tokens live in `google_calendar_secrets`, which has no authenticated table grant or RLS policy. Only service-role Edge Functions can read it; the encryption key is an environment secret.
- Anonymous client review goes through `public-review`; direct tables remain unavailable. Tokens are hashed, expiring, revocable, rate limited, and only attached documents receive five-minute signed URLs.
- Storage buckets are private and organization-prefixed. Document access is linked to an authorized record or submission.
- Security-definer functions fix `search_path`, validate organization scope and permission, and use audited transactional operations for access, finance, merge, and workflow changes.
- Structured logs include request IDs but scrub candidate names, emails, salaries, resumes, tokens, and submission content. Session replay remains disabled by default.
- Production redirects and CORS must contain exact HTTPS origins only. CSP, frame denial, no-sniff, HSTS, and no-index headers are configured at the web edge.

Pilot entry requires zero open critical/high security defects and a completed restore drill. Any suspected data exposure triggers the security-incident runbook in `docs/runbooks.md`.
