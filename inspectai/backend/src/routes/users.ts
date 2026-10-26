import { Router } from 'express'
import { requireAuth, requireCapability, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'
import { auditLog } from '../lib/events'

const router = Router()

// GET /api/users — all users in tenant (admin only)
router.get(
  '/',
  requireAuth,
  requireCapability('administrator'),
  async (req: AuthRequest, res, next) => {
    try {
      const result = await query(
        `SELECT id, name, email, staff_id, role, capabilities, primary_department_id,
              ARRAY(SELECT m.department_id FROM public.department_memberships m WHERE m.user_id=users.id AND m.tenant_id=users.tenant_id) AS department_ids
       FROM   public.users
       WHERE  tenant_id = $1
       ORDER  BY name`,
        [req.user!.tenantId],
      )
      res.json({ data: result.rows })
    } catch (err) {
      next(err)
    }
  },
)

// GET /api/users/approvers — users who can approve (admin + approver roles)
router.get(
  '/approvers',
  requireAuth,
  requireCapability('form_author'),
  async (req: AuthRequest, res, next) => {
    try {
      const result = await query(
        `SELECT id, name, email, staff_id, role
       FROM   public.users
       WHERE  tenant_id = $1
         AND  active = true
         AND  ('form_approver'=ANY(capabilities) OR 'administrator'=ANY(capabilities))
         AND inspectai_private.department_access($1,$2::uuid)
         AND (primary_department_id=$2::uuid OR EXISTS(SELECT 1 FROM public.department_memberships m WHERE m.user_id=users.id AND m.tenant_id=$1 AND m.department_id=$2::uuid))
       ORDER  BY name`,
        [req.user!.tenantId, req.query.departmentId || req.user!.primaryDepartmentId],
      )
      res.json({ data: result.rows })
    } catch (err) {
      next(err)
    }
  },
)

router.get(
  '/assignable',
  requireAuth,
  requireCapability('work_order_manager'),
  async (req: AuthRequest, res) => {
    const params: unknown[] = [
      req.user!.tenantId,
      req.query.departmentId || req.user!.primaryDepartmentId,
    ]
    let where =
      "tenant_id=$1 AND active AND ('inspector'=ANY(capabilities) OR 'administrator'=ANY(capabilities))"
    {
      where +=
        ' AND inspectai_private.department_access($1,$2::uuid) AND (primary_department_id=$2::uuid OR EXISTS(SELECT 1 FROM public.department_memberships m WHERE m.user_id=users.id AND m.department_id=$2::uuid AND m.tenant_id=$1))'
    }
    const result = await query(
      'SELECT id,name,email,staff_id,role FROM public.users WHERE ' + where + ' ORDER BY name',
      params,
    )
    res.json({ data: result.rows })
  },
)

// PATCH /api/users/:id/role — update a user's role (admin only)
router.patch(
  '/:id/role',
  requireAuth,
  requireCapability('administrator'),
  async (req: AuthRequest, res, next) => {
    try {
      if (req.params.id === req.user!.id) {
        res.status(403).json({ error: 'Ask another administrator to change your role' })
        return
      }
      const { role } = req.body as { role: string }
      const allowedRoles = new Set(['admin', 'approver', 'inspector', 'viewer'])
      if (!allowedRoles.has(role)) {
        res.status(400).json({ error: 'Invalid role' })
        return
      }
      const result = await query(
        `UPDATE public.users SET role = $1, capabilities = CASE $1::text
       WHEN 'admin' THEN ARRAY['administrator','inspector','form_author','form_approver','viewer','asset_manager','work_order_manager']
       WHEN 'approver' THEN ARRAY['form_author','form_approver','viewer','asset_manager','work_order_manager']
       WHEN 'inspector' THEN ARRAY['inspector'] ELSE ARRAY['viewer'] END
       WHERE id = $2 AND tenant_id = $3 RETURNING id, email, role`,
        [role, req.params.id, req.user!.tenantId],
      )
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'User not found' })
        return
      }
      await auditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: 'user.role.updated',
        entityType: 'users',
        entityId: req.params.id,
        detail: { email: result.rows[0].email, role },
      })
      res.json({ data: { success: true } })
    } catch (err) {
      next(err)
    }
  },
)

export default router
