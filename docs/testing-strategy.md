# Testing strategy

Unit tests cover schemas, fee calculations, duplicate normalization, and permission contracts. Component tests cover accessible forms and workflow states. RLS integration tests use two organizations and known foreign UUIDs. Playwright covers the end-to-end agency workflow and responsive smoke checks.

CI must run lint, strict type checking, unit tests, local Supabase reset, non-skipping RLS tests, production build, and Chromium E2E. Vitest and Playwright have disjoint include patterns.

