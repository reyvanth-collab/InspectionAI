import { type Page } from '@playwright/test'
export const catalogue = [
  ['failing-assets', 'Frequently failing assets'],
  ['failure-pareto', 'Failure Pareto'],
  ['repeated-observations', 'Repeated failed observations'],
  ['failure-trends', 'Failure trends'],
  ['completion-overdue', 'Inspection completion and overdue'],
  ['measurement-trends', 'Measurement trends'],
].map(([id, name]) => ({
  id,
  name,
  description: 'Synthetic report definition for browser interaction checks',
}))
export async function policyFixture(page: Page, questions: Record<string, unknown>[] = []) {
  const user = {
    id: 'admin-fixture',
    tenantId: 'tenant-fixture',
    tenantName: 'Synthetic rail demonstration — not operational',
    role: 'viewer',
    name: 'Synthetic administrator',
    email: 'admin@example.invalid',
    staffId: 'ADMIN',
    capabilities: [
      'administrator',
      'inspector',
      'form_author',
      'form_approver',
      'viewer',
      'asset_manager',
      'work_order_manager',
    ],
    primaryDepartmentId: 'dept-fixture',
  }
  const token =
    'x.' +
    Buffer.from(JSON.stringify({ ...user, exp: Date.now() / 1000 + 3600 })).toString('base64url') +
    '.x'
  await page.addInitScript((t) => localStorage.setItem('inspectai-jwt', t), token)
  const state = {
    saved: null as any,
    preview: 0,
    submitted: 0,
    failSubmit: false,
    failReport: false,
    draft: null as any,
    completed: false,
    reviewed: 0,
    requests: [] as string[],
  }
  const items = questions.length
    ? questions
    : [
        {
          id: 'q-info',
          item_no: '1',
          description: 'Equipment serial number',
          field_type: 'text',
          required: true,
          conditional_json: JSON.stringify({
            assessment: { required: false, mode: 'manual' },
            allowNA: false,
          }),
        },
      ]
  const wo = {
    id: 'wo-policy',
    wo_number: 'WO-POLICY',
    asset_name: 'Synthetic asset',
    department_id: 'dept-fixture',
    assigned_to: user.id,
    status: 'in_progress',
    wi_number: 'POLICY-FORM',
    wi_title: 'Synthetic policy',
    revision: '1',
    checklist_items: items,
  }
  const profileRows = Array.from({ length: 27 }, (_, i) => ({
    id: 'user-' + i,
    name: 'Synthetic person ' + String(i).padStart(2, '0'),
    email: 'person' + i + '@example.invalid',
    staff_id: 'SYN-' + i,
    role: 'viewer',
    active: i !== 26,
    primary_department_id: 'dept-fixture',
    department_ids: ['dept-fixture'],
    capabilities: i % 2 ? ['inspector'] : ['form_author', 'viewer'],
  }))
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname.replace('/api', ''),
      method = req.method(),
      body = req.postDataJSON()
    state.requests.push(method + ' ' + p + '?' + url.searchParams)
    const send = (data: unknown, meta?: unknown) =>
      route.fulfill({ json: { data, ...(meta ? { meta } : {}) } })
    if (p === '/auth/me') return send(user)
    if (p === '/departments')
      return send([{ id: 'dept-fixture', code: 'SYN', name: 'Synthetic department', active: true }])
    if (p === '/users/approvers')
      return send([
        {
          id: 'reviewer-fixture',
          name: 'Independent synthetic reviewer',
          email: 'reviewer@example.invalid',
          role: 'approver',
        },
      ])
    if (p === '/users/assignable') return send([])
    if (p === '/users') {
      let rows = profileRows.filter(
        (r) =>
          !url.searchParams.get('search') ||
          [r.name, r.email, r.staff_id]
            .join(' ')
            .toLowerCase()
            .includes(url.searchParams.get('search')!.toLowerCase()),
      )
      if (url.searchParams.get('capability'))
        rows = rows.filter((r) => r.capabilities.includes(url.searchParams.get('capability')!))
      if (url.searchParams.get('status') === 'inactive') rows = rows.filter((r) => !r.active)
      const page = Number(url.searchParams.get('page') || 1),
        size = Number(url.searchParams.get('pageSize') || 25)
      return send(rows.slice((page - 1) * size, page * size), {
        page,
        pageSize: size,
        total: rows.length,
        hasMore: page * size < rows.length,
      })
    }
    if (
      (p === '/work-instructions' && method === 'POST') ||
      (p === '/work-instructions/form-policy' && method === 'PUT')
    ) {
      state.saved = { ...body, id: 'form-policy', updated_at: new Date().toISOString() }
      return route.fulfill({ status: method === 'POST' ? 201 : 200, json: { data: state.saved } })
    }
    if (p.endsWith('/approval-preview')) {
      state.preview++
      return send({ confirmationToken: 'synthetic-content-digest' })
    }
    if (p.endsWith('/submit-approval')) {
      state.submitted++
      await new Promise((r) => setTimeout(r, 150))
      if (state.failSubmit)
        return route.fulfill({
          status: 409,
          json: { error: 'Synthetic concurrent change; confirm the latest content' },
        })
      return send({ success: true })
    }
    if (p === '/work-instructions/form-policy')
      return send({
        id: 'form-policy',
        wi_number: state.saved?.wiNumber || 'POLICY',
        title: state.saved?.title || 'Synthetic form',
        revision: '1',
        status: 'draft',
        department_id: 'dept-fixture',
        owner_id: user.id,
        updated_at: state.saved?.updated_at,
        wi_checklist_items: (state.saved?.checklistItems || []).map((q: any) => ({
          ...q,
          item_no: q.itemNo,
          field_type: q.fieldType,
          conditional_json: q.conditionalJson,
          options_json: q.optionsJson,
          min_value: q.minValue,
          max_value: q.maxValue,
          layout_json: q.layoutJson,
          acceptance_criteria: q.acceptanceCriteria,
          sort_order: q.sortOrder,
        })),
      })
    if (p === '/work-instructions')
      return send([], { total: 0, hasMore: false, page: 1, pageSize: 50 })
    if (p === '/assets') return send([], { total: 0, hasMore: false, page: 1, pageSize: 50 })
    if (p === '/inspections/wo-policy/record')
      return send({
        id: 'record-policy',
        work_order_id: wo.id,
        inspector_id: user.id,
        completed_at: state.completed ? '2026-10-31T00:00:00Z' : null,
        overall_result: state.completed ? 'na' : null,
        inspection_findings: [],
        draft: state.draft,
        signed_payload: state.completed
          ? { assessmentSummary: { completionLabel: 'Completed — no assessed checks' } }
          : undefined,
      })
    if (p === '/inspections/wo-policy/draft') {
      state.draft = { version: (state.draft?.version || 0) + 1, answers: body.answers }
      return send({ version: state.draft.version })
    }
    if (p === '/inspections/wo-policy/review') {
      state.reviewed++
      return send({
        reviewToken: 'synthetic-review-digest',
        draftVersion: state.draft.version,
        items,
      })
    }
    if (p === '/inspections/wo-policy/complete') {
      state.completed = true
      return send({ success: true })
    }
    if (p === '/inspections/wo-policy')
      return send({ ...wo, status: state.completed ? 'complete' : wo.status })
    if (p === '/inspections')
      return send([], { total: 0, hasMore: false, page: 1, pageSize: 50, summary: {} })
    if (p === '/reports/catalogue') return send(catalogue)
    if (p.startsWith('/reports/run/')) {
      if (state.failReport)
        return route.fulfill({ status: 500, json: { error: 'Synthetic report failure' } })
      if (url.searchParams.get('format') === 'csv')
        return route.fulfill({
          contentType: 'text/csv',
          body: 'Asset,Failed items\r\nSYN-1,2\r\nSYN-2,1',
        })
      if (url.searchParams.get('format') === 'print')
        return route.fulfill({
          contentType: 'text/html',
          body: '<html><body><h1>Synthetic filtered report</h1></body></html>',
        })
      return route.fulfill({
        json: {
          data: [
            {
              key: 'asset',
              assetNumber: 'SYN-1',
              failedItems: 2,
              assessedItems: 3,
              itemFailureRate: 66.67,
              inspections: [{ id: wo.id, number: wo.wo_number, date: '2026-10-31' }],
            },
          ],
          meta: { page: 1, pageSize: 25, total: 1, hasMore: false },
          summary: { assessed: 3, failures: 2, na: 1, informational: 1 },
          columns: [
            ['assetNumber', 'Asset'],
            ['failedItems', 'Failed items'],
            ['assessedItems', 'Assessed items'],
            ['itemFailureRate', 'Assessed failure rate (%)'],
          ],
          coverage: {
            from: '2026-01-01',
            to: '2026-10-31',
            basis: 'Completed signed inspections only',
            definition: 'N/A and informational answers are excluded from assessment rates.',
          },
          chart: [{ key: 'asset', label: 'SYN-1', value: 2 }],
        },
      })
    }
    return send([], { total: 0, hasMore: false })
  })
  return state
}
