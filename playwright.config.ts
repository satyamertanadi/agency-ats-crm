import { defineConfig,devices } from '@playwright/test'
const remoteBaseUrl=process.env.PLAYWRIGHT_BASE_URL
/* Remote runs (staging-gate, browser-gate, the post-promotion smoke) hit real Vercel deployments,
 * which sit behind Vercel's own Deployment Protection wall -- without this header every request
 * there redirects to vercel.com/sso-api instead of the app, so nothing the tests look for ever
 * renders. Local runs hit the Vite preview server directly and have no such wall, so this only
 * applies when a remote base URL is actually in play.
 * https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation */
const bypassSecret=process.env.VERCEL_AUTOMATION_BYPASS_SECRET
if(remoteBaseUrl&&!bypassSecret)throw new Error('VERCEL_AUTOMATION_BYPASS_SECRET is required to run e2e tests against a deployed URL -- otherwise every request hits Vercel\'s protection wall instead of the app.')
export default defineConfig({testDir:'./tests/e2e',use:{baseURL:remoteBaseUrl||'http://127.0.0.1:5174',trace:'retain-on-failure',...(remoteBaseUrl?{extraHTTPHeaders:{'x-vercel-protection-bypass':bypassSecret!,'x-vercel-set-bypass-cookie':'true'}}:{})},webServer:remoteBaseUrl?undefined:{command:'npm run preview -- --host 127.0.0.1 --port 5174 --configLoader runner',url:'http://127.0.0.1:5174/login',reuseExistingServer:true},projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}]})
