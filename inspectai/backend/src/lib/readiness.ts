// Check the deployed database controls, not only connectivity. No customer rows
// or migration credentials are needed, and the public endpoint returns no detail.
export const READINESS_SQL = `
WITH required_guards(table_name, trigger_name) AS (VALUES
  ('inspection_findings','guard_finding'),
  ('inspection_records','guard_signed_record'),
  ('work_orders','guard_work_order'),
  ('wi_checklist_items','guard_instruction_items'),
  ('work_instructions','guard_instruction_revision'),
  ('work_orders','snapshot_order'),
  ('approval_steps','protect_approval_decision'),
  ('audit_logs','redact_audit'), ('inspection_drafts','guard_draft'), ('inspection_drafts','audit_draft')
), required_scopes(table_name, policy_name) AS (VALUES
  ('departments','department_scope'), ('department_memberships','membership_scope'),
  ('assets','asset_scope'), ('work_instructions','form_scope'),
  ('wi_checklist_items','item_scope'), ('work_orders','order_scope'),
  ('inspection_records','record_scope'), ('inspection_findings','finding_scope'),
  ('approval_records','approval_scope'), ('approval_steps','step_scope'),
  ('audit_logs','audit_scope'), ('notifications','notification_scope'),
  ('wi_revision_history','revision_scope')
)
SELECT
  (SELECT count(*)::int FROM required_guards g WHERE EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=g.table_name
      AND t.tgname=g.trigger_name AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
  )) AS guards,
  (SELECT count(*)::int FROM required_scopes s WHERE EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=s.table_name
      AND c.relrowsecurity AND p.polname=s.policy_name AND NOT p.polpermissive
      AND (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)=ANY(p.polroles)
  )) AS scopes,
  (SELECT c.relrowsecurity AND EXISTS(SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid AND p.polname='draft_scope') FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='inspection_drafts') AS draft_scope,
  (SELECT current_user='inspectai_runtime' AND NOT rolsuper AND NOT rolbypassrls
   FROM pg_catalog.pg_roles WHERE rolname=current_user) AS restricted_role
`
export function databaseReady(row: Record<string, unknown> | undefined): boolean {
  return (
    row?.guards === 10 &&
    row.draft_scope === true &&
    row.scopes === 13 &&
    row.restricted_role === true
  )
}
