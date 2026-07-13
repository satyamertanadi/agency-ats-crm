import { expect,test } from '@playwright/test'
test('login surface is responsive and usable',async({page})=>{await page.goto('/login');await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();await expect(page.getByLabel('Email')).toBeEditable();await expect(page.getByRole('button',{name:'Sign in'})).toBeVisible()})
