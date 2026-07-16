# Design-partner profile rollout

## Promise and offer

The founding offer is IDR 1.5m per agency per month for up to ten seats, month to month through Month 6, with no setup fee and manual invoicing. Billing starts only after approved migration mapping, reconciliation, and production UAT. The measurable promise is a reviewed, role-tailored, client-ready candidate profile within five minutes of starting from an accepted CV.

## Partner sequence

| Window | Operating action | Exit evidence |
|---|---|---|
| Weeks 1–2 | Observe three agencies, time the existing workflow, collect redacted templates, complete privacy-policy work, and start Meta verification without placing WhatsApp on the critical path. | Three baselines and approved no-PII development fixtures. |
| Weeks 3–10 | Dogfood evidence, template, anonymization, review, and export behavior. | Unit/RLS/staging/browser gates green; no fabricated evidence. |
| Week 11 | Enable Partner A after migration dry run and production UAT. | Reconciliation approval and named incident owner. |
| Week 14 | Enable Partner B after Partner A corrections are closed. | Same gate; no open severity-1/2 issue. |
| Week 17 | Enable Partner C after Partner B corrections are closed. | Same gate; no open tenant-isolation issue. |
| Weeks 21–24 | Build careers/apply only if every conditional gate below passes. | Written gate decision captured in the release record. |

Each partner export must be mapped and reconciled in a disposable dry run. The 48-hour migration promise starts only after the partner approves that mapping. Production provisioning is manual, public organization signup and subscription billing stay disabled, and each founding organization is configured with the service-only `configure_founding_partner` RPC.

## Weekly review

Record only non-PII aggregates:

- weekly active recruiter count;
- generated, finalized, exported, and submitted profile counts;
- generation success rate and failure-code distribution;
- median generation-to-finalization duration;
- edited-field count and anonymized/named split;
- percentage of client submissions that attach a generated profile;
- incidents by severity and tenant-isolation status.

The database records provider/model/prompt version, input hash/version, tokens, duration, normalized evidence, edited-field count, exported formats, finalization duration, failure reason, and submission timestamp. Do not copy candidate text into analytics, combine organizations for model improvement, or publish cross-organization benchmarks.

## Careers/apply gate

All conditions must be true at the end of Week 20:

1. all three partners are live and paying;
2. each has at least two weekly active recruiters;
3. median reviewed-profile time is at most five minutes;
4. generation succeeds at least 95% of the time;
5. no severity-1/2 or tenant-isolation defect is unresolved.

If any condition fails, Weeks 21–24 remain profile reliability and onboarding work. WhatsApp is considered after Month 6 only when Meta access is ready and two partners rank it among their top two remaining pains; otherwise semantic talent search is next.
