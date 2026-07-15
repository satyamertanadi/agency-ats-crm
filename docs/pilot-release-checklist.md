# Pilot release checklist

Record an owner, date, and evidence link for every item. A blank item is a release blocker.

## Infrastructure and identity

- [ ] Dedicated staging and production Supabase/Vercel projects are linked to the correct Git branch.
- [ ] Production database has no seed users, local passwords, or development OAuth clients.
- [ ] Custom HTTPS domain, exact redirect allowlist, environment-specific CORS, CSP, and security headers are verified.
- [ ] Google consent screen, application identity, origins, Supabase callback, and Calendar callback are verified.
- [ ] Resend sender domain is verified and invitation/submission delivery is tested.
- [ ] Owner, five consultant, and named support-admin Google accounts are confirmed; no shared account exists.

## Security, privacy, and recovery

- [ ] CI is green and there are zero open critical/high security defects.
- [ ] Owner/consultant permissions, suspension, foreign IDs, storage, and Edge Function authorization are signed off.
- [ ] Sentry/log scrubbing is checked with representative candidate data; session replay is off.
- [ ] Automated backups or PITR are enabled and retention is documented.
- [ ] A staging restore drill proves the target recovery point/time and records screenshots/logs.
- [ ] Deployment rollback, Calendar outage, email outage, and security-incident runbooks are exercised.

## Migration and workflow UAT

- [ ] Representative workbooks complete a staging dry run, duplicate/orphan review, commit, and rollback.
- [ ] Source-versus-imported counts, rejected rows, omitted documents, and legacy relationships reconcile.
- [ ] Source freeze and final delta-import procedure is approved.
- [ ] Future imported interviews remain Calendar-inactive until owner activation.
- [ ] Client UAT completes company → contact → job → candidate → pipeline → submission → feedback → interview → offer → placement → split/invoice.
- [ ] Search, pagination, documents, merge, archive/restore, reporting, and useful failure recovery pass.
- [ ] Six concurrent users and twice the expected dataset remain responsive in the supported browser.
- [ ] Keyboard operation, labels, responsive layouts, and Chromium/client-browser checks pass.

## Commercial entry and exit

- [ ] Named-user limit, migration scope, support channel, response targets, maintenance window, DPA/privacy/retention/export terms, and manual invoicing are signed.
- [ ] Client owner and vendor support administrator approve production cutover.
- [ ] Pilot start date is recorded.
- [ ] General availability is blocked until 30 pilot days, no unresolved severity-1/2 incidents, all six users operating, Calendar reliability evidence, exercised runbooks, and written client acceptance.
