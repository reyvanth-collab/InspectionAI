import type { AuthRequest } from '../middleware/auth'
export function workOrderFilters(req: AuthRequest) {
  const params: unknown[] = [req.user!.tenantId]
  let where = 'wo.tenant_id=$1'
  const text = (key: string) => String(req.query[key] || '').trim()
  for (const [key, column] of [
    ['woNumber', 'wo.wo_number'],
    ['asset', 'wo.asset_name'],
    ['location', 'wo.location'],
    ['wi', 'wi.wi_number'],
    ['inspector', 'u.name'],
  ] as const) {
    if (text(key)) {
      params.push(`%${text(key)}%`)
      where += ` AND ${column} ILIKE $${params.length}`
    }
  }
  if (text('search')) {
    params.push(`%${text('search')}%`)
    where += ` AND concat_ws(' ',wo.wo_number,wo.asset_number_snapshot,wo.asset_name,wo.location,wi.wi_number,wi.title,u.name) ILIKE $${params.length}`
  }
  if (text('status') && text('status') !== 'all') {
    params.push(text('status').replace('-', '_'))
    where += ` AND wo.status::text=$${params.length}`
  }
  if (text('dueDate')) {
    params.push(text('dueDate'))
    where += ` AND wo.due_date::text=$${params.length}`
  }
  if (text('departmentId')) {
    params.push(text('departmentId'))
    where += ` AND wo.department_id::text=$${params.length}`
  }
  return { params, where }
}
