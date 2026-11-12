import { test, expect, type Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

async function workflowFixture(page: Page) {
  const user = {
    id: 'synthetic-admin', tenantId: 'synthetic-tenant', tenantName: 'Synthetic acceptance workspace',
    role: 'admin', capabilities: ['administrator','form_author','form_approver','inspector','viewer'],
    name: 'Synthetic Administrator', email: 'admin@example.invalid', staffId: 'SYN-ADMIN', primaryDepartmentId: 'dept-signalling',
  }
  const token = 'x.' + Buffer.from(JSON.stringify({ ...user, exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.x'
  await page.addInitScript((value) => localStorage.setItem('inspectai-jwt', value), token)
  const reviewers = [
    { id: 'reviewer-signalling', name: 'Signalling Reviewer', email: 'signal@example.invalid', role: 'approver' },
    { id: 'manager-engineering', name: 'Engineering Manager', email: 'engineer@example.invalid', role: 'approver' },
  ]
  const groups: Array<Record<string, unknown>> = []
  const versions: Array<Record<string, any>> = []
  const state = { preview: [] as any[], activeWorkflow: null as any, requests: [] as string[] }
  const send = (route: any, data: unknown, status = 200) => route.fulfill({ status, json: { data } })
  await page.route('**/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    const path = url.pathname.replace('/api', '')
    const body = ['POST','PUT'].includes(method) ? request.postDataJSON() : {}
    state.requests.push(method + ' ' + path)
    if (path === '/auth/me') return send(route, user)
    if (path === '/departments') return send(route, [{ id: 'dept-signalling', code: 'SIG', name: 'Signalling', active: true }])
    if (path === '/approval-workflows/reviewers') return send(route, reviewers)
    if (path === '/approval-workflows/person-groups' && method === 'GET') return send(route, groups)
    if (path === '/approval-workflows/person-groups' && method === 'POST') {
      const group = { id: 'group-signalling', name: body.name, description: body.description, active: true, members: reviewers.filter((person) => body.memberIds.includes(person.id)).map((person) => ({ ...person, active: true, capabilities: ['form_approver'] })) }
      groups.push(group); return send(route, group, 201)
    }
    if (path === '/approval-workflows' && method === 'GET') return send(route, versions)
    if (path === '/approval-workflows' && method === 'POST') {
      const version = { id: 'version-1', workflow_id: 'workflow-1', workflow_code: body.workflowCode, version_id: 'version-1', version_number: 1, name: body.name, description: body.description, applicability_department_id: body.departmentId, is_default: body.isDefault, status: 'draft', graph: body.graph }
      versions.push(version); return send(route, { workflowId: 'workflow-1', workflowCode: body.workflowCode, ...version }, 201)
    }
    if (path === '/approval-workflows/workflow-1/versions/version-1' && method === 'PUT') {
      Object.assign(versions[0], { ...body, workflow_code: body.workflowCode, graph: body.graph })
      state.preview = routeOrder(body.graph).map((node) => stagePreview(node, groups[0], reviewers))
      return send(route, { ...versions[0], workflowCode: body.workflowCode })
    }
    if (path === '/approval-workflows/workflow-1/versions/version-1/preview') return send(route, { issues: [], stages: state.preview })
    if (path === '/approval-workflows/workflow-1/versions/version-1/activate') {
      versions[0].status = 'active'; state.activeWorkflow = versions[0]; return send(route, versions[0])
    }
    if (path === '/approval-workflows/default') {
      if (!state.activeWorkflow) return send(route, null)
      return send(route, { ...state.activeWorkflow, issues: [], stages: routeOrder(state.activeWorkflow.graph).map((node) => stagePreview(node, groups[0], reviewers)) })
    }
    return send(route, [])
  })
  return { groups, versions, state, reviewers }
}

function routeOrder(graph: any) {
  const nodes = new Map(graph.nodes.map((node: any) => [node.id, node]))
  const next = new Map(graph.edges.map((edge: any) => [edge.source, edge.target]))
  const result: any[] = []
  let id = graph.nodes.find((node: any) => node.type === 'start')?.id
  while (id && nodes.has(id)) { const node = nodes.get(id); result.push(node); id = next.get(id) }
  return result
}

function stagePreview(node: any, group: any, reviewers: any[]) {
  if (node.type === 'start' || node.type === 'publish') return { nodeId: node.id, type: node.type, stageName: node.label }
  if (node.type === 'group') return { nodeId: node.id, type: node.type, stageName: node.label, groupRule: node.groupRule, eligibleMembers: group?.members.map((member: any) => ({ id: member.id, name: member.name })) || [] }
  return { nodeId: node.id, type: node.type, stageName: node.label, reviewerName: reviewers.find((reviewer) => reviewer.id === node.reviewerId)?.name }
}

test('administrator can drag, connect, save, reopen, preview a changed order and activate a group route', async ({ page }) => {
  test.setTimeout(60000)
  const fixture = await workflowFixture(page)
  await page.goto('/approval-workflows')
  await expect(page.getByRole('heading', { name: 'Approval Workflows' })).toBeVisible()

  await page.getByRole('button', { name: 'Person Groups' }).click()
  await page.getByLabel('Group name').fill('Signalling Reviewer Group')
  await page.getByRole('checkbox', { name: /Signalling Reviewer/ }).check()
  await page.getByRole('button', { name: 'Save group' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  await page.getByRole('button', { name: 'New workflow' }).click()
  await page.getByLabel('Workflow code').fill('SIGNALLING-REVIEW')
  await page.getByLabel('Workflow name').fill('Signalling review')
  await page.getByLabel('Applies to').selectOption('dept-signalling')
  await page.getByRole('checkbox', { name: 'Default for this scope' }).check()
  await page.getByRole('button', { name: 'Create draft' }).click()

  const canvas = page.getByLabel('Workflow designer')
  const positions = [{ x: 100, y: 100 }, { x: 360, y: 100 }, { x: 620, y: 350 }, { x: 100, y: 350 }]
  for (const [index, title] of ['Start', 'Group Approval', 'Individual Approval', 'Publish'].entries()) {
    const paletteNode = page.locator('.wf-palette-row').filter({ hasText: title })
    await paletteNode.dragTo(page.locator('.wf-viewport'), { targetPosition: positions[index] })
    await expect(page.locator('.wf-node')).toHaveCount(index + 1)
  }
  await page.getByRole('button', { name: 'Fit workflow to canvas' }).click()
  const groupNode = page.getByRole('group', { name: /Group Approval node/ })
  await groupNode.getByLabel('Connect from Group Approval').click()
  await page.getByRole('button', { name: 'Connect into Individual Approval' }).click()
  await page.getByRole('button', { name: 'Connect from Start' }).click()
  await page.getByRole('button', { name: 'Connect into Group Approval' }).click()
  await page.getByRole('button', { name: 'Connect from Individual Approval' }).click()
  await page.getByRole('button', { name: 'Connect into Publish' }).click()

  await groupNode.click()
  await page.getByLabel('Stage name').fill('Signalling Reviewer Group')
  await page.getByLabel('Person Group').selectOption('group-signalling')
  await page.getByLabel('Approval rule').selectOption('any')
  const individual = page.getByRole('group', { name: /Individual Approval node/ })
  await individual.click()
  await page.getByLabel('Stage name').fill('Engineering Manager')
  await page.getByLabel('Named reviewer').selectOption('manager-engineering')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByText('All changes saved')).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: 'Fit workflow to canvas' }).click()
  await expect(page.getByRole('group', { name: /Group Approval node Signalling Reviewer Group/ })).toContainText('Any one eligible member')
  await expect(page.getByRole('group', { name: /Individual Approval node Engineering Manager/ })).toContainText('Engineering Manager')
  expect(await page.locator('.wf-edge-remove').count()).toBe(3)

  for (const connection of [
    'Start to Signalling Reviewer Group',
    'Signalling Reviewer Group to Engineering Manager',
    'Engineering Manager to Publish',
  ]) await page.getByRole('button', { name: `Remove connection from ${connection}` }).click()
  await page.getByRole('button', { name: 'Connect from Start' }).click()
  await page.getByRole('button', { name: 'Connect into Engineering Manager' }).click()
  await page.getByRole('button', { name: 'Connect from Engineering Manager' }).click()
  await page.getByRole('button', { name: 'Connect into Signalling Reviewer Group' }).click()
  await page.getByRole('button', { name: 'Connect from Signalling Reviewer Group' }).click()
  await page.getByRole('button', { name: 'Connect into Publish' }).click()
  await page.getByRole('button', { name: 'Preview route' }).click()
  const preview = page.getByRole('dialog', { name: 'Workflow route preview' })
  await expect(preview.locator('.wf-preview-item').nth(1)).toContainText('Engineering Manager')
  await expect(preview.locator('.wf-preview-item').nth(2)).toContainText('Signalling Reviewer Group')
  await page.getByRole('button', { name: 'Continue editing' }).click()

  for (const connection of [
    'Start to Engineering Manager',
    'Engineering Manager to Signalling Reviewer Group',
    'Signalling Reviewer Group to Publish',
  ]) await page.getByRole('button', { name: `Remove connection from ${connection}` }).click()
  await page.getByRole('button', { name: 'Connect from Start' }).click()
  await page.getByRole('button', { name: 'Connect into Signalling Reviewer Group' }).click()
  await page.getByRole('button', { name: 'Connect from Signalling Reviewer Group' }).click()
  await page.getByRole('button', { name: 'Connect into Engineering Manager' }).click()
  await page.getByRole('button', { name: 'Connect from Engineering Manager' }).click()
  await page.getByRole('button', { name: 'Connect into Publish' }).click()
  await page.getByRole('button', { name: 'Preview route' }).click()
  const finalPreview = page.getByRole('dialog', { name: 'Workflow route preview' })
  await expect(finalPreview.locator('.wf-preview-item').nth(1)).toContainText('Signalling Reviewer Group')
  await expect(finalPreview.locator('.wf-preview-item').nth(2)).toContainText('Engineering Manager')
  await page.getByRole('button', { name: 'Activate version' }).click()

  expect(fixture.state.activeWorkflow).toBeTruthy()
  expect(fixture.versions[0].status).toBe('active')
  const activeRoute = await page.evaluate(async () => {
    const response = await fetch('/api/approval-workflows/default?departmentId=dept-signalling')
    return response.json()
  })
  expect(activeRoute.data.stages.map((stage: any) => stage.type)).toEqual(['start', 'group', 'individual', 'publish'])
  await expect(canvas).toBeVisible()
})
