import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rls/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    passWithNoTests: false,
    // These tests share two seeded organizations across files (candidates, activities, role
    // permissions, saved views) with no per-file tenant isolation. Running files in parallel
    // (Vitest's default) lets one file's mutations bleed into another's assertions -- confirmed by
    // re-running seats-and-activity.test.ts and saved-views-and-bd.test.ts alone, which pass clean.
    fileParallelism: false,
  },
})

