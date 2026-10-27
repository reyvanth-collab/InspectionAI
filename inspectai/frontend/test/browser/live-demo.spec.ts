import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
test.use({ trace: 'off' })
const live = process.env.VERIFY_LIVE_DEMO === 'true'
const load = () => JSON.parse(fs.readFileSync('../backend/.env.rail-demo.json', 'utf8'))
async function login(page: Page, persona: string) {
  const user = load().personas[persona]
  await page.goto('http://127.0.0.1:3000/login')
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toHaveCount(0, {
    timeout: 30000,
  })
  return user
}
test('live staging: departmental author and independent reviewer landing pages', async ({
  page,
}) => {
  test.skip(!live, 'Explicit opt-in: provisioned fictional demo tenant required')
  test.setTimeout(120000)
  await login(page, 'RS-author')
  await expect(page).toHaveURL(/\/library\?status=draft/)
  await expect(page.getByRole('button', { name: 'Create form', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    localStorage.removeItem('inspectai-jwt')
    window.dispatchEvent(new Event('session-expired'))
  })
  await login(page, 'RS-reviewer')
  await expect(page).toHaveURL(/\/library\?needsApproval=true/)
  await expect(page.getByRole('button', { name: 'Create form', exact: true })).toHaveCount(0)
  await page
    .getByRole('row')
    .filter({ hasText: /SYNTHETIC DEMO — Saloon equipment/ })
    .getByRole('link')
    .click()
  await page.getByRole('tab', { name: 'Approval & comments' }).click()
  await expect(page.getByRole('button', { name: 'Approve form', exact: true })).toBeVisible({
    timeout: 30000,
  })
  await expect(
    page.getByRole('button', { name: 'Reject with comment', exact: true }),
  ).toBeDisabled()
})
test('live staging: phone checklist, persisted evidence, review and authenticated signing', async ({
  page,
}) => {
  test.skip(!live, 'Explicit opt-in: dedicated synthetic inspection only')
  test.setTimeout(240000)
  await page.setViewportSize({ width: 390, height: 844 })
  const user = await login(page, 'RS-inspector')
  await expect(page).toHaveURL(/\/inspections$/)
  const recordLoaded = page.waitForResponse(
    (r) => /\/inspections\/[^/]+\/record$/.test(r.url()) && r.request().method() === 'GET',
  )
  await page.getByRole('link', { name: /WO-0001\b/ }).click()
  await recordLoaded
  await expect(
    page
      .getByRole('heading', { name: 'Signed inspection', exact: true })
      .or(page.getByRole('button', { name: 'Start inspection', exact: true }))
      .or(page.getByRole('region', { name: 'Question 1', exact: true })),
  ).toBeVisible({ timeout: 30000 })
  if (await page.getByRole('heading', { name: 'Signed inspection', exact: true }).count()) {
    await expect(page.getByText('Recorded result: FAIL', { exact: false }).first()).toBeVisible()
    return
  }
  const start = page.getByRole('button', { name: 'Start inspection', exact: true })
  if (await start.count()) await start.click()
  await expect(page.getByRole('region', { name: 'Question 1', exact: true })).toBeVisible({
    timeout: 30000,
  })
  for (let number = 1; number <= 9; number++) {
    const card = page.getByRole('region', { name: `Question ${number}`, exact: true })
    if (number === 2) await card.getByLabel('Response', { exact: true }).selectOption('Yes')
    if (number === 6)
      await card
        .getByLabel('Response', { exact: true })
        .fill('Synthetic browser observation; this is not an operational assessment.')
    if (number === 7) await card.getByLabel('Response', { exact: true }).fill('42')
    if (number === 8)
      await card.getByLabel('Response', { exact: true }).selectOption('Synthetic normal condition')
    if (number === 9) await card.getByLabel('Response', { exact: true }).fill('2026-10-25')
    await card
      .getByRole('button', {
        name: number === 3 ? '× Fail' : number === 5 ? 'N/A' : '✓ Pass',
        exact: true,
      })
      .click()
    if (number === 3) {
      await card
        .getByLabel('Notes', { exact: true })
        .fill('Synthetic damaged cover for browser verification.')
      await card.getByLabel('Photo evidence', { exact: true }).setInputFiles({
        name: 'synthetic.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYZkAAAAASUVORK5CYII=',
          'base64',
        ),
      })
      await expect(card.getByText('Photo pending save')).toBeVisible()
    }
    if (number === 5)
      await card
        .getByLabel('N/A reason', { exact: true })
        .fill('The fictional training scenario does not include this observation.')
  }
  await page.getByRole('button', { name: 'Review & sign', exact: true }).click()
  await page.getByRole('button', { name: 'Save & review', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Failed items', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to signature' })).toBeEnabled()
  await page.getByRole('button', { name: 'Continue to signature' }).click()
  await page.getByLabel('Type your signature').fill('Synthetic demo inspector')
  await page.getByRole('button', { name: 'Apply Signature', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Signed inspection', exact: true })).toBeVisible({
    timeout: 45000,
  })
  const saved = await page.evaluate(async () => {
    const r = await fetch('/api' + location.pathname + '/record', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('inspectai-jwt') },
    })
    const { data } = await r.json()
    return {
      signer: data.signed_by,
      result: data.overall_result,
      items: data.signed_payload.items.map(
        (i: {
          item_no: string
          result: string | null
          captured_value: string
          photo_urls: string[]
        }) => ({
          number: i.item_no,
          result: i.result,
          value: i.captured_value,
          photos: i.photo_urls?.length || 0,
        }),
      ),
    }
  })
  expect(saved.signer).toBe(user.id)
  expect(saved.result).toBe('fail')
  expect(saved.items.find((i: { number: string }) => i.number === '7').value).toBe('42')
  expect(saved.items.find((i: { number: string }) => i.number === '3').photos).toBe(1)
  expect(saved.items.find((i: { number: string }) => i.number === '10').result).toBeNull()
})
