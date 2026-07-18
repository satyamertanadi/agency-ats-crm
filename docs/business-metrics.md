# Canonical business metrics

These definitions are the product contract for Today, reports, reconciliation scripts, and future
RPCs. Changing one requires updating the shared metric functions and their tests in the same release.

| Metric | Definition |
| --- | --- |
| Submission | One unique candidate/job pair included in a client submission package in the selected workspace-timezone period. Resending the pair does not create a second funnel milestone. |
| Interview | A submitted candidate/job pair with at least one non-cancelled interview created in the period. Multiple rounds and reschedules remain one funnel milestone. |
| Offer | A submitted candidate/job pair with at least one non-draft offer created in the period. Declined or withdrawn offers still prove that the milestone was reached. |
| Placement | A unique candidate/job pair with a non-cancelled placement recorded in the period. “Recorded placement” is the KPI label when all such statuses are included. Funnel conversion further limits this count to the selected submission cohort. |
| Completed placement | A placement whose status is exactly `completed`. Confirmed, started, failed-guarantee, cancelled, and recorded-only placements are not completed. |
| Overdue task | A non-deleted task in `open` or `in_progress` whose due timestamp is earlier than the surface refresh time. It is not restricted by the report creation-date range. |
| Expected fee | The traceable estimate derived from the applicable job override or account agreement and the agreed salary; it is not a realised fee. Not implemented in Phase 1. |
| Realised fee | The placement fee stored on a non-cancelled placement, in that placement's currency. Base-currency totals include only matching currencies until an explicit exchange-rate source exists. |

The report funnel is cohort-based: later milestones are counted only for candidate/job pairs in its
submission cohort. Consultant performance credits the authenticated creator stored on each source
record; ownership and authorship are intentionally different concepts.
