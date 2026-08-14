# Agency ATS — Production-readiness audit

**Date:** 2026-08-14  ·  **Auditor:** hands-on + code + live-database review
**Environments exercised:** `agency-ats-crm-staging` (writes, in an isolated `AUDIT SANDBOX` org) and `agency-ats-crm-production` (read-only catalogue/config checks only). No production data was read into this report.

## Remediation status (updated after the audit)

- **F1 + F2** — grant-hardening migration `supabase/migrations/20260814120000_reharden_anon_function_grants.sql` written and **applied to staging** (verified: 0 anon-executable functions; unauthenticated `schedule_maintenance_cron` now returns `401`). **Production application is pending** — the automated production-DDL step was blocked by a safety guard; apply the same migration to `fnlgujbvzlekpddpxjvl` to close the live exposure.
- **F3** — fixed in `src/app/OrganizationProvider.tsx` (`selectOwnMembership` selects the caller's own row); regression test added in `src/app/OrganizationProvider.test.ts`.
- **F4** — dead `.referral-filter` CSS removed. Deleting the deployed `refer`/`ai-evaluate` functions is an operational step still to run.
- **Staging maintenance cron** — still needs re-establishing (my probe removed it; the automated re-schedule was also guard-blocked).

## How this audit was run

This was deliberately **empirical, not documentary**. The repo *reads* as production-ready (66 migrations, 357 passing unit tests, an RLS suite, Playwright gates, security headers, runbooks, a `feature-status.md` that marks almost everything "Implemented"). The question asked was whether that survives contact with real use.

What was actually done:

- **Drove the real UI** as an owner and as a read-only user against staging, through: login/session, candidate create + duplicate handling, client + contact + job creation, adding a candidate to a job, pipeline stage moves, permission gating, and a 375px mobile pass. Every write was cross-checked against the database.
- **Probed security at the database layer** by simulating each role's JWT (`authenticated` role with `request.jwt.claims`) and by calling the REST/RPC surface unauthenticated with the public key.
- **Read the migrations, edge functions, and data/cache layer** for defects, and diffed the repo against what is actually deployed.
- **Ran every local gate**: `typecheck`, `lint`, `test` (357 tests), `build` — all green.

Verification standard: every finding below carries a reproduction (a SQL result, an HTTP status, a DB cross-check, or code lines). Anything that could not be reproduced twice is labelled *suspected*. Anything that could not be tested is listed as **not tested**, not assumed working.

---

## Verdict

**Not production-ready as it stands — because of one live, unauthenticated Critical on the production database.** Strip that away and the picture is genuinely encouraging: the authorization model, tenant isolation, and money/placement integrity are **well-engineered and defensively built** — this is not a system that only looks right on the surface. But it is **not battle-tested**, and two problems will bite a real six-consultant desk immediately.

The honest one-line answer to *"can I put real recruiters, candidates and revenue through this without worrying something breaks?"* — **not yet, but you are close.** The fixes below are small and well-scoped; none require a redesign. After the P0s and the one P1 correctness bug, this becomes **production-ready but not yet battle-tested** (it still needs the 30-day pilot the team already planned).

Classification: **Almost production-ready.**

---

## Severity summary

| # | Finding | Severity | Blocks production? |
|---|---|---|---|
| F1 | `schedule_maintenance_cron` callable by **anonymous** users on staging **and production** — arbitrary persistent cron + SSRF + DoS of the real maintenance job | **Critical** | **Yes** |
| F2 | Systemic grant-hygiene gap: 9 functions anon/PUBLIC-executable on production; the guard test can't see it | **High** | **Yes** (same fix as F1) |
| F3 | `OrganizationProvider.membership` returns the wrong member for every non-first user → "My work" / "My active jobs" mis-scoped; new-job owner defaults wrong | **High** | No, but breaks multi-consultant use |
| F4 | Orphaned deployed edge functions (`refer`, `ai-evaluate`) live on prod but absent from the repo | **Medium** | No |
| F5 | Advisor items: `pg_net` in `public`, `normalize_email` mutable search_path, leaked-password protection off | **Low–Med** | No |
| F6 | Unbounded list queries (companies/contacts/jobs) + 11 queries per Today load; 766 kB main bundle | **Low (P2)** | No |

Confirmed-strong areas (evidence in the ledger): tenant isolation, role escalation, one-job-one-hire, revenue-split cap, atomic candidate create, transactional merge, duplicate-detection UX, public-review boundary, realtime sync, read-only UI gating.

---

## Findings

### F1 — Unauthenticated caller can schedule arbitrary cron / SSRF / disable maintenance — CRITICAL, blocks production

- **Feature/workflow:** Scheduled maintenance (`schedule_maintenance_cron(p_function_url text, p_worker_secret text)`).
- **What I did:** With only the **public publishable key** (the one shipped in every browser bundle), called the RPC unauthenticated over `POST /rest/v1/rpc/schedule_maintenance_cron` on staging, pointing it at a loopback URL.
- **Expected:** `401`/`403` — this is an operational primitive that should never be reachable by the `anon` role.
- **Actual:** `200 "scheduled"`. It created a live `pg_cron` job (`cron.job` row confirmed) that runs hourly and issues a `net.http_post` to the caller-supplied URL with caller-supplied headers, **overwriting the legitimate `scheduled-maintenance` job**.
- **Issue:** An anonymous internet user can (a) make the database issue HTTP requests to any URL (`pg_net` SSRF — internal endpoints, cloud metadata, etc.), (b) plant a persistent hourly job, and (c) delete/replace the real maintenance job that drives retention, durable email delivery, and heartbeats. **Confirmed anon-executable on production as well** (`has_function_privilege('anon', …, 'EXECUTE') = true`).
- **Blocks production:** **Yes.** This is a live unauthenticated capability on the production database.
- **Smallest fix:** `revoke all on function public.schedule_maintenance_cron(text,text) from anon, public;` (keep the intended grant — ideally to `service_role`/no client role at all, since it is only ever invoked from trusted setup). Ship as a migration. Then close the root cause in F2.
- **Verify:** Re-run the unauthenticated `curl` → expect `401`/`403`; `select has_function_privilege('anon','public.schedule_maintenance_cron(text,text)','EXECUTE')` → `false` on staging and production.

> **Cleanup note:** my probe overwrote and then removed staging's `scheduled-maintenance` cron job. **Staging currently has no maintenance cron scheduled** — re-establish it via the admin flow (or `select schedule_maintenance_cron('<functions-url>/scheduled-maintenance','<worker-secret>')` run as a trusted role) after applying the fix. Production was not touched.

### F2 — Grant hygiene is systemically fragile, and the guard test is blind to it — HIGH, blocks production

- **What I did:** Enumerated `has_function_privilege('anon', …)` across `public.*` on staging and production.
- **Expected:** Per `tests/rls/rpc-acl.expected.json` and the docs, **nothing** in `public.*` is EXECUTE-able by `anon` or `PUBLIC`.
- **Actual (production):** 9 functions are anon/PUBLIC-executable: `schedule_maintenance_cron` (F1), `get_maintenance_health`, `get_my_workspace_capabilities`, `handle_new_user`, `contact_follow_up_to_task`, and the trigger helpers `assign_pipeline_phase`, `bump_candidate_profile_template_version`, `bump_interview_calendar_version`, `touch_updated_at`. (All except F1 are low-impact on their own — the workspace/health RPCs return empty for non-members; the trigger helpers can't be usefully called out of trigger context — but they are all *unintended* exposure.)
- **Root cause (confirmed in the codebase's own comments):** the Supabase platform baseline runs `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE … TO anon` on every new function (see the note in `20260726090000_close_unrevoked_helper_grants.sql`), so **every** function is anon-executable unless a migration explicitly `revoke … from anon`. The house pattern often writes `revoke all … from public` — but `public` is not the `anon` role, so anon keeps its grant. This exact mistake has now recurred at least four times: `resolve_submission_link`, `submit_submission_feedback`, the calendar secrets, and now `schedule_maintenance_cron`.
- **Why the guard didn't catch it:** `rpc-acl.test.ts` runs against a fresh local `supabase db reset`, and — per `20260717060000`'s own comment — the platform's default-privilege baseline **"does not reliably replicate"** locally. So the test passes locally while staging/production diverge. The one automated guard is blind exactly where the risk lives.
- **Smallest fix:** (1) A migration that sets a safe default and re-asserts the allowlist: `alter default privileges in schema public revoke execute on functions from anon, public;` then `revoke execute on all functions in schema public from anon, public;` and re-grant only the `authenticated` allowlist. (2) Point the `rpc-acl` guard at a database that has the platform baseline (a staging check in CI), or bake the `ALTER DEFAULT PRIVILEGES` revoke into migrations so local reproduces prod.
- **Verify:** re-run the anon enumeration on staging + production → only intended functions remain; `rpc-acl` now fails if a future function is left anon-executable.

### F3 — "My work" and "My active jobs" show the wrong person for every non-first consultant — HIGH

- **Feature/workflow:** Today dashboard scope ("My work" vs "Team view"), "My active jobs", new-job owner default.
- **What I did:** Read `src/app/OrganizationProvider.tsx` and confirmed with a REST call using a non-owner member's real token.
- **Root cause:** the provider resolves the caller's membership as `query.data?.[0]` from a query that selects **all** active members (RLS lets members see each other) with **no `user_id` filter and no ordering**. For a non-owner caller, `[0]` is the org's first-created member — the **owner**. The file's own comment says membership should be "the caller's own row … `memberships.find(m => m.user_id === user.id)`" — that correct `.find()` was regressed to `[0]`, and the correct pattern still exists in `CandidatesPage.tsx:52`.
- **Expected:** "My work" and "My active jobs" scope to the logged-in consultant.
- **Actual:** `TodayPage` uses `currentMember.id` (= owner's id) for `currentMemberId` scoping (`TodayPage.tsx:102`, `:114`), so **every consultant except the first sees the owner's queue, not their own**. `JobsPage` defaults a new job's owner to the same wrong member (`JobsPage.tsx:34`). Permissions are unaffected (capabilities come from a separate server RPC keyed on `auth.uid()`).
- **Blocks production:** No (no data loss, owner unaffected), but on a six-consultant desk five of six users get a wrong daily work queue — directly the "multiple consultants" failure mode.
- **Smallest fix:** in `OrganizationProvider`, `const membership = query.data?.find(m => m.user_id === user?.id) ?? null` instead of `query.data?.[0]`.
- **Verify:** as a non-owner member, Today's "My work" shows only that member's items; a new job defaults its owner to the creator. Add a regression test with two members asserting `membership.user_id === currentUser.id`.

### F4 — Live edge functions with no source in the repo — MEDIUM

- **What I did:** `git ls-files` on `supabase/functions/refer` and `ai-evaluate` (both empty in the tree), then fetched the **deployed** source and checked backing DB objects.
- **Actual:** commit `8e05304 "subtract … the referrals feature"` removed both from the repo, but both are **ACTIVE on staging and production** with `verify_jwt:false`. `ai-evaluate` is a safe `410` tombstone. `refer` is a full public referral intake (service-role, rate-limited, signed private-bucket uploads) — but its backing RPCs/tables (`resolve_referral_link`, `submit_referral`, referral tables) were dropped from both databases, so it now returns `400 link_unavailable` for every call. It fails safely, but it is a live internet-facing endpoint that is not in version control, not covered by the repo's tests or the `rpc-acl` guard, and won't be patched with the rest of the app.
- **Blocks production:** No. But it is release-integrity/observability debt and unmaintained attack surface.
- **Smallest fix:** either delete the deployed `refer` and `ai-evaluate` functions (`supabase functions delete refer ai-evaluate` against each project), or restore their source to the repo if referrals are coming back. Remove the dead `.referral-filter` CSS in `features.css`. (Note: the `referral` value in `optionSets.ts` is a legitimate candidate **source** and stays.)
- **Verify:** `list_edge_functions` no longer lists them (or the repo contains their source and CI redeploys them); the frontend has no dead referral options.

### F5 — Supabase advisor items — LOW–MEDIUM

- `pg_net` extension installed in the `public` schema (advisor WARN) — move to a dedicated schema.
- `normalize_email` has a mutable `search_path` (advisor WARN) — add `set search_path = public` like the other functions.
- Auth **leaked-password protection is disabled** — only relevant because local password auth exists; production is Google-only, so low. Enable it anyway.
- Five `rls_enabled_no_policy` tables (`email_delivery_payloads`, `google_calendar_secrets`, `google_oauth_states`, `maintenance_heartbeats`, `submission_link_events`). These are **intentional deny-all** internal/secret tables reached only via `SECURITY DEFINER` functions — verified safe (RLS-enabled + no policy = no client access) — but worth an explicit comment so they aren't mistaken for a mistake.
- **Verify:** `get_advisors(type: security)` returns clean (or only the accepted deny-all tables).

### F6 — Scale/performance smells — LOW (P2)

- `listCompanies` / `listContacts` / `listJobs` (`repository.ts:94,97,100`) fetch **all** org rows with no `limit`/pagination. Candidates already uses a proper server-side paged RPC; these three don't. After a real migration (thousands of companies/contacts/jobs) each page load pulls the whole table into the browser.
- The Today page fires **11 list queries in one `Promise.all`** on every load (`TodayPage.tsx:92`) — acceptable now, heavy at volume.
- Main JS bundle is **766 kB** (gzip 224 kB); build warns. Code-split the heavy `docx`/scorecard chunks (already lazy) further if first-load matters.
- **Smallest fix:** add `.limit()` + "show more"/search to the three list queries; defer non-critical Today queries. Not blocking; do during hardening.

---

## Status ledger

**Confirmed working (exercised + verified):**

- Auth/session gating: unauthenticated → login; injected session → workspace; staging correctly has email/password auth **disabled server-side** (Google-only), and password auth is DEV-gated in `env.ts` so it can't ship.
- **Tenant isolation** — as Org B, could not read/update Org A candidates, private salary/email, or companies; `search_candidates_page` with a **forged** Org A id returned 0 (RPC enforces membership, doesn't trust the passed org id).
- **Role escalation blocked** — consultant could not self-grant the owner role, insert a member, create an invitation, or edit org settings; read-only could not create a candidate.
- **Read-only UI gating** — the read-only user sees no write controls on the candidates page.
- **Candidate create + duplicate detection** — atomic `create_candidate_with_profile`; entering an existing email surfaces the colliding candidate with an "Open existing record" link and switches to "Save as update" (no duplicate created; DB confirmed).
- **Client → contact → job → add-to-job → stage move** — full delivery spine works end-to-end with correct DB state, success toasts, and required-field gating (Create-job button correctly disabled until a client is chosen). Stage move records `stage_history`.
- **One-job-one-hire** — advisory lock + partial unique index `placements_one_active_hire_per_job` (verified live) makes a double placement impossible even under a race.
- **Revenue-split cap** — advisory lock + running-sum check + `CHECK (0..100)` + `UNIQUE(placement_id, member_id)` (all verified live).
- **Transactional candidate merge** — `FOR UPDATE` locks, conflict detection, consent/legal-hold reconciliation.
- **Public review boundary** — `resolve_submission_link`/`submit_submission_feedback` are **service-role only** on staging; the edge function enforces a 32-char token minimum, rate-limits to `429`, validates the decision enum, and issues 5-minute signed document URLs.
- **Realtime** — org-scoped channel + RLS-checked refetch (never trusts the payload), mutation-in-flight guard with replay; private details are off the publication.
- **Mobile (375px)** — no body horizontal overflow; wide tables scroll inside their own container.
- **Gates** — typecheck, lint, 357 unit tests, and production build all pass.

**Working but fragile:** F3 (membership resolution), F6 (unbounded lists / Today fan-out).

**Partially implemented / drifted:** F4 (referrals removed from repo, still deployed).

**Broken:** F1 (anon-executable maintenance cron) — broken security boundary, live on production.

**Not tested from this environment (not assumed working):**
- Local `supabase start` / `db reset` / `test:rls` — **no Docker** on this machine.
- **Email delivery** (Resend) for invitations and submissions — the no-outbound-email constraint; the queued/durable-delivery tables were reviewed but no message was sent.
- **Google Calendar OAuth** end-to-end — reviewed in code (encrypted server-only tokens, deterministic sync) but the live connect/refresh flow was **not exercised**.
- **Real concurrency at scale** (6 simultaneous browsers) — the integrity guarantees were proven at the DB level (advisory locks, unique indexes), not with real concurrent clients.
- CV parsing / candidate-profile AI generation and the import/migration flow — **not exercised** this pass (deprioritised in favour of the security and multi-user findings); recommend covering before pilot sign-off.

---

## Biggest risks, by failure mode

- **Security / privacy incident:** F1 is the headline — an unauthenticated production capability (SSRF + persistent cron + maintenance DoS). F2 is the systemic reason it exists and will recur.
- **Failures when multiple consultants use the system heavily:** F3 — five of six consultants get the wrong "My work" queue and wrong default job owner. This is the most likely source of day-one recruiter frustration and mis-attributed work.
- **Lost candidate/client data:** low. Writes are atomic RPCs, merges are transactional, and RLS isolation held under every probe. No data-loss path was found.
- **Incorrect submissions or placements:** low. One-job-one-hire and the client-review boundary are strong. Watch F3's owner-default so placements/jobs aren't silently attributed to the owner.
- **Commercial mistakes:** low-moderate. Fee/split maths are guarded (cap + CHECK + locks); salary period is consistently monthly in the UI. Not exhaustively exercised end-to-end (offer→placement→invoice) this pass.
- **Reliability/observability:** F4 (unmanaged live endpoints) and F2 (guard blind spot) are the real reliability debts; F6 is a scale cliff after migration.

---

## Fix plan

### P0 — before any real users
1. **F1** — revoke `schedule_maintenance_cron` from `anon`/`public` (one-line migration). Re-establish staging's maintenance cron afterwards.
2. **F2** — set safe default privileges (`ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM anon, public`), revoke execute on all existing functions from anon/public, re-grant the intended `authenticated` allowlist, and make the `rpc-acl` guard run against a database that carries the platform baseline so it can never go stale again.

### P1 — for reliable daily agency use
3. **F3** — resolve `membership` as the caller's own row (`.find(user_id === user.id)`), not `[0]`; add a two-member regression test.
4. **F4** — delete the deployed `refer`/`ai-evaluate` functions (or restore their source); remove leftover referral references.

### P2 — hardening and simplification
5. **F5** — advisor cleanup: move `pg_net` out of `public`, pin `normalize_email` search_path, enable leaked-password protection, comment the intentional deny-all tables.
6. **F6** — paginate the three unbounded list queries; trim the Today fan-out; consider further code-splitting the 766 kB bundle.

Everything above is a small, targeted change. None require re-architecting; the foundations are sound.
