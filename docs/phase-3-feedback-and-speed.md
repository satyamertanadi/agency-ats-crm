# Phase 3 — Feedback and perceived speed

## Root causes addressed

- Mutations had no success channel at all. A create closed its modal and the page changed underneath the user; the only feedback surface in the product was an inline `form-error`, so every successful action was silent and every failure was visible only if the form that caused it was still on screen.
- Every list rendered a centred spinner and then a full table, so the page height changed on arrival. There was no layout-shaped loading state anywhere.
- Kanban drags waited on the RPC plus a full pipeline refetch before the card visibly moved. The delay reads as a dropped drag and invites a second one, and a failed move had no way to tell the user it had been undone.
- Repeated Today items only collapsed for unowned jobs. The grouping mechanism existed but was applied once, so a batch of identically-titled follow-up tasks still rendered as N full rows and buried the genuinely distinct actions.

## Implementation

`src/shared/ui/Toast.tsx` adds the feedback layer: a provider mounted once in `main.tsx`, a `useToast()` hook, and two live regions — confirmations announce politely, failures assertively. Toasts state what changed ("Ayu was added to Senior Project Manager") rather than "Success". Identical live toasts are refreshed rather than stacked, because bulk actions fire one mutation per row. Errors persist roughly twice as long as confirmations, and an error carrying a recovery action does not auto-dismiss.

`src/shared/ui/States.tsx` adds `Skeleton`, `TableSkeleton`, and `BoardSkeleton`. They are aria-hidden and paired with one visually-hidden live message, so a screen reader hears "Loading candidates" instead of a wall of placeholder boxes. The global `prefers-reduced-motion` rule in `base.css` already neutralises the shimmer.

`src/features/core/useStageMove.ts` holds the optimistic stage move. Both kanbans — the consultant Job Workspace and the legacy vacancy pipeline — write to the same `['pipeline', jobId]` cache through the same RPC, so they share one implementation rather than two that can drift. It cancels in-flight queries, patches `current_stage_id` and the embedded `pipeline_stages` relation together, snapshots the whole pipeline for rollback, and resyncs on settle rather than on success.

`buildTodayWorkItems` now groups repeated linked tasks by task title *and* urgency. `TodayWorkItem` gained `groupNoun` because the Today list previously hardcoded "jobs" in the disclosure toggle.

## Integrity and privacy behavior

- Grouping never merges across urgency: an overdue follow-up is not hidden behind a disclosure with an upcoming one.
- Only linked tasks group. Untethered tasks sharing a title have no record name to distinguish their rows once collapsed, so they stay flat.
- A group inherits the earliest due date among its members, so it keeps the sort position of its most urgent item.
- A rollback resyncs against the server rather than trusting the restored snapshot, because a rejected move may mean the stage no longer exists rather than a transient network error.
- Stage history is written server-side by `move_job_candidate_stage`; the optimistic path touches only the query cache, so a rolled-back move produces no history event.

## Migration and rollback risks

- No database migration. This phase is entirely client-side.
- `TodayWorkItem.groupNoun` is optional and defaults to "items" at the render site, so any item builder not yet updated degrades to a correct generic noun rather than the wrong one.
- Reverting the optimistic move is safe in isolation: `useStageMove` is the only caller of `moveCandidate`, and removing it restores the previous invalidate-on-success behaviour without schema impact.
- The toast provider sits inside `BrowserRouter` and outside `AuthProvider`, so a toast raised during sign-out still renders.

## Verification

- `Toast.test.tsx` covers live-region politeness, error persistence, dedupe, the action/dismiss contract, and the stack cap.
- `workflow.test.ts` gained grouping coverage: collapse, the urgency split, sort-position inheritance, and the unlinked-task exemption. The pre-existing test asserting two same-titled linked tasks render as two rows was rewritten — it asserted exactly the behaviour this phase replaces — and its original guarantee (the differentiating name leads) is preserved for the single-task case and for group entry labels.
- Full suite: 98 tests across 18 files, plus `typecheck` and `lint` (eslint + stylelint) clean.
- Styles verified in a running browser against the resolved tokens: tone triplets applied, error/success text at 6.87:1 and 6.91:1 contrast, and the mobile viewport clearing the bottom nav with no horizontal page scroll.

## What remains

Not every one of the ~100 mutation sites raises a toast yet. This phase wired the consultant-critical paths — stage moves, candidate create/merge, add-to-job, job create, owner assignment, and task create/complete. The remaining admin and settings surfaces still rely on inline errors and should adopt `useToast` as they are next touched.
