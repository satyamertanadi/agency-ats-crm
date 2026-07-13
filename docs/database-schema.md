# Database schema

Every tenant-owned row has `organization_id`. Mutable records include actor and timestamp columns; core records use `deleted_at` where retention requires recoverable deletion. Stage, feedback, audit, and financial histories are append-oriented.

The initial migration defines organization security, candidate data, client CRM, jobs and pipelines, submissions, activities, tasks, interviews, offers, placements, imports/exports, saved views, integrations, background jobs, AI evaluations, indexes, constraints, RLS, and transactional RPCs.

JSONB is limited to configuration, import staging, provider payloads, and AI evidence documents. Recruitment and commercial relationships use normalized foreign keys.

