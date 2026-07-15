# Agency ATS CRM

An organization-isolated applicant tracking system and recruitment CRM for a six-consultant headhunting agency. The pilot build uses invitation-only Google identity, Supabase/PostgreSQL authorization, one-way ATS-to-Google Calendar synchronization, controlled Excel/CSV migration, Resend delivery, and private document storage.

## Local setup

Requirements: Node.js 22, Docker Desktop, and Supabase CLI.

1. Copy `.env.example` to `.env.local` and set the local publishable/anonymous key printed by `supabase status`.
2. Run `npm ci`.
3. Run `supabase start` and `supabase db reset`.
4. Run `npm run dev`.

This repository uses local Supabase ports `55320`-`55329` so it can run beside another default Supabase project. The local seed contains development-only password users; production must set `VITE_ALLOW_PASSWORD_AUTH=false`, disable public signup in Supabase, and never load `supabase/seed.sql`.

## Verification

```text
npm run lint
npm run typecheck
npm test
npm run test:rls
npm run build
npm run test:e2e
```

`npm run test:rls` requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the active local stack. CI provisions a clean database, verifies migrations and generated types, and supplies these values automatically.

## Production boundary

Code-level pilot capabilities are implemented, but a commercial launch still requires client-specific Google/Resend credentials, separate staging and production projects, backup/restore evidence, migration rehearsal and reconciliation, client UAT, and the release checklist in [docs/pilot-release-checklist.md](docs/pilot-release-checklist.md).

The pilot explicitly excludes Gmail inbox sync, two-way Calendar sync, autonomous AI decisions, job boards, and subscription billing.
