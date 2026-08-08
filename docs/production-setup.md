# Production setup

Use separate staging and production accounts/projects. Never copy local seed data, a production service-role key, a Calendar encryption key, or Resend/Google secrets into the browser or Git.

## Supabase

1. Create staging and production projects in the intended region; enable backups/PITR before client data.
2. Apply migrations through the approved release pipeline. Do not run `supabase/seed.sql` remotely.
3. Enable Google Auth, disable public email/password signup, and set exact HTTPS site/redirect URLs.
4. Create private `candidate-documents` storage and verify its RLS policies.
5. Deploy Edge Functions from `supabase/functions`; set `APP_ORIGIN`, `ENVIRONMENT`, `EMAIL_FROM`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, `GOOGLE_PLACES_API_KEY`, and a randomly generated `CALENDAR_TOKEN_ENCRYPTION_KEY`. Leave the optional `CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION`/`_PREVIOUS`/`_PREVIOUS_VERSION` unset until an actual key rotation -- see "Rotating the Calendar token encryption key" in `docs/runbooks.md`.
6. Provision the first organization and owner through an audited administrative process, then invite five consultants and the named support administrator.

## Google

Create separate OAuth clients for staging and production. Normal sign-in requests identity scopes only. Calendar connection is a separate incremental authorization using offline access and the Edge callback. Add the Supabase Auth callback and `calendar-auth-callback` URL exactly; reject wildcard production redirects.

`GOOGLE_PLACES_API_KEY` is a separate credential type -- a Places API (New) key, not an OAuth client -- created against the same or a different Google Cloud project, with the Places API enabled and billing active. It has no redirect URI and is never sent to the browser; `location-autocomplete` is the only reader. Location search degrades to plain text entry if it is unset, so it is not a launch blocker.

## Resend and web hosting

Verify a client-approved sender domain and set SPF/DKIM. Configure Vercel production variables with `VITE_ALLOW_PASSWORD_AUTH=false` and `VITE_ALLOW_SELF_SERVICE_ONBOARDING=false`. Link the custom domain, enable deployment protection for staging, and run the `Production smoke` workflow after each promotion.

## Monitoring

Set a Sentry project per environment, keep traces conservative, and leave replay disabled. Verify candidate names, emails, salaries, tokens, resumes, and submission bodies do not appear in events or structured logs. Record alert owners and escalation contacts.

## Automatic CV parsing

Set `AI_PROVIDER=anthropic`, an explicit current `AI_MODEL`, `ANTHROPIC_API_KEY`, and a random `WORKER_SECRET` as Supabase Function secrets. Optionally set `AI_MODEL_PARSE` to a cheaper model (e.g. `claude-haiku-4-5`) for the mechanical CV and LinkedIn parsers; it falls back to `AI_MODEL` when unset, and evaluation (`generate-candidate-profile`) always uses `AI_MODEL`. Deploy `parse-candidate-cv`, then configure the repository secrets `SUPABASE_URL` and `CV_PARSE_WORKER_SECRET` so the hourly cleanup workflow can purge unconfirmed CV drafts after 24 hours. The GitHub secret must equal the Function `WORKER_SECRET`.

Before enabling the feature for consultants, test one English PDF, Indonesian PDF, scanned PDF, and DOCX in staging. Confirm extracted PII is visible only to the uploader, duplicate email handling opens the existing candidate, accepted files remain available, and abandoned files disappear after cleanup.

`generate-candidate-profile` and `parse-candidate-cv` both enforce per-user and per-organization hourly caps (20 and 100 profile generations/hour; 10 CV parse dispatches/hour, counting retries), plus a monthly per-organization token ceiling on profile generation, since `ANTHROPIC_API_KEY` is one key for the whole deployment and an unbounded caller can exhaust it for every tenant. The monthly ceiling defaults to 50,000,000 tokens and is overridable per environment via the `AI_PROFILE_MONTHLY_TOKEN_CEILING` Supabase Function secret. These are deliberately generous starting points, not tuned limits — watch for `profile_rate_limited`, `org_profile_rate_limited`, `org_monthly_ceiling_reached`, and `parse_rate_limited` in the Function logs and tighten once real usage is visible.

## Staging-gated Supabase and Vercel promotion

Migrations, Edge Functions, and the web application deploy through `.github/workflows/deploy.yml`, never by hand. Every `main` commit first passes lint, typecheck, unit tests, and build. Supabase then deploys to staging, where Edge preflights and the real-provider CV/profile contract run. Only that same commit can update production Supabase. Vercel builds one production candidate, browser-smokes its unaliased URL, and promotes that exact artifact; a rebuild between browser gate and promotion is forbidden.

Repository secrets the workflow requires:

| Secret | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token for the CLI |
| `STAGING_PROJECT_REF` / `PRODUCTION_PROJECT_REF` | project refs of the two Supabase projects |
| `STAGING_DB_PASSWORD` / `PRODUCTION_DB_PASSWORD` | database passwords, used by `supabase db push` |
| `STAGING_SUPABASE_URL` | `https://<staging-ref>.supabase.co` |
| `STAGING_SUPABASE_ANON_KEY` | staging anon key |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | staging service-role key; the gate uses it to provision and clean up its own test user, org, and candidate |
| `PRODUCTION_SUPABASE_URL` | production project URL used only for post-deploy Edge preflights |
| `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | credentials and identifiers for the pinned Vercel CLI deployment |
| `PRODUCTION_APP_URL` | canonical HTTPS production URL used for rollback metadata and post-promotion browser smoke |

Staging must mirror production's Function secrets (`AI_PROVIDER`, `AI_MODEL`, the optional `AI_MODEL_PARSE`, `ANTHROPIC_API_KEY`, `WORKER_SECRET`, `APP_ORIGIN`, and the email/Calendar secrets above). The gate fails when an AI secret, output schema, evidence contract, persistence step, or dual-format finalization contract breaks. Its synthetic organization, user, records, documents, and storage objects use a unique run identifier and are deleted after each run.

## Candidate profile rollout

New and existing organizations default to `profile_v1=false`. After migration mapping, reconciliation, and production UAT, service staff enable a founding partner and enforce ten seats with the service-role-only RPC:

```sql
select public.configure_founding_partner('<organization-id>'::uuid, true);
```

Do not expose the service-role key in a browser or run this RPC from the client. Disable the feature with the same RPC and `false`; disabling hides generation immediately but retains immutable versions and private documents.

## Promotion

Promote the exact staging-tested commit. Run database checks before app promotion, run public smoke after promotion, test one invited Google login and one Calendar create/update/cancel flow, and record the deployment plus rollback target in the release checklist.
