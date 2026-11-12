import { createHash } from 'node:crypto'
import { canonicalJson } from './signature'

type Run = (sql: string, params?: any[]) => Promise<any>

/** Exclude lifecycle timestamps that change when the submitted revision is published. */
export function submittedFormHash(form: Record<string, unknown>, items: unknown[]): string {
  const content = { ...form }
  delete content.status
  delete content.updated_at
  return createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify({ form: content, items })))).digest('hex')
}

export async function eligibleReviewers(run: Run, tenantId: string, formId: string, submitterId: string) {
  return (await run(
    `SELECT u.id,u.name,u.email FROM public.users u JOIN public.work_instructions wi ON wi.tenant_id=u.tenant_id
     WHERE wi.id=$2 AND u.tenant_id=$1 AND u.active
       AND ('form_approver'=ANY(u.capabilities) OR 'administrator'=ANY(u.capabilities))
       AND (u.primary_department_id=wi.department_id OR EXISTS(SELECT 1 FROM public.department_memberships dm WHERE dm.tenant_id=u.tenant_id AND dm.user_id=u.id AND dm.department_id=wi.department_id))
       AND u.id<>$3 AND u.id IS DISTINCT FROM wi.owner_id AND NOT inspectai_private.form_contributor(wi.id,u.id)
     ORDER BY u.id FOR SHARE OF u`, [tenantId, formId, submitterId],
  )).rows as Array<{ id: string; name: string; email: string }>
}
