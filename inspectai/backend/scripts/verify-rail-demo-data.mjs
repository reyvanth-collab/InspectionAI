import { DEMO_TENANT, DEMO_NAME, departments } from './rail-demo-data.mjs'

export async function verifyRailDemo(get) {
  const user = (await get('/auth/me')).data
  if (user?.tenantId !== DEMO_TENANT || !user.capabilities?.includes('administrator')) {
    throw new Error('Use the dedicated rail-demo administrator account. This account belongs to a different workspace or has department-limited access. No access rules were changed.')
  }
  async function all(path) {
    const rows = []
    for (let page = 1; page <= 100; page++) {
      const response = await get(`${path}${path.includes('?') ? '&' : '?'}page=${page}`)
      if (!Array.isArray(response.data)) throw new Error('Unexpected dataset response')
      rows.push(...response.data)
      if (!response.meta?.hasMore) return rows
    }
    throw new Error('Dataset exceeded the verification limit')
  }
  const assets = await all('/assets?pageSize=100')
  const forms = await all('/work-instructions?status=active')
  const workOrders = await all('/inspections')
  const expected = departments.flatMap(department => department.forms.map((_, index) => `DEMO-${department.code}-F${index + 1}`))
  const fullForms = forms.filter(form => expected.includes(form.wi_number))
  for (const reference of expected) {
    const form = fullForms.find(value => value.wi_number === reference)
    if (!form || Number(form.checkable_item_count) < 10) throw new Error(`${reference} is missing a published form with at least 10 answerable questions. Run the guarded demo seed in the verified staging project.`)
  }
  const seededAssets = assets.filter(asset => String(asset.asset_number).startsWith('DEMO-'))
  if (seededAssets.length < 60 || workOrders.length < 20) throw new Error('Rail demo is incomplete: expected at least 60 sample assets and 20 work orders. Run the guarded demo seed in the verified staging project.')
  return { workspace: user.tenantName || DEMO_NAME, assets: seededAssets.length, publishedForms: new Set(fullForms.map(form => form.wi_number)).size, minimumQuestions: Math.min(...fullForms.map(form => Number(form.checkable_item_count))), workOrders: workOrders.length }
}
