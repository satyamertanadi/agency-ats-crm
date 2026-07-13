# Feature status

Status is deliberately conservative. “Completed” means implementation and the available verification gates passed; Docker-dependent checks remain partial until local Supabase can run.

| Feature | Status | Evidence / remaining work |
|---|---|---|
| Repository isolation and strict TypeScript | Completed | Clean project, no RTH credentials or production data; typecheck and production build pass. |
| Architecture, product, schema, security, roadmap, and testing docs | Completed | Maintained in `docs/`. |
| Multi-organization schema and default-deny RLS | Partially completed | Schema, policies, secure RPCs, storage rules, seeds, and non-skipping RLS tests exist; runtime migration/RLS execution is blocked locally because Docker Desktop is unavailable. |
| Signup, login, password reset, organization onboarding and switching | Partially completed | Database-backed UI and organization RPC implemented; browser smoke is verified without a live local auth service. |
| Secure team invitations and role assignment | Partially completed | Hashed expiring token RPCs and acceptance UI implemented; production email delivery is deliberately deferred. |
| Candidate database | Partially completed | Create, list, private fields, search, duplicate email protection, CSV import/export, and proactive records work; full edit/detail, merge UI, documents, and consent workflows remain. |
| Client companies and contacts | Partially completed | Connected database-backed create/list flows work; richer timelines, terms editor, and agreements UI remain. |
| Jobs and configurable pipelines | Partially completed | Job-specific cloned pipelines, dnd-kit movement, accessible stage selector, and immutable history implemented; pipeline-template editor remains. |
| Candidate submissions and public review | Partially completed | Multi-candidate packages, hashed expiring links, allowlisted public payload, comparison layout, and feedback implemented; document attachment and rate-limit hardening remain. |
| Activities and tasks | Partially completed | Unified tables, dashboard activity, task create/complete, due date and priorities implemented; entity-link UI and reminders remain. |
| Interviews and offers | Partially completed | Scheduling, offer creation/status, and transactional accepted-offer-to-placement conversion are operational; attendee editing and calendar synchronization remain. |
| Placements, guarantees, revenue splits, and invoice tracking | Partially completed | Placement create/list, fee and guarantee fields exist; split and invoice editing screens remain. |
| Structured workspace search | Partially completed | Cross-entity RPC and UI implemented; saved views, recent searches, full structured filter builder, and trigram acceptance tuning remain. |
| CSV portability | Partially completed | Candidate import/export includes validation and duplicate failures; company/contact/job mapping UIs and failed-row file export remain. |
| Action-oriented dashboard and reports | Partially completed | Live operational counts, overdue work, activity, placements, and base-currency reporting implemented; conversion and recruiter cohort reports remain. |
| Explainable AI and CV parsing | Partially completed | Provider contract, deterministic evidence score, tests, persistence model, and authenticated queue function exist; Anthropic execution and document parser worker remain. |
| Templates | Planned | Schema and navigation exist; editor and generation are not presented as complete. |
| M365 synchronization and semantic search | Deliberately deferred | Phase 2. |
| Subscription billing, SSO, and job boards | Deliberately deferred | Phase 3. |

## Current verification

- Strict TypeScript: passed
- ESLint: passed
- Unit tests: passed
- Production build: passed
- Browser smoke at desktop and mobile: passed in Playwright and the in-app visual check
- Supabase migration reset and RLS suite: blocked locally by unavailable Docker Desktop; CI is configured to run both without skipping
