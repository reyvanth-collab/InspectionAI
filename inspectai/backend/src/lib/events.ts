import crypto from 'crypto'
import { query } from './db'

type Severity = 'info' | 'warning' | 'critical' | 'success'

interface AuditInput {
  tenantId: string
  userId?: string | null
  action: string
  entityType?: string | null
  entityId?: string | null
  severity?: 'info' | 'warning' | 'critical'
  detail?: Record<string, unknown> | null
}

interface NotificationInput {
  tenantId: string
  userId?: string | null
  title: string
  message: string
  severity?: Severity
  entityType?: string | null
  entityId?: string | null
}

export async function auditLog(input: AuditInput) {
  try {
    const payload = JSON.stringify({
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      severity: input.severity ?? 'info',
      detail: input.detail ?? null,
      at: new Date().toISOString(),
    })
    const hash = crypto.createHash('sha256').update(payload).digest('hex')

    await query(
      `INSERT INTO public.audit_logs
         (tenant_id, user_id, action, entity_type, entity_id, severity, detail, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.tenantId,
        input.userId ?? null,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.severity ?? 'info',
        input.detail ?? null,
        hash,
      ]
    )
  } catch (err) {
    console.warn('[audit] write failed:', err instanceof Error ? err.message : err)
  }
}

export async function createNotification(input: NotificationInput) {
  try {
    await query(
      `INSERT INTO public.notifications
         (tenant_id, user_id, title, message, severity, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.tenantId,
        input.userId ?? null,
        input.title,
        input.message,
        input.severity ?? 'info',
        input.entityType ?? null,
        input.entityId ?? null,
      ]
    )
  } catch (err) {
    console.warn('[notification] write failed:', err instanceof Error ? err.message : err)
  }
}

export async function notifyUsers(
  tenantId: string,
  userIds: string[],
  notification: Omit<NotificationInput, 'tenantId' | 'userId'>
) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))]
  await Promise.all(
    uniqueUserIds.map(userId => createNotification({ ...notification, tenantId, userId }))
  )
}

export async function notifyRoles(
  tenantId: string,
  roles: string[],
  notification: Omit<NotificationInput, 'tenantId' | 'userId'>
) {
  try {
    const result = await query(
      `SELECT id
       FROM public.users
       WHERE tenant_id = $1
         AND active = true
         AND lower(role::text) = ANY($2)`,
      [tenantId, roles.map(r => r.toLowerCase())]
    )
    await notifyUsers(
      tenantId,
      result.rows.map(row => row.id),
      notification
    )
  } catch (err) {
    console.warn('[notification] role lookup failed:', err instanceof Error ? err.message : err)
  }
}
