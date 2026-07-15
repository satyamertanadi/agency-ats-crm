# Production setup

Use separate staging and production accounts/projects. Never copy local seed data, a production service-role key, a Calendar encryption key, or Resend/Google secrets into the browser or Git.

## Supabase

1. Create staging and production projects in the intended region; enable backups/PITR before client data.
2. Apply migrations through the approved release pipeline. Do not run `supabase/seed.sql` remotely.
3. Enable Google Auth, disable public email/password signup, and set exact HTTPS site/redirect URLs.
4. Create private `candidate-documents` storage and verify its RLS policies.
5. Deploy Edge Functions from `supabase/functions`; set `APP_ORIGIN`, `ENVIRONMENT`, `EMAIL_FROM`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, and a randomly generated `CALENDAR_TOKEN_ENCRYPTION_KEY`.
6. Provision the first organization and owner through an audited administrative process, then invite five consultants and the named support administrator.

## Google

Create separate OAuth clients for staging and production. Normal sign-in requests identity scopes only. Calendar connection is a separate incremental authorization using offline access and the Edge callback. Add the Supabase Auth callback and `calendar-auth-callback` URL exactly; reject wildcard production redirects.

## Resend and web hosting

Verify a client-approved sender domain and set SPF/DKIM. Configure Vercel production variables with `VITE_ALLOW_PASSWORD_AUTH=false` and `VITE_ALLOW_SELF_SERVICE_ONBOARDING=false`. Link the custom domain, enable deployment protection for staging, and run the `Production smoke` workflow after each promotion.

## Monitoring

Set a Sentry project per environment, keep traces conservative, and leave replay disabled. Verify candidate names, emails, salaries, tokens, resumes, and submission bodies do not appear in events or structured logs. Record alert owners and escalation contacts.

## Automatic CV parsing

Set `AI_PROVIDER=anthropic`, an explicit current `AI_MODEL`, `ANTHROPIC_API_KEY`, and a random `WORKER_SECRET` as Supabase Function secrets. Deploy `parse-candidate-cv`, then configure the repository secrets `SUPABASE_URL` and `CV_PARSE_WORKER_SECRET` so the hourly cleanup workflow can purge unconfirmed CV drafts after 24 hours. The GitHub secret must equal the Function `WORKER_SECRET`.

Before enabling the feature for consultants, test one English PDF, Indonesian PDF, scanned PDF, and DOCX in staging. Confirm extracted PII is visible only to the uploader, duplicate email handling opens the existing candidate, accepted files remain available, and abandoned files disappear after cleanup.

## Promotion

Promote the exact staging-tested commit. Run database checks before app promotion, run public smoke after promotion, test one invited Google login and one Calendar create/update/cancel flow, and record the deployment plus rollback target in the release checklist.
