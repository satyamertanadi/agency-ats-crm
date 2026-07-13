const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const env = {
  productName: import.meta.env.VITE_PRODUCT_NAME?.trim() || 'Agency ATS CRM',
  supabaseUrl: supabaseUrl || 'http://127.0.0.1:54321',
  supabaseAnonKey: supabaseAnonKey || 'missing-local-anon-key',
  isConfigured: Boolean(supabaseUrl && supabaseAnonKey),
}

