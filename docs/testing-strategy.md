# Testing strategy

Every release candidate must pass:

1. `npm ci`, high-severity dependency audit, ESLint, strict TypeScript, unit tests, and production build.
2. A clean `supabase db reset`, database lint, generated-type drift check, and non-skipping RLS suite.
3. Chromium desktop and responsive browser smoke checks with no console errors.
4. Staging production-smoke workflow over HTTPS and security headers.
5. Manual UAT for the complete recruitment workflow, Google Calendar recovery, Resend outage behavior, import rehearsal/rollback, and backup restoration.

RLS tests use two organizations and known foreign UUIDs. The pilot role suite asserts consultant operational access, denial of finance/import/admin permissions, denial of encrypted Calendar secrets, invitation privacy, and immediate loss of data access after suspension.

Before pilot entry, test with six concurrent sessions and at least twice the expected imported row count. Confirm pagination, primary-page response time, upload limits, duplicate merge conflicts, link expiry/revocation/rate limiting, and Calendar idempotency. Record results in the release checklist; do not replace evidence with a verbal approval.
