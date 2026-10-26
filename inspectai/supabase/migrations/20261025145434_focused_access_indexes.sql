BEGIN;
CREATE INDEX department_memberships_tenant_user_idx ON public.department_memberships(tenant_id,user_id);
CREATE INDEX users_tenant_primary_department_idx ON public.users(tenant_id,primary_department_id);
CREATE INDEX work_instructions_previous_revision_idx ON public.work_instructions(previous_revision_id);
CREATE INDEX approval_steps_decided_by_idx ON public.approval_steps(decided_by);

-- Row-dependent department/assignment predicates are unchanged. Only constant
-- capability and actor lookups are evaluated once per statement (init plans).
ALTER POLICY order_scope ON public.work_orders USING (
 inspectai_private.department_access(tenant_id,department_id) AND (
 assigned_to=(SELECT nullif(current_setting('app.actor_id',true),'')::uuid)
 OR (SELECT inspectai_private.has_capability('viewer'))
 OR (SELECT inspectai_private.has_capability('work_order_manager'))
 ));
ALTER POLICY audit_scope ON public.audit_logs USING (
 ((SELECT inspectai_private.has_capability('administrator')) AND tenant_id=(
  SELECT u.tenant_id FROM public.users u WHERE u.id=(SELECT nullif(current_setting('app.actor_id',true),'')::uuid)
 )) OR (
 department_id IS NOT NULL AND inspectai_private.department_access(tenant_id,department_id)
 AND (work_order_id IS NULL OR inspectai_private.order_access(work_order_id))
 ));
COMMIT;
