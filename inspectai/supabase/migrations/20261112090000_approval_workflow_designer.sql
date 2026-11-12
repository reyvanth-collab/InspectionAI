BEGIN;

CREATE TABLE public.person_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  department_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, department_id) REFERENCES public.departments(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES public.users(tenant_id,id)
);
CREATE UNIQUE INDEX person_groups_name_unique ON public.person_groups(tenant_id, lower(name));

CREATE TABLE public.person_group_members (
  tenant_id uuid NOT NULL,
  person_group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_group_id, user_id),
  FOREIGN KEY (tenant_id, person_group_id) REFERENCES public.person_groups(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES public.users(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX person_group_members_user_idx ON public.person_group_members(tenant_id, user_id);

CREATE TABLE public.approval_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_code text NOT NULL CHECK (workflow_code ~ '^[A-Z0-9_-]{2,40}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, workflow_code),
  FOREIGN KEY (tenant_id, created_by) REFERENCES public.users(tenant_id,id)
);

CREATE TABLE public.approval_workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  applicability_department_id uuid,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  graph jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb CHECK (jsonb_typeof(graph) = 'object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, workflow_id, version_number),
  FOREIGN KEY (tenant_id, workflow_id) REFERENCES public.approval_workflows(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, applicability_department_id) REFERENCES public.departments(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES public.users(tenant_id,id)
);
CREATE UNIQUE INDEX approval_workflow_one_active_version
  ON public.approval_workflow_versions(tenant_id, workflow_id) WHERE status = 'active';
CREATE UNIQUE INDEX approval_workflow_default_scope
  ON public.approval_workflow_versions(tenant_id, COALESCE(applicability_department_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'active' AND is_default;
CREATE INDEX approval_workflow_versions_tenant_idx
  ON public.approval_workflow_versions(tenant_id, workflow_id, version_number DESC);

ALTER TABLE public.approval_records
  ADD COLUMN workflow_version_id uuid,
  ADD COLUMN route_snapshot jsonb,
  ADD COLUMN submitted_snapshot jsonb,
  ADD COLUMN submitted_hash text;
ALTER TABLE public.approval_records
  ADD CONSTRAINT approval_records_workflow_version_fk
  FOREIGN KEY (tenant_id, workflow_version_id)
  REFERENCES public.approval_workflow_versions(tenant_id, id) ON DELETE RESTRICT;

-- One row per assigned reviewer; rows at the same step_number form a group stage.
ALTER TABLE public.approval_steps
  ADD COLUMN assigned_name text,
  ADD COLUMN group_rule text NOT NULL DEFAULT 'any' CHECK (group_rule IN ('any', 'all')),
  ADD COLUMN stage_size integer NOT NULL DEFAULT 1 CHECK (stage_size > 0),
  ADD COLUMN skipped boolean NOT NULL DEFAULT false;
CREATE INDEX approval_steps_current_stage_idx
  ON public.approval_steps(approval_record_id, step_number, status) WHERE skipped = false;
ALTER TABLE public.approval_steps ADD CONSTRAINT approval_step_tenant_identity UNIQUE(tenant_id,id);

ALTER TABLE public.person_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_workflow_versions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.person_groups, public.person_group_members,
  public.approval_workflows, public.approval_workflow_versions TO inspectai_runtime;
GRANT DELETE ON public.person_group_members TO inspectai_runtime;
REVOKE ALL ON public.person_groups, public.person_group_members, public.approval_workflows, public.approval_workflow_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT, INSERT, UPDATE ON public.approval_records, public.approval_steps TO inspectai_runtime;

CREATE POLICY api_runtime_access ON public.person_groups TO inspectai_runtime USING (true) WITH CHECK (true);
CREATE POLICY person_groups_admin_scope ON public.person_groups AS RESTRICTIVE TO inspectai_runtime
  USING ((inspectai_private.has_capability('administrator') OR inspectai_private.has_capability('form_author')) AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = nullif(current_setting('app.actor_id', true), '')::uuid AND u.tenant_id = person_groups.tenant_id))
  WITH CHECK (inspectai_private.has_capability('administrator') AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = nullif(current_setting('app.actor_id', true), '')::uuid AND u.tenant_id = person_groups.tenant_id));
CREATE POLICY api_runtime_access ON public.person_group_members TO inspectai_runtime USING (true) WITH CHECK (true);
CREATE POLICY person_group_members_admin_scope ON public.person_group_members AS RESTRICTIVE TO inspectai_runtime
  USING ((inspectai_private.has_capability('administrator') OR inspectai_private.has_capability('form_author')) AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = nullif(current_setting('app.actor_id', true), '')::uuid AND u.tenant_id = person_group_members.tenant_id))
  WITH CHECK (inspectai_private.has_capability('administrator') AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = nullif(current_setting('app.actor_id', true), '')::uuid AND u.tenant_id = person_group_members.tenant_id));
CREATE POLICY person_group_members_delete_admin ON public.person_group_members AS RESTRICTIVE FOR DELETE TO inspectai_runtime USING (inspectai_private.has_capability('administrator'));
CREATE POLICY api_runtime_access ON public.approval_workflows TO inspectai_runtime USING (true) WITH CHECK (true);
CREATE POLICY approval_workflows_admin_scope ON public.approval_workflows AS RESTRICTIVE TO inspectai_runtime
  USING ((inspectai_private.has_capability('administrator') OR inspectai_private.has_capability('form_author')) AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = nullif(current_setting('app.actor_id', true), '')::uuid AND u.tenant_id = approval_workflows.tenant_id))
  WITH CHECK (inspectai_private.has_capability('administrator') AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = nullif(current_setting('app.actor_id', true), '')::uuid AND u.tenant_id = approval_workflows.tenant_id));
CREATE POLICY api_runtime_access ON public.approval_workflow_versions TO inspectai_runtime USING (true) WITH CHECK (true);
CREATE POLICY approval_workflow_versions_admin_scope ON public.approval_workflow_versions AS RESTRICTIVE TO inspectai_runtime
  USING ((inspectai_private.has_capability('administrator') OR (status='active' AND is_default AND inspectai_private.has_capability('form_author'))) AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = nullif(current_setting('app.actor_id', true), '')::uuid AND u.tenant_id = approval_workflow_versions.tenant_id))
  WITH CHECK (inspectai_private.has_capability('administrator') AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = nullif(current_setting('app.actor_id', true), '')::uuid AND u.tenant_id = approval_workflow_versions.tenant_id));

CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.person_groups FOR EACH ROW EXECUTE FUNCTION public.audit_business_change();
CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.person_group_members FOR EACH ROW EXECUTE FUNCTION public.audit_business_change();
CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.approval_workflows FOR EACH ROW EXECUTE FUNCTION public.audit_business_change();
CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.approval_workflow_versions FOR EACH ROW EXECUTE FUNCTION public.audit_business_change();

-- Replacements fill one pending reviewer slot; the original submitted route stays immutable.
CREATE TABLE public.approval_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  step_id uuid NOT NULL,
  previous_reviewer_id uuid NOT NULL,
  replacement_reviewer_id uuid NOT NULL,
  changed_by uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,step_id) REFERENCES public.approval_steps(tenant_id,id),
  FOREIGN KEY (tenant_id,previous_reviewer_id) REFERENCES public.users(tenant_id,id),
  FOREIGN KEY (tenant_id,replacement_reviewer_id) REFERENCES public.users(tenant_id,id),
  FOREIGN KEY (tenant_id,changed_by) REFERENCES public.users(tenant_id,id)
);
CREATE INDEX approval_reassignments_step_idx ON public.approval_reassignments(tenant_id,step_id);
ALTER TABLE public.approval_reassignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.approval_reassignments TO inspectai_runtime;
REVOKE ALL ON public.approval_reassignments FROM PUBLIC,anon,authenticated;
CREATE POLICY assignment_read ON public.approval_reassignments FOR SELECT TO inspectai_runtime USING (
  EXISTS(SELECT 1 FROM public.approval_steps s WHERE s.id=step_id AND s.tenant_id=approval_reassignments.tenant_id));
CREATE POLICY assignment_insert ON public.approval_reassignments FOR INSERT TO inspectai_runtime WITH CHECK (
  inspectai_private.has_capability('administrator') AND changed_by=nullif(current_setting('app.actor_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM public.approval_steps s WHERE s.id=step_id AND s.tenant_id=approval_reassignments.tenant_id));
CREATE TRIGGER audit_business_change AFTER INSERT ON public.approval_reassignments FOR EACH ROW EXECUTE FUNCTION public.audit_business_change();

CREATE FUNCTION inspectai_private.guard_workflow_history() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='approval_workflow_versions' THEN
    IF OLD.status<>'draft' AND ((to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at') OR NOT (OLD.status='active' AND NEW.status='retired')) THEN
      RAISE EXCEPTION 'Create a new draft version to edit an activated workflow' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='approval_records' THEN
    IF NEW.route_snapshot IS DISTINCT FROM OLD.route_snapshot OR NEW.workflow_version_id IS DISTINCT FROM OLD.workflow_version_id
      OR NEW.submitted_snapshot IS DISTINCT FROM OLD.submitted_snapshot OR NEW.submitted_hash IS DISTINCT FROM OLD.submitted_hash
      OR NEW.work_instruction_id IS DISTINCT FROM OLD.work_instruction_id OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
      OR (OLD.final_status<>'active' AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION 'Approval run history is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.final_status='active' AND NEW.final_status='done' AND (NOT EXISTS(SELECT 1 FROM public.approval_steps s WHERE s.approval_record_id=OLD.id) OR EXISTS(SELECT 1 FROM public.approval_steps s WHERE s.approval_record_id=OLD.id AND NOT s.skipped AND s.status<>'done')) THEN
      RAISE EXCEPTION 'Every required reviewer slot must pass before publication' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_workflow_history BEFORE UPDATE ON public.approval_workflow_versions FOR EACH ROW EXECUTE FUNCTION inspectai_private.guard_workflow_history();
CREATE TRIGGER guard_workflow_history BEFORE UPDATE ON public.approval_records FOR EACH ROW EXECUTE FUNCTION inspectai_private.guard_workflow_history();

CREATE FUNCTION inspectai_private.guard_workflow_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ar public.approval_records;
BEGIN
  SELECT * INTO ar FROM public.approval_records WHERE id=NEW.approval_record_id AND tenant_id=NEW.tenant_id;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.approval_record_id IS DISTINCT FROM OLD.approval_record_id OR NEW.step_number IS DISTINCT FROM OLD.step_number OR NEW.group_rule IS DISTINCT FROM OLD.group_rule OR NEW.stage_size IS DISTINCT FROM OLD.stage_size THEN
    RAISE EXCEPTION 'The submitted stage and approval rule are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.skipped AND NOT OLD.skipped AND ar.final_status<>'rejected' AND NOT (OLD.group_rule='any' AND EXISTS(SELECT 1 FROM public.approval_steps s WHERE s.approval_record_id=OLD.approval_record_id AND s.step_number=OLD.step_number AND s.id<>OLD.id AND s.status='done')) THEN
    RAISE EXCEPTION 'A required approval slot cannot be removed' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('done','rejected') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A completed approval decision is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.approver_id IS DISTINCT FROM OLD.approver_id THEN
    IF ar.final_status<>'active' OR OLD.skipped OR OLD.status NOT IN ('active','wait') OR NOT inspectai_private.has_capability('administrator') OR nullif(trim(current_setting('app.change_reason',true)),'') IS NULL THEN
      RAISE EXCEPTION 'A pending assignment needs an authorised, reasoned reassignment' USING ERRCODE='23514';
    END IF;
  END IF;
  IF ar.workflow_version_id IS NOT NULL AND NEW.status IN ('done','rejected') AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF ar.final_status<>'active' OR ar.current_step<>NEW.step_number OR OLD.skipped OR NEW.approver_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid THEN
      RAISE EXCEPTION 'Only the current assigned workflow reviewer can decide' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_workflow_assignment BEFORE UPDATE ON public.approval_steps FOR EACH ROW EXECUTE FUNCTION inspectai_private.guard_workflow_assignment();

COMMIT;
