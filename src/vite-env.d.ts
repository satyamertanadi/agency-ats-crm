/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRODUCT_NAME?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_ALLOW_PASSWORD_AUTH?: string
  readonly VITE_ALLOW_SELF_SERVICE_ONBOARDING?: string
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string
  readonly VITE_ENABLE_SENTRY_REPLAY?: string
}
