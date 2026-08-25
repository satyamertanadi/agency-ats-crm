# Demo workspace

How to get a workspace that is safe to show someone, and what "safe" means here.

**This document never authorises editing production records.** Every finding below that concerns the
live workspace is a manual, reviewed correction made through the product's own edit screens by
someone who knows the account — never a migration, never a bulk script. A UI-polish pass that
rewrites real candidate or client rows is a data-loss incident with a tidy commit message.

## Start from the generator

`npm run demo:generate` produces the fixture in `scripts/generate-demo-data.mjs`; see
[demo-data.md](demo-data.md) for how to generate and import it. What matters here is what it
guarantees, because those properties are structural rather than promises:

- **Nobody can be contacted.** Every address is under a `.example` domain, which RFC 2606 reserves so
  it can never resolve. `phone` and `linkedin_url` are empty strings. There is no channel out.
- **Every row is removable.** `legacy_id` carries the `DEMO-IDN-V1-` prefix, so the whole set is one
  predicate away and `ROLLBACK_ORDER` takes it out cleanly.
- **The names are visibly invented**, and industries use canonical keys from
  `src/shared/lib/industries.ts` rather than free text — seeding labels would make the Clients
  industry filter look broken in the exact workspace someone is evaluating.
- Owners are assigned round-robin, so no demo record shows as unowned by accident.
- Statuses are mixed on purpose: placed candidates, a `do_not_contact` tail with withdrawn consent,
  an inactive contact.

If you add records to that file, the two rules are: the address stays under `.example`, and the
`legacy_id` keeps the prefix. Those are the safety properties. Everything else is presentation.

## What the generator does not cover

**Commercial terms.** `commercial_terms` is not part of the import pipeline (`IMPORT_ORDER` in the
generator, and the `execute-import` function), so the fixture cannot seed fee agreements. A generated
demo workspace therefore shows "Fee agreement missing" as an account-health risk on **every** client,
which reads as a neglected book rather than as a working agency.

Fix it by hand before showing the workspace: open two or three demo clients and record commercial
terms through **Client → Commercial terms**. Leave at least one account without them — the Clients
account-health filter and the Today risk queue are worth demonstrating, and they need something real
to point at.

## Before a demo: the checklist

Each line here is a real finding from the live audit, phrased as something to check rather than
something to assume.

- [ ] **No malformed candidate names.** Imported records occasionally carry a mangled full name.
      Correct it on the candidate record; do not batch-rewrite names, and do not let a script decide
      what a person is called.
- [ ] **No website pointing at the ATS.** A client website field holding a relative path or a copy of
      an ATS URL renders as a link back into the app. `externalUrl.ts` already refuses to present a
      malformed value as a trusted link, so it will show as flagged rather than dangerous — but a
      flagged field is still a thing someone will ask about. Correct the record.
- [ ] **Jobs have owners.** A board of unowned jobs now says "Unassigned" in words on every card,
      which is accurate and very visible. Assign them.
- [ ] **Overdue tasks are deliberate.** Today groups work into Blocked / Overdue / Due today / Later.
      A handful of overdue items demonstrates the queue; a wall of year-old ones demonstrates
      abandonment. Close the stale ones, keep two or three.
- [ ] **At least some accounts have fee agreements** (see above), and at least one does not.
- [ ] **At least one placement with revenue**, so Scorecard is not all zeroes. The generator seeds
      two placements, six revenue splits and two invoices.
- [ ] **One or two visible risk conditions**, not twenty. Account health and Today are more
      convincing showing a book under control with two problems in it.
- [ ] **No real candidate or client data**, and no Samara or other proprietary records. Check the
      Clients list and the candidate list, not just the counts.
- [ ] **Scorecard has a sensible date range.** It defaults to a window that may predate the demo data.

## Screenshots and recordings

Use the demo workspace, never production. Candidate private details (email, phone, salary) render on
the candidate record, and account commercial terms render on the client record — both are visible in
any full-page capture of a real workspace.

## Removing the demo data

`ROLLBACK_ORDER` reverses `IMPORT_ORDER` so foreign keys unwind in the right sequence. The whole set
is identified by the `legacy_id` prefix; nothing outside that prefix should be touched by a rollback,
and if a rollback would remove a row without it, stop and find out why.
