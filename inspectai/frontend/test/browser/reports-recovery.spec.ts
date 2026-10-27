import { test, expect, type Page } from '@playwright/test'
async function signInFixture(page: Page) {
  const user = { id: 'report-user', tenantId: 'report-tenant', role: 'viewer', name: 'Demo Viewer', email: 'viewer@example.invalid', staffId: 'VIEW', capabilities: ['viewer'], primaryDepartmentId: 'dept' }
  const token = 'x.' + Buffer.from(JSON.stringify({ ...user, exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.x'
  await page.addInitScript(value => localStorage.setItem('inspectai-jwt', value), token)
  await page.route('**/api/**', async route => {
    const data = new URL(route.request().url()).pathname === '/api/auth/me' ? user : []
    await route.fulfill({ json: { data } })
  })
}
test('mocked API: report errors are explicit, exports blocked, retry recovers', async ({ page }) => {
  await signInFixture(page)
  let failing = true
  await page.route('**/api/reports/inspection-summary?*', async route => {
    await route.fulfill(failing ? { status: 500, json: { error: 'Synthetic report failure' } } : { json: { data: [], meta: { hasMore: false } } })
  })
  await page.goto('/reports')
  await expect(page.getByRole('alert')).toContainText('This report could not be loaded')
  await expect(page.getByText('No completed inspections in this period.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeDisabled()
  failing = false
  await page.getByRole('button', { name: 'Retry report' }).click()
  await expect(page.getByText('No completed inspections in this period.')).toBeVisible()
})
test('mocked API: phone reports load every page, exclude N/A from evaluated pass rate and export all defects', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInFixture(page)
  await page.route('**/api/reports/inspection-summary?*', route => route.fulfill({ json: { data: [
    { work_order_id: 'wo-report', wo_number: 'WO-REPORT', asset_name: 'Synthetic cabinet', location: 'Fictional depot', inspector_name: 'Synthetic Inspector', completed_at: '2026-10-26T12:00:00Z', wi_number: 'FORM-1', overall_result: 'pass', pass_count: '1', fail_count: '0', total_findings: '3' },
  ], meta: { hasMore: false } } }))
  await page.route('**/api/reports/wi-compliance?*', route => route.fulfill({ json: { data: [
    { id: 'form-1', wi_number: 'FORM-1', title: 'Synthetic form', revision: '1', status: 'active' },
    { id: 'form-2', wi_number: 'FORM-1', title: 'Synthetic form', revision: '2', status: 'draft' },
  ], meta: { hasMore: false } } }))
  const defects = Array.from({ length: 55 }, (_, i) => ({ item_description: `Synthetic question ${i + 1}`, category: 'Fictional demo', fail_count: '1', sample_notes: 'Synthetic evidence note' }))
  await page.route('**/api/reports/defect-analysis?*', route => {
    const first = new URL(route.request().url()).searchParams.get('page') === '1'
    return route.fulfill({ json: { data: first ? defects.slice(0, 50) : defects.slice(50), meta: { hasMore: first } } })
  })
  await page.goto('/reports')
  await expect(page.getByText('100%', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'WO-REPORT' })).toHaveAttribute('href', '/inspections/wo-report')
  await page.getByRole('button', { name: 'Form compliance', exact: true }).click()
  await expect(page.getByText('Revision 2', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'FORM-1', exact: true })).toHaveCount(2)
  await page.getByRole('button', { name: 'Defect analysis', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Synthetic question 55', exact: true })).toBeVisible()
  await expect(page.getByText('55', { exact: true })).toHaveCount(2)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(chunks).toString()).length).toBe(55)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/reports-phone.png', fullPage: true })
})
test('password recovery rejects an absent session and fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/reset-password')
  await expect(page.getByRole('alert')).toContainText('invalid or expired')
  await expect(page.getByRole('button', { name: 'Set password', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test('mocked Auth: recovery confirms password and recovers from provider failure', async ({ page }) => {
  const expires = Math.floor(Date.now() / 1000) + 3600
  const session = { access_token: 'x.' + Buffer.from(JSON.stringify({ sub: 'recovery-user', exp: expires })).toString('base64url') + '.x', refresh_token: 'synthetic-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user: { id: 'recovery-user', email: 'demo@example.invalid', aud: 'authenticated', app_metadata: {}, user_metadata: {} } }
  await page.addInitScript(value => localStorage.setItem('inspectai-auth', JSON.stringify(value)), session)
  await page.route('**/auth/v1/user', route => route.fulfill({ status: 400, json: { msg: 'Synthetic provider failure' } }))
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
