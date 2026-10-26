import { test, expect } from '@playwright/test'
import fs from 'node:fs'
test.use({ trace: 'off' })

test('hosted Auth login, validated reload, signed inspection and logout', async ({ page }) => {
  test.skip(
    process.env.VERIFY_LIVE_STAGING !== 'true',
    'Explicit opt-in: dedicated staging accounts and running local backend required',
  )
  test.setTimeout(90_000)
  const fixture = JSON.parse(fs.readFileSync('../backend/.env.staging-test-users.json', 'utf8'))
  const user = fixture.users.inspector
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 500)
      failures.push(`${response.status()} ${new URL(response.url()).pathname}`)
  })
  await page.goto('http://127.0.0.1:3000/inspections')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByPlaceholder('you@company.com').fill(user.email)
  await page.locator('input[type=password]').fill(user.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/inspections$/, { timeout: 30_000 })
  const restored = page.waitForResponse((response) => response.url().endsWith('/api/auth/me'))
  await page.reload()
  expect((await restored).status()).toBe(200)
  await expect(page).toHaveURL(/\/inspections$/)
  await page.goto('http://127.0.0.1:3000/inspections/' + fixture.lastVerification.workOrderId)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Synthetic staging verification asset', exact: true }),
  ).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => {
    localStorage.removeItem('inspectai-jwt')
    window.dispatchEvent(new Event('session-expired'))
  })
  await expect(page).toHaveURL(/\/login$/)
  const fake =
    'x.' +
    Buffer.from(
      JSON.stringify({ id: user.id, role: 'admin', exp: Date.now() / 1000 + 3600 }),
    ).toString('base64url') +
    '.x'
  await page.evaluate((token) => localStorage.setItem('inspectai-jwt', token), fake)
  await page.goto('http://127.0.0.1:3000/approvals')
  await expect(page).toHaveURL(/\/login$/)
  expect(failures).toEqual([])
})
