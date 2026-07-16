import {expect,test} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('consultant-first shell entry renders without runtime errors',async({page})=>{
  const consoleErrors:string[]=[]
  page.on('console',(message)=>{if(message.type()==='error')consoleErrors.push(message.text())})
  await page.goto('/app/example/today')
  await expect(page).toHaveURL(/\/login\?next=/)
  await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible()
  await expect(page.locator('.vite-error-overlay, #webpack-dev-server-client-overlay')).toHaveCount(0)
  expect((await page.locator('body').innerText()).trim().length).toBeGreaterThan(0)
  expect(consoleErrors).toEqual([])
})

test('entry experience fits mobile and passes automated accessibility checks',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  await page.goto('/login')
  const dimensions=await page.evaluate(()=>({body:document.body.scrollWidth,viewport:window.innerWidth}))
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport)
  const results=await new AxeBuilder({page}).analyze()
  expect(results.violations).toEqual([])
})
