import { test, expect, type Page } from '@playwright/test'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYZkAAAAASUVORK5CYII=',
  'base64',
)
async function fixture(page: Page, role = 'inspector') {
  const user = {
    id: 'inspector-1',
    tenantId: 'tenant-1',
    tenantName: 'Synthetic rail demonstration — not operational',
    role,
    capabilities: role === 'admin' ? ['administrator'] : ['inspector'],
    name: 'Synthetic Inspector',
    email: 'inspector@example.invalid',
    staffId: 'DEMO',
    primaryDepartmentId: 'dept-1',
  }
  const token =
    'x.' +
    Buffer.from(JSON.stringify({ ...user, exp: Date.now() / 1000 + 3600 })).toString('base64url') +
    '.x'
  await page.addInitScript((t) => localStorage.setItem('inspectai-jwt', t), token)
  const findings: Record<string, Record<string, unknown>> = {},
    payloads: Record<string, unknown>[] = []
  let failSave = true,
    signed = false
  let draft: { version: number; answers: Record<string, any> } | null = null
  const wo = {
    id: 'wo-1',
    wo_number: 'WO-DEMO-001',
    asset_name: 'Synthetic signalling cabinet',
    asset_number_snapshot: 'DEMO-SIG-001',
    department_name_snapshot: 'Signalling',
    department_id: 'dept-1',
    location: 'FIC-01 · Northbank',
    assigned_to: user.id,
    assigned_to_name: user.name,
    status: 'in_progress',
    priority: 'medium',
    wi_number: 'DEMO-SIG-F1',
    wi_title: 'Synthetic cabinet check',
    revision: 'Demo 1',
    checklist_item_count: 2,
    checklist_items: [
      {
        id: 'q1',
        item_no: '1',
        description: 'External cover condition',
        required: true,
        field_type: 'pass_fail',
        conditional_json: JSON.stringify({ notesOnFail: true, photoOnFail: true }),
      },
      {
        id: 'q2',
        item_no: '2',
        description: 'Fictional indicator reading',
        required: true,
        field_type: 'measurement',
        min_value: 0,
        max_value: 10,
        acceptance_criteria: 'FICTIONAL DEMONSTRATION ONLY — 0 to 10 demo units.',
      },
    ],
  }
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method(),
      body = ['POST', 'PUT'].includes(method) ? route.request().postDataJSON() : {}
    let data: unknown = []
    if (path === '/api/auth/me') data = user
    else if (path === '/api/work-instructions') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'form-1',
              wi_number: 'DEMO-SIG-F1',
              title: 'Synthetic cabinet inspection',
              revision: 'Demo 1',
              status: 'active',
              department_id: 'dept-1',
              checklist_item_count: 2,
              checkable_item_count: 2,
            },
          ],
          meta: { hasMore: false },
        }),
      })
      return
    } else if (path === '/api/departments')
      data = [{ id: 'dept-1', code: 'SIG', name: 'Signalling', active: true }]
    else if (path === '/api/inspections/wo-1') data = wo
    else if (path === '/api/inspections/wo-1/record')
      data = {
        id: 'record-1',
        work_order_id: 'wo-1',
        completed_at: signed ? '2026-10-25T12:00:00Z' : null,
        overall_result: signed ? 'fail' : null,
        inspection_findings: Object.values(findings),
        draft,
      }
    else if (path === '/api/inspections/wo-1/draft') {
      payloads.push(body)
      await new Promise((r) => setTimeout(r, 200))
      if (failSave) {
        failSave = false
        await route.fulfill({
          status: 500,
          json: { error: 'Simulated draft failure. Input retained.' },
        })
        return
      }
      if (body.version !== (draft?.version || 0)) {
        await route.fulfill({
          status: 409,
          json: { error: 'This inspection changed in another tab. Reload the latest draft.' },
        })
        return
      }
      draft = { version: (draft?.version || 0) + 1, answers: body.answers }
      data = { version: draft.version }
    } else if (path === '/api/inspections/wo-1/review') {
      data = { reviewToken: 'reviewed-saved-state', draftVersion: draft?.version || 0 }
    } else if (path === '/api/inspections/wo-1/findings/photo') {
      await new Promise((r) => setTimeout(r, 250))
      findings[body.checklistItemId] = {
        ...findings[body.checklistItemId],
        checklist_item_id: body.checklistItemId,
        photo_urls: [body.imageDataUrl],
      }
      data = findings[body.checklistItemId]
    } else if (path === '/api/inspections/wo-1/findings') {
      payloads.push(body)
      if (failSave) {
        failSave = false
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Simulated save failure. Retry your response.' }),
        })
        return
      }
      findings[body.checklistItemId] = {
        ...findings[body.checklistItemId],
        id: body.checklistItemId,
        checklist_item_id: body.checklistItemId,
        result: body.result,
        captured_value: body.capturedValue,
        notes: body.notes,
      }
      data = findings[body.checklistItemId]
    } else if (path === '/api/inspections/wo-1/complete') {
      signed = true
      data = { success: true, overallResult: 'fail' }
    } else if (path === '/api/inspections') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [wo],
          meta: {
            page: 1,
            pageSize: 50,
            total: 1,
            hasMore: false,
            summary: { total: 1, open: 0, in_progress: 1, complete: 0 },
          },
        }),
      })
      return
    } else if (path === '/api/history') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0, page: 1, hasMore: false } }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data }),
    })
  })
  return { findings, payloads }
}
test('mocked API: incomplete autosave, failed retry, rapid edits, confirmation and exact review signing', async ({
  page,
}) => {
  const f = await fixture(page)
  await page.goto('/inspections/wo-1')
  const first = page.getByRole('region', { name: 'Question 1' }),
    second = page.getByRole('region', { name: 'Question 2' })
  await second.getByLabel('Response', { exact: true }).fill('7')
  await expect(page.getByRole('alert')).toContainText('Simulated draft failure', { timeout: 15000 })
  expect(await second.getByLabel('Response', { exact: true }).inputValue()).toBe('7')
  await page.getByRole('button', { name: 'Retry saving draft' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  await page.reload()
  await expect(second.getByLabel('Response', { exact: true })).toHaveValue('7')
  await expect(second.getByRole('button', { name: /Pass$/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await first.getByRole('button', { name: /Fail$/ }).click()
  await first.getByLabel('Notes', { exact: true }).fill('Synthetic damaged cover')
  await first
    .getByLabel('Photo evidence', { exact: true })
    .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png })
  await second.getByLabel('Response', { exact: true }).fill('8')
  await second.getByLabel('Response', { exact: true }).fill('9')
  await second.getByRole('button', { name: /Pass$/ }).click()
  await page.getByRole('button', { name: 'Review & sign', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(
    'Save your responses and continue to review?',
  )
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(second.getByLabel('Response', { exact: true })).toHaveValue('9')
  await page.getByRole('button', { name: 'Review & sign', exact: true }).click()
  await page.getByRole('button', { name: 'Save & review', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Review inspection')
  await expect(page.getByRole('dialog').getByText('Failed items', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue to signature', exact: true }).click()
  await page.getByLabel('Type your signature').fill('Synthetic inspector')
  await page.getByRole('button', { name: 'Apply Signature', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Signed inspection', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save response', exact: true })).toHaveCount(0)
  expect(f.payloads.at(-1)?.answers.q2.value).toBe('9')
  expect(f.payloads.at(-1)?.answers.q1.photos.length).toBe(1)
})

test('mocked API: unsaved navigation warning, missing evidence and failed upload block signature', async ({
  page,
}) => {
  await fixture(page)
  await page.goto('/inspections/wo-1')
  const first = page.getByRole('region', { name: 'Question 1' }),
    second = page.getByRole('region', { name: 'Question 2' })
  await first.getByRole('button', { name: /Fail$/ }).click()
  await first.getByLabel('Notes', { exact: true }).fill('Synthetic defect without evidence yet')
  await second.getByLabel('Response', { exact: true }).fill('7')
  await second.getByRole('button', { name: /Pass$/ }).click()
  await expect(page.getByRole('alert')).toContainText('Simulated draft failure', { timeout: 15000 })
  page.once('dialog', (d) => d.dismiss())
  await page.locator('a[href="/inspections"]').first().click()
  await expect(page).toHaveURL(/\/inspections\/wo-1$/)
  await page.getByRole('button', { name: 'Retry saving draft' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  await page.getByRole('button', { name: 'Review & sign', exact: true }).click()
  await page.getByRole('button', { name: 'Save & review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue to signature' })).toBeDisabled()
  await expect(page.getByRole('dialog')).toContainText('Attach photo evidence')
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.route('**/api/inspections/wo-1/draft', (route) =>
    route.fulfill({ status: 500, json: { error: 'Synthetic photo persistence failure' } }),
  )
  await first
    .getByLabel('Photo evidence', { exact: true })
    .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png })
  await page.getByRole('button', { name: 'Review & sign', exact: true }).click()
  await page.getByRole('button', { name: 'Save & review', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Synthetic photo persistence failure')
  await expect(page.getByRole('button', { name: 'Continue to signature' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(first.getByText('Photo pending save')).toBeVisible()
  await expect(first.getByLabel('Notes', { exact: true })).toHaveValue(
    'Synthetic defect without evidence yet',
  )
})

test('mocked API: phone navigation and inspection rows remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page)
  await page.goto('/inspections')
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  await expect(page.getByRole('link', { name: /WO-DEMO-001/ })).toBeVisible()
  await page.getByRole('button',{name:'Details for WO-DEMO-001',exact:true}).click()
  await expect(page.getByText('FIC-01 · Northbank',{exact:true}).last()).toBeVisible()
  const bounds=await page.getByRole('link',{name:'WO-DEMO-001',exact:true}).boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390)
  await expect(page.getByRole('link', { name: 'MOMS Analytics' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Approvals', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('link', { name: /WO-DEMO-001/ }).click()
  await expect(
    page.getByRole('region', { name: 'Question 1' }).getByRole('button', { name: '× Fail' }),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/inspection-phone.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test('mocked API: administrative forms, mobile editor and settings', async ({ page }) => {
  await fixture(page, 'admin')
  await page.goto('/library')
  await expect(page.getByRole('region', { name: 'Current workspace' })).toContainText(
    'Synthetic rail demonstration — not operational',
  )
  await expect(page.getByRole('heading', { name: 'Inspection Forms', exact: true })).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'Synthetic cabinet inspection', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/forms-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Create form', exact: true }).click()
  await expect(page.getByLabel('Form reference')).toBeVisible()
  await page.getByLabel('Form reference').fill('DEMO-FORM-001')
  await page.getByRole('button', { name: 'Add Pass / Fail / NA', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Edit question 1', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Signalling', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Activity history', exact: true })).toBeVisible()
  await expect(page.getByText('IBM Maximo', { exact: true })).toHaveCount(0)
})
test('mocked API using real seed definitions: all 20 published rail forms open with 10 questions', async ({
  page,
}) => {
  await fixture(page, 'admin')
  const { departments, questionsFor } = await import('../../../backend/scripts/rail-demo-data.mjs')
  const forms = departments.flatMap((department: any) =>
    department.forms.map(([topic, checks]: [string, string[]], index: number) => ({
      id: `${department.code}-${index + 1}`,
      wi_number: `DEMO-${department.code}-F${index + 1}`,
      title: `SYNTHETIC DEMO — ${topic}`,
      status: 'active',
      revision: 'Demo 1',
      department_id: department.code,
      checklist_item_count: 10,
      checkable_item_count: 10,
      wi_checklist_items: questionsFor(topic, checks).map((question: any, n: number) => ({
        id: `${department.code}-${index + 1}-q${n + 1}`,
        item_no: question.itemNo,
        description: question.description,
        acceptance_criteria: question.acceptanceCriteria,
        category: question.category,
        field_type: question.fieldType,
        sort_order: question.sortOrder,
        required: question.required,
        layout_json: question.layoutJson,
      })),
    })),
  )
  await page.route('**/api/departments', (route) =>
    route.fulfill({
      json: {
        data: departments.map((department: any) => ({
          id: department.code,
          name: department.name,
          code: department.code,
          active: true,
        })),
      },
    }),
  )
  await page.route('**/api/work-instructions**', (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3]
    return route.fulfill({
      json: {
        data: id ? forms.find((form: any) => form.id === id) : forms,
        meta: { hasMore: false },
      },
    })
  })
  await page.goto('/library')
  await expect(page.getByRole('region', { name: 'Current workspace' })).toContainText(
    'Synthetic rail demonstration — not operational',
  )
  await expect(page.getByRole('table', { name: 'Inspection Forms' }).getByRole('row')).toHaveCount(
    21,
  )
  await expect(page.getByRole('cell', { name: '10', exact: true })).toHaveCount(20)
  await page.getByRole('link', { name: 'DEMO-RS-F1', exact: true }).click()
  for (const question of forms[0].wi_checklist_items)
    await expect(page.getByText(question.description, { exact: true })).toBeVisible()
})
