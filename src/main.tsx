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
import { initializeObservability } from './shared/lib/observability'
import '@fontsource-variable/manrope'
import '@fontsource-variable/newsreader'
import './styles.css'

initializeObservability()
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><AuthProvider><OrganizationProvider><App/></OrganizationProvider></AuthProvider></BrowserRouter></QueryClientProvider><Analytics/><SpeedInsights/></StrictMode>)
