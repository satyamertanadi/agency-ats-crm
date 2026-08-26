import {expect,test} from '@playwright/test'

/* What the initial page load is allowed to fetch.
 *
 * The Scorecard route carries recharts -- 392kB on its own, larger than the entire application shell
 * -- and the whole reason it is a lazy route is that nobody visiting any other screen should pay for
 * it. That is easy to state and easy to break: one eager import of a chart helper from a shared
 * module and it silently rejoins the initial download, with nothing failing.
 *
 * Asserted against the real production build the preview server serves, because this is a property
 * of the bundle rather than of the source.
 */
const chunkNames=(urls:string[])=>urls.map((url)=>url.split('/').pop()||'')

test('the first paint does not download the scorecard or its charting library',async({page})=>{
  const scripts:string[]=[]
  page.on('request',(request)=>{if(request.resourceType()==='script')scripts.push(request.url())})
  await page.goto('/login')
  await page.waitForLoadState('networkidle')

  const names=chunkNames(scripts)
  expect(names.length,'the page should have loaded some scripts').toBeGreaterThan(0)
  expect(names.filter((name)=>name.startsWith('ScorecardPage')),`scorecard chunk was fetched: ${names.join(', ')}`).toEqual([])
  // The DOCX generator is the other heavyweight that belongs to one screen only.
  expect(names.filter((name)=>name.startsWith('candidateProfileDocx'))).toEqual([])
})

/* Sentry is reached through a dynamic import so a workspace with no DSN never downloads it. The
 * preview build has no DSN configured, so the correct number of requests for it is zero. */
test('error reporting is not downloaded when it is not configured',async({page})=>{
  const scripts:string[]=[]
  page.on('request',(request)=>{if(request.resourceType()==='script')scripts.push(request.url())})
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  const bodies=await Promise.all(scripts.map(async(url)=>{
    const response=await page.request.get(url)
    return response.ok()?await response.text():''
  }))
  expect(bodies.some((body)=>body.includes('sentry.io')||body.includes('@sentry/')),
    'the Sentry SDK reached a build with no DSN configured').toBe(false)
})

/* A clean console is part of the acceptance criteria, and it is the kind of thing that rots quietly.
 * Failed favicon/network noise is filtered; genuine application errors are not. */
test('the initial load raises no console errors or unhandled rejections',async({page})=>{
  const problems:string[]=[]
  page.on('console',(message)=>{if(message.type()==='error')problems.push(`console: ${message.text()}`)})
  page.on('pageerror',(error)=>{problems.push(`pageerror: ${error.message}`)})
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  const real=problems.filter((problem)=>!/favicon|net::ERR_|Failed to load resource/i.test(problem))
  expect(real,`unexpected console output: ${real.join(' | ')}`).toEqual([])
})
