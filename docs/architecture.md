# Architecture

The React application is feature-based. UI components call feature repositories and query hooks; only repositories access Supabase. PostgreSQL RLS is the authorization boundary. Users may belong to multiple organizations, and membership rows—not JWT organization claims—authorize data.

Core writes use RLS-protected PostgREST. Transactional workflow changes use narrowly granted RPCs. Edge Functions are reserved for authenticated invitations, exports, document/AI work, and signed external integrations. Background workers require a secret, use idempotency keys, and dead-letter failed jobs.

No infrastructure, environment variables, data, storage, deployment, or Git history is shared with RTH.

