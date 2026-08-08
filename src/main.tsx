import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './shared/lib/queryClient'
import { AuthProvider } from './app/AuthProvider'
import { OrganizationProvider } from './app/OrganizationProvider'
import { App } from './app/App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import { ToastProvider } from './shared/ui/Toast'
import { initializeObservability } from './shared/lib/observability'
import { initializeTheme } from './shared/lib/theme'
import '@fontsource-variable/manrope'
import '@fontsource-variable/newsreader'
import './styles.css'

initializeObservability()
initializeTheme()
createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><QueryClientProvider client={queryClient}><BrowserRouter><ToastProvider><AuthProvider><OrganizationProvider><App/></OrganizationProvider></AuthProvider></ToastProvider></BrowserRouter></QueryClientProvider></AppErrorBoundary></StrictMode>)
