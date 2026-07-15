const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const env = {
  productName: import.meta.env.VITE_PRODUCT_NAME?.trim() || 'Agency ATS CRM',
  supabaseUrl: supabaseUrl || 'http://127.0.0.1:55321',
  supabaseAnonKey: supabaseAnonKey || 'missing-local-anon-key',
  isConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  // Password auth is a local-development affordance only. Google is the production identity
  // provider, so this is gated on DEV as well as the flag: a production bundle cannot enable it.
  allowPasswordAuth: import.meta.env.DEV && import.meta.env.VITE_ALLOW_PASSWORD_AUTH === 'true',
  allowSelfServiceOnboarding: import.meta.env.VITE_ALLOW_SELF_SERVICE_ONBOARDING === 'true',
  sentryDsn: import.meta.env.VITE_SENTRY_DSN?.trim() || '',
  sentryTracesSampleRate: Math.max(0,Math.min(1,Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE||0))),
  enableSentryReplay: import.meta.env.VITE_ENABLE_SENTRY_REPLAY === 'true',
}
