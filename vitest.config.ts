import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.ts'],
    exclude: ['tests/rls/**', 'tests/staging/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
