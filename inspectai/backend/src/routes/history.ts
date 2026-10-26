import { Router } from 'express'
import { requireAuth, requireCapability, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'
const router = Router()
router.use(requireAuth)
router.get('/', async (req: AuthRequest, res) => {
  const { formId, workOrderId } = req.query
  if (!formId && !workOrderId) {
    requireCapability('administrator')(req, res, () => {})
    if (res.headersSent) return
  }
  const page = Math.max(1, parseInt(String(req.query.page || 1)) || 1),
    pageSize = 30
  const params: unknown[] = [req.user!.tenantId]
  let where = 'al.tenant_id=$1'
  if (formId) {
    params.push(formId)
    const family = `SELECT sibling.id FROM public.work_instructions sibling JOIN public.work_instructions selected ON selected.id=$${params.length}::uuid WHERE sibling.tenant_id=selected.tenant_id AND sibling.department_id=selected.department_id AND sibling.wi_number=selected.wi_number`
    where += ` AND (al.form_id IN (${family}) OR (al.entity_type IN ('work_instruction','work_instructions') AND al.entity_id IN (${family})))`
  }
  if (workOrderId) {
    params.push(workOrderId)
    where += ` AND al.work_order_id=$${params.length}`
  }
  const count = await query(
    `SELECT count(*)::int total FROM public.audit_logs al WHERE ${where}`,
    params,
  )
  const result = await query(
    `SELECT al.id,al.action,al.entity_type,al.entity_id,al.detail,al.created_at,al.form_id,al.work_order_id,u.name actor_name,wi.wi_number,wi.revision FROM public.audit_logs al LEFT JOIN public.users u ON u.id=al.user_id AND u.tenant_id=al.tenant_id LEFT JOIN public.work_instructions wi ON wi.id=al.form_id WHERE ${where} ORDER BY al.created_at DESC,al.id DESC LIMIT ${pageSize} OFFSET $${params.length + 1}`,
    [...params, (page - 1) * pageSize],
  )
  res.json({
    data: result.rows,
    meta: {
      page,
      pageSize,
      total: count.rows[0].total,
      hasMore: page * pageSize < count.rows[0].total,
    },
  })
})
export default router
