import { Router } from 'express'
import { requireAuth, requireCapability, type AuthRequest } from '../middleware/auth'
import { pool, query, beginActorTransaction } from '../lib/db'

const router = Router()
router.use(requireAuth)
router.get('/', async (req: AuthRequest, res) => {
  const rows = await query(
    'SELECT id,code,name,active FROM public.departments WHERE tenant_id=$1 ORDER BY name',
    [req.user!.tenantId],
  )
  res.json({ data: rows.rows })
})
router.post('/', requireCapability('administrator'), async (req: AuthRequest, res) => {
  const code = String(req.body.code || '')
      .trim()
      .toUpperCase(),
    name = String(req.body.name || '').trim()
  if (!/^[A-Z0-9_-]{2,32}$/.test(code) || !name) {
    res.status(400).json({
      error: 'A department name and unique code (2–32 letters, digits, - or _) are required',
    })
    return
  }
  const result = await query(
    'INSERT INTO public.departments(tenant_id,code,name) VALUES($1,$2,$3) RETURNING *',
    [req.user!.tenantId, code, name],
  )
  res.status(201).json({ data: result.rows[0] })
})
router.put('/users/:id', requireCapability('administrator'), async (req: AuthRequest, res) => {
  const { primaryDepartmentId, departmentIds, capabilities } = req.body
  const allowed = [
    'inspector',
    'form_author',
    'form_approver',
    'viewer',
    'administrator',
    'asset_manager',
    'work_order_manager',
  ]
  if (req.params.id === req.user!.id) {
    res.status(403).json({ error: 'Another administrator must change your access' })
    return
  }
  if (
    !Array.isArray(departmentIds) ||
    !departmentIds.includes(primaryDepartmentId) ||
    !Array.isArray(capabilities) ||
    !capabilities.length ||
    capabilities.some((c: unknown) => !allowed.includes(String(c)))
  ) {
    res
      .status(400)
      .json({ error: 'Choose a primary department, memberships and supported capabilities' })
    return
  }
  const client = await pool.connect()
  try {
    await beginActorTransaction(client)
    const before = await client.query(
      'SELECT id,capabilities,primary_department_id FROM public.users WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
      [req.params.id, req.user!.tenantId],
    )
    const departments = await client.query(
      'SELECT id FROM public.departments WHERE tenant_id=$1 AND active AND id=ANY($2::uuid[])',
      [req.user!.tenantId, [...new Set(departmentIds)]],
    )
    const oldMemberships = await client.query(
      'SELECT department_id FROM public.department_memberships WHERE user_id=$1 AND tenant_id=$2',
      [req.params.id, req.user!.tenantId],
    )
    if (!before.rows.length || departments.rows.length !== new Set(departmentIds).size) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'User and departments must belong to this tenant' })
      return
    }
    await client.query(
      'UPDATE public.users SET primary_department_id=$1,capabilities=$2 WHERE id=$3 AND tenant_id=$4',
      [primaryDepartmentId, [...new Set(capabilities)], req.params.id, req.user!.tenantId],
    )
    await client.query(
      'DELETE FROM public.department_memberships WHERE user_id=$1 AND tenant_id=$2',
      [req.params.id, req.user!.tenantId],
    )
    for (const did of new Set(departmentIds))
      await client.query('INSERT INTO public.department_memberships VALUES($1,$2,$3)', [
        req.user!.tenantId,
        req.params.id,
        did,
      ])
    await client.query(
      "INSERT INTO public.audit_logs(tenant_id,user_id,action,entity_type,entity_id,detail) VALUES($1,$2,'user.access.updated','users',$3,$4)",
      [
        req.user!.tenantId,
        req.user!.id,
        req.params.id,
        {
          before: {
            ...before.rows[0],
            department_ids: oldMemberships.rows.map((row) => row.department_id),
          },
          after: {
            primary_department_id: primaryDepartmentId,
            department_ids: departmentIds,
            capabilities,
          },
          reason: req.body.reason || 'Administrator access change',
        },
      ],
    )
    await client.query('COMMIT')
    res.json({ data: { success: true } })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})
export default router
