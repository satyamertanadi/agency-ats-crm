import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* Only the dependencies the application needs before it can render anything are named here. Anything
 * unnamed falls through to Rollup's own splitting, which is what keeps recharts, docx, papaparse,
 * read-excel-file and dnd-kit inside the route chunks that use them -- naming one of those would
 * promote it into the initial download, which is the opposite of the point.
 *
 * Two honest caveats, because "the main chunk got smaller" is easy to claim and easy to fake:
 *
 *  - Splitting vendor out of index does NOT reduce the bytes a first-time visitor downloads. They
 *    are the same bytes over more requests, which HTTP/2 handles fine but does not make free.
 *  - What it does buy is caching. App code changes on every deploy; React, the router, the query
 *    client and the Supabase SDK change a few times a year. Separating them means a routine deploy
 *    re-downloads ~140kB rather than ~690kB for everyone who has visited before.
 *
 * The genuine reduction in this release came from deferring Sentry (see shared/lib/observability),
 * which removed ~86kB raw / ~29kB gzip from the initial chunk in a production build -- measured with
 * a DSN configured, because without one the SDK is tree-shaken and the saving is invisible locally.
 */
const BOOT_VENDORS:[RegExp,string][]=[
  // react-dom pulls scheduler; keeping them together avoids a chunk that is one module deep.
  [/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,'react-vendor'],
  [/[\\/]node_modules[\\/]react-router[\\/]/,'react-vendor'],
  // The session and every query on the first authenticated paint go through these two.
  [/[\\/]node_modules[\\/](@supabase|@tanstack)[\\/]/,'data-vendor'],
  /* Zod is boot-critical only because OrganizationProvider validates the membership payload through
   * it before the shell can render. Worth its own chunk rather than folding into data-vendor: it is
   * the one here that could plausibly be removed from the boot path later, and a separate chunk makes
   * that visible in the build output rather than hidden inside a bundle. */
  [/[\\/]node_modules[\\/]zod[\\/]/,'schema-vendor'],
]

export default defineConfig({
  plugins: [react()],
  build: {
    /* Left at Vite's default 500. It had been raised to 650 to accommodate an initial chunk that was
       over it; a threshold moved to match whatever the bundle happens to weigh is not a threshold. */
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          /* Sentry is deliberately absent: it is reached through a dynamic import so that a workspace
             with no DSN never downloads it at all, and naming it here would pull it back into a
             statically-known chunk. */
          for (const [pattern, chunk] of BOOT_VENDORS) if (pattern.test(id)) return chunk
          return
        },
      },
    },
  },
})
