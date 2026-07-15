# Architecture

The React/Vite client uses feature repositories and TanStack Query. A generated `Database` type binds the Supabase client to the current schema. PostgreSQL RLS and narrowly granted RPCs are the authorization and transaction boundaries.

Supabase Auth provides Google identity. Edge Functions handle operations that require secrets or an anonymous hardened boundary: invitation and submission email, public review, Calendar authorization/sync/disconnect, document signing, and controlled import execution. Resend and Google credentials never enter the browser.

The first client receives separate staging and production Vercel/Supabase resources. Calendar secrets are encrypted in a server-only table. Private candidate files live in private storage. Sentry receives scrubbed errors; Vercel provides aggregate web performance. Release CI rebuilds the database from zero before accepting migrations.

No infrastructure, credentials, data, storage, deployment, or Git history is shared with other ATS projects.
