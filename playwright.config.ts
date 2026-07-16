import { defineConfig,devices } from '@playwright/test'
const remoteBaseUrl=process.env.PLAYWRIGHT_BASE_URL
export default defineConfig({testDir:'./tests/e2e',use:{baseURL:remoteBaseUrl||'http://127.0.0.1:5174',trace:'retain-on-failure'},webServer:remoteBaseUrl?undefined:{command:'npm run preview -- --host 127.0.0.1 --port 5174 --configLoader runner',url:'http://127.0.0.1:5174/login',reuseExistingServer:true},projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}]})
