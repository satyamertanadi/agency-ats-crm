# Database schema

Every tenant-owned record carries `organization_id`. Core records use recoverable `deleted_at` where retention requires it; stage, feedback, audit, merge, import, and finance histories are append-oriented.

The schema covers organizations/members/roles, candidates and private profiles, uploader-private CV parsing drafts, client CRM, jobs/pipelines, submissions/public links, activities/notes/tasks, interviews/offers/placements, splits/invoices, documents/storage links, imports and legacy mappings, Calendar connection metadata plus isolated encrypted secrets, email delivery records, audit logs, and background/AI records. Employment and education dates retain their source precision (`day`, `month`, or `year`) instead of presenting inferred first-of-period dates as exact.

JSONB is limited to configuration, import staging/reconciliation, audit metadata, provider payloads, and explainable evidence. Operational and commercial relationships use normalized foreign keys. The authoritative TypeScript projection is generated at `src/generated/database.types.ts`; CI rejects drift after a clean reset.
