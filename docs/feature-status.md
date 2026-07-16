# Feature status

Status is conservative: **implemented** means code and local gates exist; **external gate** means client credentials, production infrastructure, or acceptance evidence is still required.

| Area | Status | Notes |
|---|---|---|
| Invitation-only Google login | Implemented / external gate | Google is the production identity provider. Public signup and self-service onboarding are feature-flagged off; production OAuth client and consent verification remain external. |
| Six-user team administration | Implemented | Owner can invite, resend, revoke, change role, suspend, reactivate, and remove access. Named vendor support uses the same audited flow. |
| Tenant and role security | Implemented | Default-deny RLS, generated schema types, private storage, audited sensitive mutations, consultant/owner matrix, and suspension tests. |
| Candidate operations | Implemented / AI credential gate | Detail/edit, private fields, consent/DNC, owner, employment, education, languages, automatic PDF/DOCX CV parsing with reviewed autofill, document upload, archive/restore, pagination, duplicate selection, and transactional merge. Live parsing requires Anthropic staging/production credentials. |
| Companies, contacts, and jobs | Implemented | Create/detail/edit/archive/restore, client contacts, terms, requirements, compensation, team, and configurable job pipelines. |
| Tasks and delivery | Implemented | Consultant assignment, record links, filters, overdue state, interview edit/cancel, offer decisions, and placement conversion. |
| Client submissions | Implemented / external gate | Editable summaries, selected documents, Resend delivery, expiring/revocable links, rate-limited Edge review, feedback, and short-lived signed documents. Sender-domain verification remains external. |
| Google Calendar | Implemented / external gate | Separate incremental consent, encrypted server-only refresh tokens, deterministic create/update/cancel, Meet option, visible failures, reconnect and retry. Live Google reliability testing needs pilot credentials. |
| Placements and finance | Implemented | Guarantees, owner-only consultant splits capped at 100%, draft/issue/pay/void invoice lifecycle, and reporting. |
| Reporting | Implemented | Date-range agency funnel, conversions, placements, fees, overdue work, and consultant performance. |
| Full business migration | Implemented / client mapping gate | CSV/XLSX column mapping, dry run, validation, legacy relationships, idempotent commit, reconciliation, error CSV, and batch rollback across all pilot entities. Client files and rehearsal approval remain external. |
| Monitoring and release automation | Implemented / environment gate | PII-scrubbed Sentry hooks, Vercel Analytics/Speed Insights, security headers, clean-schema CI, dependency scanning, production smoke workflow, and runbooks. Environment provisioning remains external. |
| Evidence-backed client profiles | Implemented / controlled rollout gate | Owner-managed bilingual templates, tracked provider evidence, deterministic internal scoring, immutable reviewed versions, anonymization before rendering, and private DOCX/PDF finalization are implemented. Each organization remains disabled until service staff run the founding-partner configuration and production UAT passes. AI never sends, rejects, or ranks automatically. |
| Gmail, two-way Calendar, job boards, billing | Deferred | Outside the 30-day pilot scope. |

## Verified locally

- Clean dependency install and zero known audit findings at installation time
- ESLint and strict TypeScript against generated Supabase types
- Unit tests and production build
- Clean Supabase reset from migrations and seed
- RLS coverage across two tenants, role permissions, profile/template boundaries, secret denial, invitations, and immediate suspension

## Pilot blockers that code cannot close

- Staging/production resource provisioning and secrets
- Google verification and authorized origins/callbacks
- Resend sender-domain verification
- Backup restore drill
- Client migration rehearsal/reconciliation sign-off
- Six-user UAT and written pilot acceptance
- Thirty successful pilot days before general availability
