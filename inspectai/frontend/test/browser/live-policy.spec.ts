import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import fs from 'node:fs'
test.use({ trace: 'off' })
test('live synthetic policies: independent approval, mixed and information-only completion, reports and PDF', async ({
  browser,
}) => {
  test.skip(
    process.env.VERIFY_LIVE_POLICY !== 'true',
    'Explicit staging opt-in; isolated synthetic forms and orders only',
  )
  test.setTimeout(480000)
  const fixture = JSON.parse(fs.readFileSync('../backend/.env.rail-demo.json', 'utf8'))
  expect(fixture.project).toBe('ehrgsakhrpbtintshjha')
  const contexts: BrowserContext[] = []
  async function login(key: string) {
    const sessionPath = '.env.policy-session-' + key + '.json'
    const ctx = await browser.newContext(
      fs.existsSync(sessionPath) ? { storageState: sessionPath } : {},
    )
    contexts.push(ctx)
    const page = await ctx.newPage()
    await page.goto('http://127.0.0.1:3000/login')
    try {
      await expect(
        page
          .getByRole('region', { name: 'Current workspace' })
          .or(page.getByLabel('Email', { exact: true })),
      ).toBeVisible({ timeout: 30000 })
      if (await page.getByLabel('Email', { exact: true }).count()) {
        await page.getByLabel('Email', { exact: true }).fill(fixture.personas[key].email)
        await page.getByLabel('Password', { exact: true }).fill(fixture.personas[key].password)
        await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      }
      await expect(page.getByRole('region', { name: 'Current workspace' })).toContainText(
        'Synthetic rail demonstration — not operational',
        { timeout: 30000 },
      )
    } catch {
      await page
        .getByLabel('Password', { exact: true })
        .fill('', { timeout: 1000 })
        .catch(() => {})
      await page
        .getByLabel('Email', { exact: true })
        .fill('', { timeout: 1000 })
        .catch(() => {})
      throw Error('Normal sign-in failed; credential fields cleared before recording diagnostics')
    }
    await ctx.storageState({ path: sessionPath })
    return page
  }
  async function api(page: Page, path: string, method = 'GET', body?: unknown) {
    return page.evaluate(
      async ({ path, method, body }) => {
        const r = await fetch('/api' + path, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + localStorage.getItem('inspectai-jwt'),
          },
          body: body ? JSON.stringify(body) : undefined,
        })
        if (!r.ok) throw Error('Protected API request failed: ' + path + ' HTTP ' + r.status)
        return r.json()
      },
      { path, method, body },
    )
  }
  const author = await login('RS-author'),
    reviewer = await login('RS-reviewer'),
    inspector = await login('RS-inspector'),
    admin = await login('admin')
  const adminProfile = (await api(admin, '/auth/me')).data
  expect(adminProfile.tenantId).toBe('c7a54fc9-6050-4c6b-8912-5bc476676b1a')
  const reviewerProfile = (await api(reviewer, '/auth/me')).data,
    inspectorProfile = (await api(inspector, '/auth/me')).data
  const authorProfile = (await api(author, '/auth/me')).data
  const statePath = '../backend/.env.policy-owner.json'
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {}
  async function form(key: string, items: Record<string, unknown>[]) {
    const reference = 'SYNTHETIC-POLICY-' + key.toUpperCase()
    let f = (await api(author, '/work-instructions?search=' + reference)).data.find(
      (f: any) => f.wi_number === reference,
    )
    if (!f)
      f = (
        await api(author, '/work-instructions', 'POST', {
          wiNumber: reference,
          title: 'SYNTHETIC owner acceptance — ' + key,
          revision: 'Synthetic 1',
          departmentId: authorProfile.primaryDepartmentId,
          category: 'Synthetic owner acceptance',
          checklistItems: items,
        })
      ).data
    if (f.status === 'draft') {
      await author.goto('http://127.0.0.1:3000/library/' + f.id + '/edit')
      await author.getByRole('button', { name: 'Submit for Approval', exact: true }).click()
      const selected = await author.evaluate((email) => {
        const labels = Array.from(document.querySelectorAll('label'))
        const label = labels.find((l) => l.textContent?.includes(email))
        const checkbox = label?.querySelector<HTMLInputElement>('input[type=checkbox]')
        if (!checkbox) return false
        checkbox.click()
        return true
      }, fixture.personas['RS-reviewer'].email)
      expect(selected).toBe(true)
      await author.getByRole('button', { name: 'Continue to confirmation', exact: true }).click()
      await expect(
        author.getByRole('dialog', { name: 'Confirm submission for approval' }),
      ).toBeVisible({ timeout: 30000 })
      await author.getByRole('button', { name: 'Preview form', exact: true }).click()
      await expect(
        author.getByRole('dialog', { name: 'Inspector preview — Preview mode' }),
      ).toBeVisible()
      await author.getByRole('dialog').screenshot({
        path: 'test-results/live-policy-preview-' + key + '.png',
        fullPage: true,
      })
      await author.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
      await author.getByRole('button', { name: 'Submit for approval', exact: true }).click()
      await expect(author).toHaveURL(new RegExp('/library/' + f.id + '$'), { timeout: 30000 })
      f = (await api(author, '/work-instructions/' + f.id)).data
    }
    if (f.status === 'pending_approval') {
      const approval = (await api(reviewer, '/approvals')).data.find(
        (a: any) => a.wi_id === f.id && a.final_status === 'active',
      )
      expect(approval).toBeTruthy()
      expect(approval.approval_steps[0].approver_id).toBe(reviewerProfile.id)
      await reviewer.goto('http://127.0.0.1:3000/library/' + f.id)
      await reviewer.getByRole('tab', { name: 'Approval & comments', exact: true }).click()
      await reviewer
        .getByLabel('Review comment', { exact: true })
        .fill('Synthetic fixture reviewed independently; not operational engineering criteria.')
      await reviewer.getByRole('button', { name: 'Approve form', exact: true }).click()
      await expect(reviewer.getByRole('button', { name: 'Approve form', exact: true })).toHaveCount(
        0,
        { timeout: 30000 },
      )
    }
    state[key] = { ...(state[key] || {}), formId: f.id }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
    return f.id
  }
  const question = (
    no: number,
    type: string,
    label: string,
    required: boolean,
    mode = 'manual',
    extra: Record<string, unknown> = {},
  ) => ({
    itemNo: String(no),
    description: 'SYNTHETIC ' + label,
    fieldType: type,
    required: true,
    conditionalJson: JSON.stringify({
      assessment: { required, mode, ...extra },
      allowNA: false,
      notesOnFail: no === 5,
      photoOnFail: no === 5,
    }),
    sortOrder: no,
    acceptanceCriteria: 'Fictional training scenario only; not operational criteria.',
  })
  const mixed = await form('mixed', [
    question(1, 'textarea', 'Condition observation', true),
    question(2, 'text', 'Serial number information', false),
    question(3, 'yes_no', 'No is explicitly acceptable', true, 'expected', {
      expectedAnswer: 'No',
    }),
    question(4, 'yes_no', 'Yes is explicitly acceptable', true, 'expected', {
      expectedAnswer: 'Yes',
    }),
    {
      ...question(5, 'measurement', 'Demo reading', true, 'limits'),
      unit: 'fictional demo units',
      minValue: 0,
      maxValue: 10,
    },
    question(6, 'date', 'Date information', false),
    question(7, 'signature', 'Acknowledgement information', false),
  ])
  const information = await form('information', [
    question(1, 'text', 'Serial number information', false),
    question(2, 'date', 'Date information', false),
  ])
  const asset = (await api(admin, '/assets?search=DEMO-RS-001')).data.find(
    (a: any) => a.asset_number === 'DEMO-RS-001',
  )
  const today = new Date().toISOString().slice(0, 10)
  for (const [key, formId] of [
    ['mixed', mixed],
    ['information', information],
  ]) {
    if (!state[key].orderId) {
      const order = (
        await api(admin, '/inspections', 'POST', {
          assetId: asset.id,
          workInstructionId: formId,
          assignedTo: inspectorProfile.id,
          notes: 'SYNTHETIC isolated question-policy owner acceptance',
          priority: 'low',
        })
      ).data
      state[key].orderId = order.id
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
    }
    await inspector.goto('http://127.0.0.1:3000/inspections/' + state[key].orderId)
    await expect(
      inspector
        .getByRole('heading', { name: 'Signed inspection', exact: true })
        .or(inspector.getByRole('button', { name: 'Start inspection', exact: true }))
        .or(inspector.getByRole('region', { name: 'Question 1', exact: true }))
        .first(),
    ).toBeVisible({ timeout: 30000 })
    if (
      !(await inspector.getByRole('heading', { name: 'Signed inspection', exact: true }).count())
    ) {
      if (await inspector.getByRole('button', { name: 'Start inspection', exact: true }).count())
        await inspector.getByRole('button', { name: 'Start inspection', exact: true }).click()
      const q = (n: number) => inspector.getByRole('region', { name: 'Question ' + n, exact: true })
      if (key === 'mixed') {
        await q(1)
          .getByLabel('Response', { exact: true })
          .fill('Synthetic condition observation, saved before assessment')
        await expect(inspector.getByRole('status')).toHaveText('Saved', { timeout: 30000 })
        await inspector.reload()
        await expect(q(1).getByLabel('Response', { exact: true })).toHaveValue(
          'Synthetic condition observation, saved before assessment',
          { timeout: 30000 },
        )
        await q(1).getByRole('button', { name: /Pass$/ }).click()
        await q(2).getByLabel('Response', { exact: true }).fill('SYNTHETIC-SERIAL-001')
        await expect(q(2).getByRole('button', { name: /Pass$|Fail$/ })).toHaveCount(0)
        await q(3).getByLabel('Response', { exact: true }).selectOption('No')
        await expect(q(3).getByText(/Derived assessment: PASS/)).toBeVisible()
        await q(4).getByLabel('Response', { exact: true }).selectOption('Yes')
        await expect(q(4).getByText(/Derived assessment: PASS/)).toBeVisible()
        await q(5).getByLabel('Response', { exact: true }).fill('11')
        await expect(q(5).getByText(/Derived assessment: FAIL/)).toBeVisible()
        await q(5)
          .getByLabel('Notes', { exact: true })
          .fill('Synthetic out-of-range example; fictional values only.')
        const image = await inspector.evaluate(() => {
          const c = document.createElement('canvas')
          c.width = 800
          c.height = 450
          const x = c.getContext('2d')!
          x.fillStyle = '#e7f0fa'
          x.fillRect(0, 0, 800, 450)
          x.fillStyle = '#175b9c'
          x.font = '32px sans-serif'
          x.fillText('SYNTHETIC POLICY EVIDENCE', 100, 220)
          return c.toDataURL('image/png').split(',')[1]
        })
        await q(5)
          .getByLabel('Photo evidence', { exact: true })
          .setInputFiles({
            name: 'synthetic-policy.png',
            mimeType: 'image/png',
            buffer: Buffer.from(image, 'base64'),
          })
        await q(6).getByLabel('Response', { exact: true }).fill(today)
        await q(7).getByRole('button', { name: 'Capture signature', exact: true }).click()
        await inspector.getByLabel('Type your signature').fill('Synthetic acknowledgement')
        await inspector.getByRole('button', { name: 'Apply Signature', exact: true }).click()
      } else {
        await q(1).getByLabel('Response', { exact: true }).fill('SYNTHETIC-INFORMATION-ONLY')
        await q(2).getByLabel('Response', { exact: true }).fill(today)
        await expect(inspector.getByRole('button', { name: /Pass$|Fail$/ })).toHaveCount(0)
      }
      await inspector.getByRole('button', { name: 'Review & sign', exact: true }).click()
      await inspector.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await inspector.getByRole('button', { name: 'Review & sign', exact: true }).click()
      await inspector.getByRole('button', { name: 'Save & review', exact: true }).click()
      await inspector.getByRole('button', { name: 'Continue to signature', exact: true }).click()
      await inspector.getByLabel('Type your signature').fill('Synthetic department inspector')
      await inspector.getByRole('button', { name: 'Apply Signature', exact: true }).click()
      await expect(
        inspector.getByRole('heading', { name: 'Signed inspection', exact: true }),
      ).toBeVisible({ timeout: 30000 })
    }
    const record = (await api(inspector, '/inspections/' + state[key].orderId + '/record')).data
    expect(record.signed_payload.assessmentSummary.assessed).toBe(key === 'mixed' ? 4 : 0)
    if (key === 'information')
      await expect(inspector.getByText('Signed · Completed — no assessed checks')).toBeVisible()
    const download = inspector.waitForEvent('download')
    await inspector.getByRole('button', { name: 'Download report PDF', exact: true }).click()
    await (await download).saveAs('../backend/.env.pdf-checks/live-policy-' + key + '.pdf')
    // Verify that printing targets the loaded PDF document without invoking a native printer dialog in automated Chrome.
    await inspector.evaluate(() => {
      const append = Node.prototype.appendChild
      Node.prototype.appendChild = function <T extends Node>(child: T): T {
        if (child instanceof HTMLIFrameElement && child.title === 'Completed inspection report') {
          const loaded = child.onload
          child.onload = function (event) {
            if (child.contentWindow)
              child.contentWindow.print = () => {
                child.dataset.printInvoked = 'true'
              }
            loaded?.call(child, event)
          }
        }
        return append.call(this, child) as T
      }
    })
    await inspector.getByRole('button', { name: 'Print report', exact: true }).click()
    await expect(inspector.locator('iframe[title="Completed inspection report"]')).toHaveAttribute(
      'data-print-ready',
      'true',
      { timeout: 30000 },
    )
    await expect(inspector.locator('iframe[title="Completed inspection report"]')).toHaveAttribute(
      'data-print-invoked',
      'true',
    )
    await inspector.locator('main').screenshot({
      path: 'test-results/live-policy-signed-' + key + '.png',
      fullPage: true,
    })
  }
  for (const type of [
    'failing-assets',
    'failure-pareto',
    'repeated-observations',
    'failure-trends',
    'completion-overdue',
    'measurement-trends',
  ]) {
    const r = await api(admin, '/reports/run/' + type + '?from=2020-01-01&to=' + today)
    expect(r.meta.total).toBeGreaterThanOrEqual(0)
  }
  const report = await api(
    admin,
    '/reports/run/failing-assets?from=2020-01-01&to=' + today + '&formId=' + mixed,
  )
  expect(report.summary.assessed).toBe(4)
  expect(report.summary.failures).toBe(1)
  expect(report.summary.informational).toBe(3)
  const restricted = await login('SIG-inspector')
  const denied = await api(
    restricted,
    '/reports/run/failing-assets?from=2020-01-01&to=' + today + '&formId=' + mixed,
  )
  expect(denied.meta.total).toBe(0)
  await admin.goto('http://127.0.0.1:3000/reports')
  await expect(admin.getByRole('button', { name: /^Run / })).toHaveCount(6)
  await admin.getByRole('button', { name: 'Run Frequently failing assets', exact: true }).click()
  await expect(admin.getByRole('table', { name: 'Frequently failing assets' })).toBeVisible({
    timeout: 30000,
  })
  await admin.locator('main').screenshot({ path: 'test-results/live-policy-report-desktop.png' })
  await admin.setViewportSize({ width: 390, height: 844 })
  expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await admin.locator('main').screenshot({ path: 'test-results/live-policy-report-phone.png' })
  for (const context of contexts) await context.close()
})
