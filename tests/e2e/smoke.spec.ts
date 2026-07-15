import {expect,test} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('production login is invitation-only Google and keyboard reachable',async({page})=>{
  await page.goto('/login?next=%2Fapp')
  await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible()
  const google=page.getByRole('button',{name:'Continue with Google'})
  await expect(google).toBeVisible()
  await expect(page.getByText('Access requires an active invitation or membership.')).toBeVisible()
  await expect(page.getByLabel('Email')).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(google).toBeFocused()
})

test('self-service signup is not exposed',async({page})=>{
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible()
})

// This suite runs against `npm run preview` -- a production build -- so it is the real assertion
// that the dev-only design system specimen never ships. import.meta.env.DEV folds to false and
// Rollup drops the chunk, leaving the `*` catch-all to redirect to /login.
test('the design system styleguide is not reachable in production',async({page})=>{
  await page.goto('/styleguide')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator('.sg-masthead')).toHaveCount(0)
})

test('invalid public review fails without revealing candidate data',async({page})=>{
  await page.route('**/functions/v1/public-review**',async(route)=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:{message:'This review link is unavailable.'}})}))
  await page.goto(`/review/${'invalid-token-value-that-is-long-enough-000'}`)
  await expect(page.getByRole('heading',{name:'Could not load this view'})).toBeVisible()
  await expect(page.locator('.review-card')).toHaveCount(0)
})

test('login layout fits the viewport',async({page})=>{
  await page.goto('/login')
  const dimensions=await page.evaluate(()=>({body:document.body.scrollWidth,viewport:window.innerWidth}))
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport)
})

test('login has no automatically detectable accessibility violations',async({page})=>{
  await page.goto('/login')
  const results=await new AxeBuilder({page}).analyze()
  expect(results.violations).toEqual([])
})

for(const viewport of [{name:'executive-desktop',width:1440,height:900},{name:'compact-desktop',width:1280,height:800},{name:'mobile',width:390,height:844}]){
  test(`login visual contract at ${viewport.name}`,async({page})=>{
    await page.setViewportSize({width:viewport.width,height:viewport.height})
    await page.goto('/login')
    await expect(page.locator('.auth-page')).toBeVisible()
    await expect(page).toHaveScreenshot(`login-${viewport.name}.png`,{fullPage:true,animations:'disabled'})
  })
}
