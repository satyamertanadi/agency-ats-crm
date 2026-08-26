# Release 3 — bundle evidence

All figures from `npm run build` on this machine. Two sets, because they differ and only one of them
resembles production.

## Why there are two sets

`env.sentryDsn` resolves from `import.meta.env.VITE_SENTRY_DSN`, which Vite inlines at build time.
Without a DSN the value folds to `''`, the `if (!env.sentryDsn) return` guard becomes statically
false, and the Sentry SDK is tree-shaken out of the bundle entirely.

So a local build with no DSN cannot see the Sentry problem **or** the improvement. Production sets
the DSN. The "with DSN" figures below are the ones that describe what a user actually downloads, and
they are the ones the deferral is measured against.

## With a DSN configured — production-representative

| | Before (`c0f2e39`) | After | Change |
|---|---|---|---|
| **Initial download, raw** | 775.69 kB | 688.56 kB | **−87.13 kB** |
| **Initial download, gzip** | 226.24 kB | 198.11 kB | **−28.13 kB** |
| Largest single chunk | 775.69 kB | 247.63 kB | −528.06 kB |
| Over Vite's 500 kB warning | yes | no | — |

After, the initial download is four chunks rather than one:

| Chunk | Raw | Gzip |
|---|---|---|
| `index` (application code) | 140.13 kB | 40.19 kB |
| `react-vendor` | 229.62 kB | 73.61 kB |
| `data-vendor` (Supabase, TanStack Query) | 247.63 kB | 65.32 kB |
| `schema-vendor` (Zod) | 71.18 kB | 18.99 kB |
| **Total** | **688.56 kB** | **198.11 kB** |

Deferred, no longer in the initial download:

| Chunk | Raw | Gzip | When it loads |
|---|---|---|---|
| Sentry | 481.07 kB | 159.52 kB | Only when a DSN is configured |
| `ScorecardPage` (recharts) | 392.56 kB | 114.61 kB | Scorecard route only |
| `candidateProfileDocx` | 370.53 kB | 106.41 kB | Profile export only |

## Without a DSN — this machine's default

| | Before | After |
|---|---|---|
| Initial raw | 687.92 kB | 687.49 kB |
| Initial gzip | 196.69 kB | 197.63 kB |
| Largest chunk | 687.92 kB | 247.63 kB |
| Warning threshold | 650 (raised) | 500 (default) |

Unchanged in total, as expected: with no DSN there was no Sentry to remove. The split is still
visible in the largest-chunk figure and in the warning threshold going back to Vite's default.

## What was and was not achieved

**Achieved**

- Main initial chunk below the 500 kB warning threshold: the largest chunk is now 247.63 kB, and
  `chunkSizeWarningLimit` is back at Vite's default 500 rather than the 650 it had been raised to.
- A real reduction of 87 kB raw / 28 kB gzip in production, from deferring Sentry.
- Unrelated routes do not fetch the Scorecard bundle, `candidateProfileDocx`, or Sentry. Asserted by
  `tests/e2e/bundle-contract.spec.ts` against the real production build.
- No new console errors or unhandled rejections on first load, asserted by the same suite.

**Not achieved**

- The ~160 kB initial gzip target. The result is **198.11 kB**, about 38 kB above it.

  What remains is React and React-DOM (73.61 kB gzip), the Supabase SDK with TanStack Query
  (65.32 kB), Zod (18.99 kB) and 40.19 kB of application code. None of that is waste; reaching 160 kB
  means removing one of those from the boot path, not trimming around the edges.

  The identified next lever is Zod, which is boot-critical only because `OrganizationProvider`
  validates the membership payload through it before the shell renders. It is 18.99 kB gzip and it is
  given its own chunk specifically so that this is visible in the build output rather than buried.
  Moving that validation would be a behavioural change to the boot path and is out of scope for a
  polish release.

## An honest note on the split

Splitting vendor out of `index` does not reduce what a first-time visitor downloads — the same bytes
arrive over more requests. What it buys is caching: application code changes on every deploy, while
React, the router, the query client and the Supabase SDK change a few times a year, so a routine
deploy re-downloads roughly 140 kB rather than 690 kB for anyone who has visited before.

The genuine reduction in this release is the Sentry deferral. The split is a caching improvement and
the reason every chunk is now under the warning threshold; it is not a byte saving and is not
presented as one.
