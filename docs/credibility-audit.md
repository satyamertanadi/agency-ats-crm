# Production credibility audit and remediation runbook

A workspace being shown to a prospect contained a scraped sentence where a candidate's name should
be, fabricated executives left over from a fixture run, a team member called "Production release
verifier", 24 unassigned overdue tasks, four ownerless jobs, a client marked lost that still carried
an open job and pipeline value, and fee figures that could not be right.

None of that is a bug in the product. Every one of them is a reason a demo goes badly, and none of
them is visible from the code.

This runbook is how they are found and, separately, how they are fixed.

## The audit is read-only, and stays that way

`scripts/credibility-audit.sql` contains nothing but `SELECT`. It is meant to be run against a live
client database by someone who has not read it, so "it only reports" has to be true by inspection
rather than by intention. A unit test asserts the file contains no writing statement; if you extend
it, that test is the thing you have to satisfy.

Remediation is a **separate step**, below, and never runs as part of a deployment.

## Running it

```bash
psql "$PRODUCTION_DATABASE_URL" -v org="'<organization-uuid>'" -f scripts/credibility-audit.sql
```

Every organisation in the instance (the dedicated-instance deployment normally has one):

```bash
psql "$PRODUCTION_DATABASE_URL" -v org="null" -f scripts/credibility-audit.sql
```

Keep the output. It is the before-state for anything you change next:

```bash
psql "$PRODUCTION_DATABASE_URL" -v org="null" -f scripts/credibility-audit.sql > audit-$(date +%F).txt
```

## What it reports

One row per finding: `check_name`, `severity`, `entity_type`, `entity_id`, `detail`. `entity_id` is
what remediation acts on; `detail` is what a human reads to decide whether it should.

| Check | Severity | What it means |
|---|---|---|
| `sentence_like_name` | high | A candidate name containing digits, an email, a URL, over 100 characters, more than nine words, or English function words — prose, not a name |
| `test_identity` | high | Candidate or team member whose name or address marks it as a fixture. `@example.com` and `.example` are RFC 2606 reserved and are what `scripts/generate-demo-data.mjs` uses |
| `compensation_outlier` | medium | A salary 25× above or below the workspace median **for the same currency**, and only where at least five comparable records exist |
| `compensation_impossible` | high | A recorded salary of zero or less |
| `fee_impossible` | high | A placement fee above the salary it derives from, a negative fee, or a job fee percentage outside 0–100 |
| `unassigned_overdue_task` | medium | Overdue, open, and owned by nobody — work the product is not telling anyone about |
| `unassigned_open_job` | medium | An open job with no accountable consultant |
| `contradictory_client_state` | high | A client marked lost, inactive or do-not-contact that still has open jobs. The product keeps acting on the job while the account record says the relationship ended |
| `missing_commercial_terms` | high | An open job for a client with no agreement in force |
| `nonsense_activity` | medium | Placeholder or contentless journal entries on the most-quoted surface in a demo |

### What it deliberately does not do

It does not reject or "correct" unusual names or salaries. `Maria del Carmen Fernandez de la Vega
Sanz` is six words and real; Indonesian names frequently have no surname; an IDR salary is seven
digits larger than a USD one and both are right. Compensation outliers are measured against the
workspace's own distribution per currency, never a hardcoded number, and are not reported at all
until there are five comparable records to form a distribution from.

Every check flags for review. A rule confident enough to clean these automatically would eventually
delete a real person's record.

## Remediation

**Nothing here is automatic, and nothing hard-deletes.**

1. **Get approval.** Produce the list of `entity_id`s and the proposed action for each. The workspace
   owner approves it. An audit finding is not an instruction.
2. **Export first.**
   ```bash
   pg_dump "$PRODUCTION_DATABASE_URL" --data-only --table=public.candidates --table=public.companies \
     --table=public.jobs --table=public.tasks --table=public.activities > pre-cleanup-$(date +%F).sql
   ```
   Restoring from this export is the documented recovery path if a correction turns out to be wrong.
3. **Prefer, in this order:** correct the value → reassign the owner → archive the record → reversible
   soft delete. Only ever the least destructive option that resolves the finding.
4. **Use the product's own audited paths.** `update_candidate_profile`, `set_candidate_archived`,
   `set_company_bd_stage` and the task/job owner writes all record to `audit_logs`. A direct `UPDATE`
   against the table leaves no trail and is how a correction becomes indistinguishable from a
   corruption six months later.
5. **Re-run the audit.** The result should be clean, or every remaining finding should be one
   somebody has explicitly decided to keep. Record which, and why, alongside the export.

### By finding

| Finding | Normal action |
|---|---|
| `sentence_like_name` | Correct the name from the CV or source record. Archive only if the record is a duplicate with no history |
| `test_identity` | Archive the candidate. For a member, suspend it — never delete, since their `created_by` rows are real history |
| `compensation_impossible` / `fee_impossible` | Correct from the signed agreement. If the true value is unknown, clear the field rather than leaving a wrong one |
| `compensation_outlier` | Usually a currency or unit error (a monthly figure entered as annual). Confirm before changing |
| `unassigned_overdue_task` / `unassigned_open_job` | Assign an owner, or close it. Both appear in Today's organisation-wide queue, which labels them as unassigned rather than attributing them to whoever is looking |
| `contradictory_client_state` | Decide which fact is true — close the jobs, or reopen the account. Do not leave both |
| `missing_commercial_terms` | Record the agreement, or mark the job as internal/pro-bono if that is what it is |
| `nonsense_activity` | Correct the summary. Activities are the journal; deleting one removes evidence of work that did happen |

## Keeping fixtures out of production

- `scripts/generate-demo-data.mjs` puts every fabricated address under an RFC 2606 reserved domain,
  which is what makes `test_identity` reliable. Keep it that way: a demo fixture that looks
  indistinguishable from real data is one nobody can clean up later.
- Never run the demo generator against a production database. It exists for demo workspaces.
- CI verification records: any record created by a verification run must be removed by that run, or
  carry an address the audit will catch. A verifier identity that survives into a scorecard is the
  "Production release verifier" finding.

## Entry-boundary prompting

`src/shared/lib/credibility.ts` applies the same name rules at the point of entry, as a **hint under
the field** — never a validation error. It asks whether the value is right; it does not stop the
save. The audit here is the authority for records already stored; that is the cheaper prompt for the
person who still has the answer in front of them.
