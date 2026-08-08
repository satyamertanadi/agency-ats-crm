import {expect,test} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'

const enabled=process.env.RUN_AUTHENTICATED_GOLDEN_PATH==='true'
test.skip(!enabled,'Authenticated production gate runs only with its dedicated synthetic consultant account.')

test('@authenticated consultant can open the daily delivery workspace',async({page})=>{
  const url=process.env.PRODUCTION_SUPABASE_URL
  const anonKey=process.env.PRODUCTION_SUPABASE_ANON_KEY
  const serviceRoleKey=process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY
  const email=process.env.PRODUCTION_E2E_CONSULTANT_EMAIL
  if(!url||!anonKey||!serviceRoleKey||!email)throw new Error('The authenticated production gate requires the Supabase URL, anon key, server-only key, and dedicated E2E consultant email.')

  const admin=createClient(url,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const auth=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const generated=await admin.auth.admin.generateLink({type:'magiclink',email})
  if(generated.error)throw generated.error
  const tokenHash=generated.data.properties?.hashed_token
  if(!tokenHash)throw new Error('The synthetic consultant did not receive a one-time token.')
  const signedIn=await auth.auth.verifyOtp({token_hash:tokenHash,type:'email'})
  if(signedIn.error||!signedIn.data.session)throw signedIn.error||new Error('The synthetic consultant did not receive a session.')
  const projectRef=new URL(url).hostname.split('.')[0]
  await page.addInitScript(({storageKey,session})=>localStorage.setItem(storageKey,JSON.stringify(session)),{
    storageKey:`sb-${projectRef}-auth-token`,session:signedIn.data.session,
  })

  const consoleErrors:string[]=[]
  const failedApiResponses:string[]=[]
  page.on('console',(message)=>{if(message.type()==='error')consoleErrors.push(message.text())})
  page.on('response',(response)=>{
    if(response.status()>=500&&response.url().includes('/rest/v1/'))failedApiResponses.push(`${response.status()} ${response.url()}`)
  })

  await page.goto('/app')
  await expect(page).toHaveURL(/\/app\/[^/]+\/today$/)
  await expect(page.getByRole('heading',{name:'Today'})).toBeVisible()
  const primaryNavigation=page.getByRole('navigation',{name:'Primary navigation'})
  await expect(primaryNavigation).toContainText('Jobs')
  await primaryNavigation.getByRole('link',{name:'Jobs',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Jobs'})).toBeVisible()
  await primaryNavigation.getByRole('link',{name:'Candidates',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Candidates'})).toBeVisible()
  await primaryNavigation.getByRole('link',{name:'Clients',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Clients'})).toBeVisible()

  expect(failedApiResponses).toEqual([])
  expect(consoleErrors).toEqual([])
})
