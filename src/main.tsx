import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { queryClient } from './shared/lib/queryClient'
import { AuthProvider } from './app/AuthProvider'
import { OrganizationProvider } from './app/OrganizationProvider'
import { App } from './app/App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import { ToastProvider } from './shared/ui/Toast'
import { initializeObservability } from './shared/lib/observability'
import '@fontsource-variable/manrope'
import '@fontsource-variable/newsreader'
import './styles.css'

initializeObservability()
// __VERCEL_DEPLOYMENT__ (see vite.config.ts): these two only work when Vercel's own platform is
// actually serving the app -- rendering them unconditionally 404s on every local run and every CI
// preview, since /_vercel/insights/* and /_vercel/speed-insights/* aren't real app routes.
createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><QueryClientProvider client={queryClient}><BrowserRouter><ToastProvider><AuthProvider><OrganizationProvider><App/></OrganizationProvider></AuthProvider></ToastProvider></BrowserRouter></QueryClientProvider></AppErrorBoundary>{__VERCEL_DEPLOYMENT__&&<Analytics/>}{__VERCEL_DEPLOYMENT__&&<SpeedInsights/>}</StrictMode>)
