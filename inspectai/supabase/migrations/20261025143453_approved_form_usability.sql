-- Expiring is still a published revision until the actual expiry date.
BEGIN;
CREATE OR REPLACE FUNCTION public.guard_work_order() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE wi public.work_instructions;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status IN ('complete','cancelled') THEN RAISE EXCEPTION 'Closed work order is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='in_progress' AND NEW.work_instruction_id IS DISTINCT FROM OLD.work_instruction_id THEN RAISE EXCEPTION 'An inspection in progress cannot change checklist' USING ERRCODE='23514'; END IF;
 SELECT * INTO wi FROM public.work_instructions WHERE id=NEW.work_instruction_id AND tenant_id=NEW.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'An accessible inspection form is required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND (NEW.work_instruction_id IS DISTINCT FROM OLD.work_instruction_id OR (OLD.status='open' AND NEW.status='in_progress'))) THEN
  IF wi.status NOT IN ('active','expiring') OR (wi.expiry_date IS NOT NULL AND wi.expiry_date<CURRENT_DATE) OR (wi.effective_date IS NOT NULL AND wi.effective_date>CURRENT_DATE) THEN RAISE EXCEPTION 'An approved effective and unexpired instruction is required' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='complete' AND NOT EXISTS(SELECT 1 FROM public.inspection_records WHERE work_order_id=NEW.id AND tenant_id=NEW.tenant_id AND completed_at IS NOT NULL AND signed_payload IS NOT NULL) THEN RAISE EXCEPTION 'Signed inspection required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

-- Record the authenticated decision actor, including explicit administrator oversight.
ALTER TABLE public.approval_steps ADD COLUMN decided_by uuid REFERENCES public.users(id);
SELECT set_config('app.change_reason','Decision actor recovered from transactional approval history',true);
UPDATE public.approval_steps s SET decided_by=(SELECT a.user_id FROM public.audit_logs a WHERE a.entity_type='approval_steps' AND a.entity_id=s.id AND a.detail->'after'->>'status'=s.status::text AND a.user_id IS NOT NULL ORDER BY a.created_at DESC LIMIT 1) WHERE s.status IN ('done','rejected') AND EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.entity_type='approval_steps' AND a.entity_id=s.id AND a.detail->'after'->>'status'=s.status::text AND a.user_id IS NOT NULL);
CREATE OR REPLACE FUNCTION inspectai_private.protect_approval_decision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ar public.approval_records; wi public.work_instructions; actor uuid;
BEGIN
 IF NEW.status IN ('done','rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
  IF OLD.status<>'active' THEN RAISE EXCEPTION 'Only the active review can be decided' USING ERRCODE='23514'; END IF;
  actor=nullif(current_setting('app.actor_id',true),'')::uuid;
  SELECT * INTO ar FROM public.approval_records WHERE id=NEW.approval_record_id AND tenant_id=NEW.tenant_id;
  SELECT * INTO wi FROM public.work_instructions WHERE id=ar.work_instruction_id AND tenant_id=NEW.tenant_id;
  IF actor IS NULL OR NOT inspectai_private.has_capability('form_approver') OR NOT inspectai_private.department_access(NEW.tenant_id,wi.department_id) THEN RAISE EXCEPTION 'An authorised departmental reviewer is required' USING ERRCODE='23514'; END IF;
  IF actor=ar.submitted_by OR actor=wi.owner_id OR inspectai_private.form_contributor(wi.id,actor) THEN RAISE EXCEPTION 'Form contributors cannot approve or reject their own revision' USING ERRCODE='23514'; END IF;
  IF actor IS DISTINCT FROM NEW.approver_id AND NOT inspectai_private.has_capability('administrator') THEN RAISE EXCEPTION 'The review is assigned to another reviewer' USING ERRCODE='23514'; END IF;
  IF actor IS DISTINCT FROM NEW.approver_id AND nullif(trim(NEW.comment),'') IS NULL THEN RAISE EXCEPTION 'An administrator override needs a review comment' USING ERRCODE='23514'; END IF;
  NEW.decided_by=actor;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
