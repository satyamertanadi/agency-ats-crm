# Agency ATS CRM

An organization-isolated applicant tracking system and recruitment CRM for agencies and headhunters. This repository is independent from Rascal Talent Hub and uses no RTH production data or credentials.

## Stack

Vite, React 19, strict TypeScript, React Router 7, Tailwind CSS 4, Supabase/PostgreSQL, TanStack Query, React Hook Form, Zod, Vitest, and Playwright.

## Local setup

1. Copy `.env.example` to `.env.local` and supply the local Supabase anon key.
2. Run `npm install`.
3. Start Docker Desktop, then run `supabase start` and `supabase db reset`.
4. Run `npm run dev`.

The seed creates two isolated agencies and recruitment data. Local role accounts include `owner@northstar.local`, `manager@northstar.local`, `consultant@northstar.local`, `sourcer@northstar.local`, `bd@northstar.local`, `finance@northstar.local`, `readonly@northstar.local`, and `owner@rival.local`. Their local-only password is `LocalTest!123`; never use these credentials outside local development.

The new project must receive its own Supabase, Vercel, Sentry, and secret-store resources. Do not paste RTH production credentials into this repository.

## Verification

```text
npm run lint
npm run typecheck
npm test
npm run test:rls
npm run build
npm run test:e2e
```

See `docs/` for architecture, schema, security, product scope, roadmap, testing, and feature status.
