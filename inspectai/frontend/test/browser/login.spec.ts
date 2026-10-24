import { test, expect } from '@playwright/test'
test('production bundle renders login, rejects invalid login, and guards protected pages', async ({ page }) => {
 await page.route('**/api/auth/login', route => route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Invalid email or password'})}))
 await page.goto('/inspections')
 await expect(page).toHaveURL(/\/login$/)
 await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
 await expect(page.getByText('Demo credentials')).toHaveCount(0)
 await page.getByPlaceholder('you@company.com').fill('invalid@example.com')
 await page.locator('input[type=password]').fill('incorrect-password')
 await page.getByRole('button', { name: 'Sign in', exact: true }).click()
 await expect(page.getByText('Invalid email or password')).toBeVisible()
})
test('login fits a small viewport without horizontal document overflow', async ({ page }) => {
 await page.setViewportSize({width:390,height:844})
 await page.goto('/login')
 await expect(page.getByRole('button', { name:'Sign in', exact:true })).toBeVisible()
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
