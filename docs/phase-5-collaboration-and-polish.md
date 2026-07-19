# Phase 5 — Collaboration, mobile usability, and polish

## Root causes addressed

- Nothing in the product was live. Two consultants on one pipeline — the normal case — could only discover each other's moves by refreshing, which trains the habit of distrusting what is on screen.
- The board is a horizontal scroller. On a 375px screen that made Offer six swipes from Sourcing, with no way to see whether Offer held anyone without arriving there.
- Candidate detail stated the same facts repeatedly: consent appeared three times (page metadata, Recruitment readiness, Commercial snapshot), expected salary twice, and status in two places. Duplication is how two displays of one field come to disagree.
- The workspace name appeared in the sidebar brand and again in the topbar on the same screen, and table rows were padded for a density no one asked for.
- Single warm light theme only, despite a token system that made a second theme a palette exercise.

## Implementation

**Realtime.** `20260719020000_phase5_realtime_publication.sql` adds six operational tables to the `supabase_realtime` publication; `useRealtimeSync` subscribes once for the whole workspace in `AppShell`. The table→query mapping lives in `realtimeSync.ts` as plain data so it can be tested without a socket.

**Mobile phase jump.** `PhaseJump` scrolls the board rather than filtering it, so drag-and-drop between phases keeps working and "the board" means the same thing on every viewport. Counts are the point: they show where the work is without navigating there.

**Candidate detail.** The `Commercial snapshot` panel is deleted outright, `Recruitment readiness` becomes the single authoritative statement of consent / contactability / CV / availability / expected salary / pipeline count, and `Contact & availability` drops the fields readiness now owns.

**Density and shell.** Table rows lose ~25% vertical padding on desktop and keep the original height below 720px. The topbar stops repeating the workspace name above 1100px, where the sidebar already carries it.

**Dark theme.** A single `:root[data-theme='dark']` block overriding tokens already declared, applied from `theme.ts`.

## Decisions worth recording

- **Realtime never writes the payload into the cache.** An event is only a signal to refetch through the normal RLS-checked query path. Trusting a broadcast row would render data whose permission filtering happened somewhere other than the query owning that cache entry.
- **Realtime never invalidates during this tab's own mutation.** An optimistic kanban move fires an RPC whose change comes straight back down the channel; invalidating on it would refetch mid-drag and undo the optimistic write. Events arriving during a mutation are deferred and replayed on settle, so a colleague's change during your drag is delayed rather than lost.
- **Only operational tables are published.** A publication entry streams that table's rows to every subscribed client, filtered by RLS. `candidates`, `candidate_private_details`, and `activities` stay off it: a stale candidate profile is not a collaboration problem, and broadcasting salary and contact rows to solve one would be a bad trade. Replica identity stays at default rather than `full`, since the old row is never needed.
- **Empty kanban columns keep their width.** The plan asked for a slim rail, but narrowing an empty column shrinks the drop target you drag the *first* candidate of a phase into — trading a real interaction for reclaimed pixels. They lose height instead.
- **Dark mode is keyed on an attribute, not `prefers-color-scheme`.** A media query would mean the dark palette existing twice — once for automatic, once for manual override — which is exactly the drift the token file was built to end. The usual cost is a flash of light before JS runs, normally solved with an inline `<script>`; this app's CSP is `script-src 'self'` with no `'unsafe-inline'`, so that script would simply be blocked. Applying it from the bundled entry costs nothing visible because the SPA renders an empty `#root` until JS boots.
- **The theme control cycles rather than opening a submenu**, avoiding a popover inside a popover for three states.

## Verification

- `realtimeSync.test.ts` (8) — every subscribed table maps to at least one query, untracked tables map to none, Today refreshes for every record type it is built from, and the table list cannot drift from the mapping.
- `theme.test.ts` (5) — explicit choice beats the OS, `system` follows it, and any unrecognised stored value falls back to `system` rather than leaving the page unthemed.
- Full suite: **134 tests across 22 files**, plus `typecheck` and `lint` (eslint + stylelint) clean.
- Measured in a running browser rather than reasoned about: at 1440px the topbar identity is hidden, rows are `9px 14px`, the jump control is hidden, and empty columns are 132px against 540px for filled ones. At 375px rows return to `12px 14px`, the jump control is a 42px-tall horizontal scroller, and the page does not scroll horizontally.
- Dark theme contrast measured across 13 token pairs: lowest **6.13:1**, all clearing WCAG AA and most clearing AAA.

## Known gaps

- **The realtime migration has not been executed anywhere.** As with Phase 4, the staging gate is the first place this SQL runs. `alter publication` is guarded by a `pg_publication_tables` check so a re-run cannot fail, but that guard itself is unverified.
- **Realtime is untested end-to-end.** The mapping is unit-tested; the socket behaviour — deferral during mutations, resubscribe-triggered refetch — is not, and could not be without two authenticated browser sessions.
- **The workspace name is absent below 520px.** A pre-existing rule hides the topbar identity there and the sidebar is off-canvas, so the name appears only when the nav drawer is opened. Left as-is rather than changed silently, since it is a deliberate space trade that predates this phase.
- **Charts are not re-themed.** Recharts series colours reference accent and bronze tokens, which do shift, but the grid and axis strokes were not audited against the dark canvas.
