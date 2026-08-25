import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
})

/* Workspace reference data: the same rows for every record in the workspace, changing on the order
 * of weeks (a consultant joins) rather than minutes.
 *
 * At the global 30s these were being refetched on essentially every list-to-detail navigation, and
 * because several detail pages block their first render on them, that refetch was on the critical
 * path -- the page waited on a roster it already had in memory and merely considered stale. Ten
 * minutes keeps them warm across a normal working session; anything that actually mutates them
 * already invalidates by key, so a real change still lands immediately rather than waiting this out.
 *
 * Set by key PREFIX, so every existing call site inherits it without edits and, more importantly,
 * without any of them being able to drift to a different staleness for the same data. The
 * organization id stays in the key at each call site -- these defaults change WHEN a key refetches,
 * never what the key is, so nothing here widens the cache's tenant scoping. */
queryClient.setQueryDefaults(['members'], { staleTime: 600_000 })
queryClient.setQueryDefaults(['companies'], { staleTime: 600_000 })
