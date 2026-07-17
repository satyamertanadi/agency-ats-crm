import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 650 },
  // @vercel/analytics and @vercel/speed-insights try to auto-detect their environment by reading
  // process.env.NODE_ENV, which Vite never polyfills into the browser bundle -- so that check always
  // throws, is swallowed, and falls through to "production" regardless of where the app is actually
  // running. The two script tags they inject 404 identically on `vite dev`, `vite preview`, and any
  // non-Vercel host; only real Vercel deployments can serve /_vercel/insights/script.js at all.
  // VERCEL=1 is a Node-side env var Vercel's own build system sets automatically (no dashboard config
  // to forget) -- baked in here so main.tsx can render these components only when it's genuinely true.
  define: { __VERCEL_DEPLOYMENT__: JSON.stringify(process.env.VERCEL === '1') },
})
