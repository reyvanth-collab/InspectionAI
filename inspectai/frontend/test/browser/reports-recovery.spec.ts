import { test, expect } from '@playwright/test'
import { policyFixture } from './support/policy-fixture'
test('report catalogue opens named reports, handles failure and blocks exports until retry succeeds', async ({
  page,
}) => {
  const state = await policyFixture(page)
  state.failReport = true
  await page.goto('/reports')
  await expect(page.getByRole('button', { name: /^Run / })).toHaveCount(6)
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.getByRole('button', { name: 'Run Frequently failing assets', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('This report could not be loaded')
  await expect(page.getByRole('button', { name: 'Export filtered CSV' })).toBeDisabled()
  state.failReport = false
  await page.getByRole('button', { name: 'Retry report', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Frequently failing assets' })).toBeVisible()
})
test('phone reports show denominators, drill down and export the full filtered report', async ({
  page,
}) => {
  await policyFixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/reports')
  await page.getByRole('button', { name: 'Run Frequently failing assets', exact: true }).click()
  await expect(page.getByRole('cell', { name: '66.67', exact: true })).toBeVisible()
  await expect(
    page.getByText('N/A and informational answers are excluded from assessment rates.'),
  ).toBeVisible()
  await page.getByText('Open supporting records', { exact: true }).click()
  await expect(page.getByRole('link', { name: /WO-POLICY/ })).toHaveAttribute(
    'href',
    '/inspections/wo-policy',
  )
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export filtered CSV' }).click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString()).toContain('SYN-2,1')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/report-catalogue-phone.png', fullPage: true })
})

test('password recovery rejects an absent session and fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/reset-password')
  await expect(page.getByRole('alert')).toContainText('invalid or expired')
  await expect(page.getByRole('button', { name: 'Set password', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test('mocked Auth: recovery confirms password and recovers from provider failure', async ({
  page,
}) => {
  const expires = Math.floor(Date.now() / 1000) + 3600
  const session = {
    access_token:
      'x.' +
      Buffer.from(JSON.stringify({ sub: 'recovery-user', exp: expires })).toString('base64url') +
      '.x',
    refresh_token: 'synthetic-refresh',
    expires_at: expires,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'recovery-user',
      email: 'demo@example.invalid',
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
    },
  }
  await page.addInitScript(
    (value) => localStorage.setItem('inspectai-auth', JSON.stringify(value)),
    session,
  )
  await page.route('**/auth/v1/user', (route) =>
    route.fulfill({ status: 400, json: { msg: 'Synthetic provider failure' } }),
  )
  await page.goto('/reset-password')
  await page.getByLabel('New password', { exact: true }).fill('Synthetic-long-password-1')
  await page.getByLabel('Confirm new password', { exact: true }).fill('Synthetic-long-password-2')
  await page.getByRole('button', { name: 'Set password', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('The passwords do not match.')
  await page.getByLabel('Confirm new password', { exact: true }).fill('Synthetic-long-password-1')
  await page.getByRole('button', { name: 'Set password', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The password could not be updated')
  await expect(page.getByRole('button', { name: 'Set password', exact: true })).toBeEnabled()
})
