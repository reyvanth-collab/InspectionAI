import { test, expect } from '@playwright/test'
import fs from 'node:fs'
test.use({ trace: 'off' })
test('live synthetic tenant: incomplete drafts, concurrent conflict, single review and signed PDF', async ({
  page,
  context,
}) => {
  test.skip(
    process.env.VERIFY_LIVE_DRAFT_REPORT !== 'true',
    'Explicit opt-in; creates one isolated synthetic acceptance work order',
  )
  test.setTimeout(240000)
  const credentials = JSON.parse(fs.readFileSync('../backend/.env.rail-demo.json', 'utf8')).personas
    .admin
  await page.goto('http://127.0.0.1:3000/login')
  await page.getByLabel('Email', { exact: true }).fill(credentials.email)
  await page.getByLabel('Password', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Current workspace' })).toContainText(
    'Synthetic rail demonstration — not operational',
    { timeout: 30000 },
  )
  const fixturePath = '../backend/.env.live-draft-report.json'
  let fixture: { id: string }
  if (fs.existsSync(fixturePath)) fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  else {
    fixture = await page.evaluate(async () => {
      const request = async (path: string, body?: unknown) => {
        const r = await fetch('/api' + path, {
          method: body ? 'POST' : 'GET',
          headers: {
            Authorization: 'Bearer ' + localStorage.getItem('inspectai-jwt'),
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        })
        if (!r.ok) throw new Error('Acceptance setup failed')
        return (await r.json()).data
      }
      const assets = await request('/assets?search=DEMO-RS-001'),
        forms = await request('/work-instructions?status=active&search=DEMO-RS-F1')
      return request('/inspections', {
        assetId: assets[0].id,
        workInstructionId: forms[0].id,
        notes: 'SYNTHETIC tables, drafts and PDF owner acceptance',
        priority: 'low',
      })
    })
    fs.writeFileSync(fixturePath, JSON.stringify({ id: fixture.id }, null, 2))
  }
  await page.goto('http://127.0.0.1:3000/inspections/' + fixture.id)
  await expect(
    page
      .getByRole('heading', { name: 'Signed inspection', exact: true })
      .or(page.getByRole('button', { name: 'Start inspection', exact: true }))
      .or(page.getByRole('region', { name: 'Question 1', exact: true }))
      .first(),
  ).toBeVisible({ timeout: 30000 })
  if (!(await page.getByRole('heading', { name: 'Signed inspection', exact: true }).count())) {
    if (await page.getByRole('button', { name: 'Start inspection', exact: true }).count())
      await page.getByRole('button', { name: 'Start inspection', exact: true }).click()
    const text = page
      .getByRole('region', { name: 'Question 6', exact: true })
      .getByLabel('Response', { exact: true })
    await text.fill('Incomplete synthetic observation')
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 30000 })
    await page.reload()
    await expect(text).toHaveValue('Incomplete synthetic observation', { timeout: 30000 })
    await expect(
      page
        .getByRole('region', { name: 'Question 6', exact: true })
        .getByRole('button', { name: /Pass$/ }),
    ).toHaveAttribute('aria-pressed', 'false')
    const other = await context.newPage()
    await other.goto(page.url())
    const otherText = other
      .getByRole('region', { name: 'Question 6', exact: true })
      .getByLabel('Response', { exact: true })
    await expect(otherText).toHaveValue('Incomplete synthetic observation', { timeout: 30000 })
    await text.fill('Latest synthetic observation from first tab')
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 30000 })
    await otherText.fill('Stale second tab edit')
    await expect(other.getByRole('alert')).toContainText('another tab', { timeout: 30000 })
    other.once('dialog', (d) => d.accept())
    await other.getByRole('button', { name: 'Reload latest draft (discard local edits)' }).click()
    await expect(otherText).toHaveValue('Latest synthetic observation from first tab', {
      timeout: 30000,
    })
    await other.close()
    const image = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 1200
      c.height = 700
      const x = c.getContext('2d')!
      x.fillStyle = '#e7f0fa'
      x.fillRect(0, 0, c.width, c.height)
      x.fillStyle = '#175b9c'
      x.fillRect(100, 120, 1000, 420)
      x.fillStyle = 'white'
      x.font = '38px sans-serif'
      x.fillText('SYNTHETIC TRAINING EVIDENCE', 160, 300)
      x.fillText('Fictional damaged cabinet cover', 160, 380)
      return c.toDataURL('image/png').split(',')[1]
    })
    for (let n = 1; n <= 9; n++) {
      const card = page.getByRole('region', { name: 'Question ' + n, exact: true })
      if (n === 2) await card.getByLabel('Response', { exact: true }).selectOption('Yes')
      if (n === 6)
        await card
          .getByLabel('Response', { exact: true })
          .fill('Synthetic observation for owner acceptance. 測試')
      if (n === 7) await card.getByLabel('Response', { exact: true }).fill('42')
      if (n === 8)
        await card
          .getByLabel('Response', { exact: true })
          .selectOption('Synthetic normal condition')
      if (n === 9) await card.getByLabel('Response', { exact: true }).fill('2026-10-27')
      await card
        .getByRole('button', { name: n === 3 ? /Fail$/ : n === 5 ? 'N/A' : /Pass$/ })
        .click()
      if (n === 3) {
        await card
          .getByLabel('Notes', { exact: true })
          .fill('Synthetic damaged cover; demonstration evidence.')
        await card.getByLabel('Photo evidence', { exact: true }).setInputFiles({
          name: 'synthetic-evidence.png',
          mimeType: 'image/png',
          buffer: Buffer.from(image, 'base64'),
        })
      }
      if (n === 5)
        await card
          .getByLabel('N/A reason', { exact: true })
          .fill('The fictional scenario excludes this component.')
    }
    await page.getByRole('button', { name: 'Review & sign', exact: true }).click()
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(text).toHaveValue('Synthetic observation for owner acceptance. 測試')
    await page.getByRole('button', { name: 'Review & sign', exact: true }).click()
    await page.getByRole('button', { name: 'Save & review', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Failed items', { timeout: 30000 })
    await expect(page.getByRole('dialog').getByRole('img')).toHaveCount(1)
    await page.getByRole('button', { name: 'Continue to signature', exact: true }).click()
    await page.getByLabel('Type your signature').fill('Synthetic demo administrator')
    await page.getByRole('button', { name: 'Apply Signature', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Signed inspection', exact: true })).toBeVisible(
      { timeout: 30000 },
    )
  }
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download report PDF', exact: true }).click()
  await (await download).saveAs('../backend/.env.pdf-checks/live-acceptance.pdf')
  await expect(page.getByRole('button', { name: 'Print report', exact: true })).toBeVisible()
  await page.evaluate(() => {
    ;(window as Window & { appPrintCalled?: boolean }).appPrintCalled = false
    window.print = () => {
      ;(window as Window & { appPrintCalled?: boolean }).appPrintCalled = true
    }
  })
  await page.getByRole('button', { name: 'Print report', exact: true }).click()
  await expect(page.locator('iframe[title="Completed inspection report"]')).toHaveAttribute(
    'data-print-ready',
    'true',
    { timeout: 30000 },
  )
  expect(
    await page.evaluate(() => (window as Window & { appPrintCalled?: boolean }).appPrintCalled),
  ).toBe(false)
  await expect(page.getByRole('button', { name: 'Save response', exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/live-signed-inspection.png', fullPage: true })
})
