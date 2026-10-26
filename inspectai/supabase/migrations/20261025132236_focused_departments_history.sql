BEGIN;
CREATE TABLE public.departments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,32}$'), name text NOT NULL CHECK(length(trim(name))>0),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,code), UNIQUE(tenant_id,id)
);
CREATE TABLE public.department_memberships (
 tenant_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES public.users(id), department_id uuid NOT NULL,
 PRIMARY KEY(user_id,department_id), FOREIGN KEY(tenant_id,department_id) REFERENCES public.departments(tenant_id,id)
);
ALTER TABLE public.users ADD CONSTRAINT user_tenant_identity UNIQUE(tenant_id,id);
ALTER TABLE public.department_memberships ADD CONSTRAINT member_tenant_identity FOREIGN KEY(tenant_id,user_id) REFERENCES public.users(tenant_id,id);
ALTER TABLE public.users ADD COLUMN primary_department_id uuid;
ALTER TABLE public.users ADD COLUMN capabilities text[];
ALTER TABLE public.work_instructions ADD COLUMN department_id uuid;
ALTER TABLE public.work_instructions ADD COLUMN previous_revision_id uuid REFERENCES public.work_instructions(id);
ALTER TABLE public.assets ADD COLUMN department_id uuid;
ALTER TABLE public.work_orders ADD COLUMN department_id uuid;
ALTER TABLE public.work_orders ADD COLUMN asset_number_snapshot text;
ALTER TABLE public.work_orders ADD COLUMN department_name_snapshot text;
ALTER TABLE public.wi_checklist_items ADD COLUMN lineage_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.audit_logs ADD COLUMN department_id uuid;
ALTER TABLE public.audit_logs ADD COLUMN form_id uuid;
ALTER TABLE public.audit_logs ADD COLUMN work_order_id uuid;

INSERT INTO public.departments(tenant_id,code,name) SELECT id,'GENERAL','General (legacy allocation)' FROM public.tenants;
INSERT INTO public.departments(tenant_id,code,name)
 SELECT DISTINCT tenant_id,'LEGACY-'||upper(substr(md5(lower(trim(department))),1,12)),trim(department)
 FROM public.users WHERE nullif(trim(department),'') IS NOT NULL ON CONFLICT(tenant_id,code) DO NOTHING;
ALTER TABLE public.users DISABLE TRIGGER trg_users_updated_at;
ALTER TABLE public.work_instructions DISABLE TRIGGER trg_wi_updated_at;
ALTER TABLE public.assets DISABLE TRIGGER trg_assets_updated_at;
ALTER TABLE public.work_orders DISABLE TRIGGER trg_wo_updated_at;
UPDATE public.users u SET primary_department_id=d.id FROM public.departments d
 WHERE u.tenant_id=d.tenant_id AND d.code=CASE WHEN nullif(trim(u.department),'') IS NULL THEN 'GENERAL' ELSE 'LEGACY-'||upper(substr(md5(lower(trim(u.department))),1,12)) END;
UPDATE public.users SET capabilities=CASE role::text
 WHEN 'admin' THEN ARRAY['administrator','inspector','form_author','form_approver','viewer','asset_manager','work_order_manager']
 WHEN 'approver' THEN ARRAY['form_author','form_approver','viewer','asset_manager','work_order_manager']
 WHEN 'inspector' THEN ARRAY['inspector'] ELSE ARRAY['viewer'] END;
INSERT INTO public.department_memberships SELECT tenant_id,id,primary_department_id FROM public.users;
-- No legacy asset/form ownership field exists. Creator department is not reliable
-- ownership evidence. Keep these records together in an explicit legacy allocation,
-- preserving pre-existing tenant access without granting new departmental access.
INSERT INTO public.department_memberships(tenant_id,user_id,department_id)
 SELECT u.tenant_id,u.id,d.id FROM public.users u JOIN public.departments d ON d.tenant_id=u.tenant_id AND d.code='GENERAL' ON CONFLICT DO NOTHING;
-- Backfill only new ownership columns inside this transaction. Restore guards immediately.
ALTER TABLE public.work_instructions DISABLE TRIGGER guard_instruction_revision;
UPDATE public.work_instructions w SET department_id=(SELECT id FROM public.departments WHERE tenant_id=w.tenant_id AND code='GENERAL');
ALTER TABLE public.work_instructions ENABLE TRIGGER guard_instruction_revision;
UPDATE public.assets a SET department_id=(SELECT id FROM public.departments WHERE tenant_id=a.tenant_id AND code='GENERAL');
ALTER TABLE public.work_orders DISABLE TRIGGER guard_work_order;
UPDATE public.work_orders w SET department_id=coalesce((SELECT department_id FROM public.assets WHERE id=w.asset_record_id AND tenant_id=w.tenant_id),(SELECT id FROM public.departments WHERE tenant_id=w.tenant_id AND code='GENERAL')),
 asset_number_snapshot=coalesce(w.asset_id,(SELECT asset_number FROM public.assets WHERE id=w.asset_record_id AND tenant_id=w.tenant_id)),
 department_name_snapshot=(SELECT name FROM public.departments WHERE id=coalesce((SELECT department_id FROM public.assets WHERE id=w.asset_record_id AND tenant_id=w.tenant_id),(SELECT id FROM public.departments WHERE tenant_id=w.tenant_id AND code='GENERAL')));
ALTER TABLE public.work_orders ENABLE TRIGGER guard_work_order;
ALTER TABLE public.users ENABLE TRIGGER trg_users_updated_at;
ALTER TABLE public.work_instructions ENABLE TRIGGER trg_wi_updated_at;
ALTER TABLE public.assets ENABLE TRIGGER trg_assets_updated_at;
ALTER TABLE public.work_orders ENABLE TRIGGER trg_wo_updated_at;

CREATE FUNCTION inspectai_private.default_department() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE did uuid;
BEGIN
 IF TG_TABLE_NAME='users' THEN
  INSERT INTO public.departments(tenant_id,code,name) VALUES(NEW.tenant_id,'GENERAL','General (legacy allocation)') ON CONFLICT(tenant_id,code) DO NOTHING;
  SELECT id INTO did FROM public.departments WHERE tenant_id=NEW.tenant_id AND code='GENERAL';
  NEW.primary_department_id=coalesce(NEW.primary_department_id,did);
  NEW.capabilities=coalesce(NEW.capabilities,CASE NEW.role::text WHEN 'admin' THEN ARRAY['administrator','inspector','form_author','form_approver','viewer','asset_manager','work_order_manager'] WHEN 'approver' THEN ARRAY['form_author','form_approver','viewer','asset_manager','work_order_manager'] WHEN 'inspector' THEN ARRAY['inspector'] ELSE ARRAY['viewer'] END);
 ELSE
  SELECT primary_department_id INTO did FROM public.users WHERE id=nullif(current_setting('app.actor_id',true),'')::uuid AND tenant_id=NEW.tenant_id;
  NEW.department_id=coalesce(NEW.department_id,did,(SELECT id FROM public.departments WHERE tenant_id=NEW.tenant_id AND code='GENERAL'));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER default_department BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION inspectai_private.default_department();
CREATE TRIGGER default_department BEFORE INSERT ON public.assets FOR EACH ROW EXECUTE FUNCTION inspectai_private.default_department();
CREATE TRIGGER default_department BEFORE INSERT ON public.work_instructions FOR EACH ROW EXECUTE FUNCTION inspectai_private.default_department();
CREATE FUNCTION inspectai_private.primary_membership() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN INSERT INTO public.department_memberships VALUES(NEW.tenant_id,NEW.id,NEW.primary_department_id) ON CONFLICT DO NOTHING; RETURN NEW; END $$;
CREATE TRIGGER primary_membership AFTER INSERT OR UPDATE OF primary_department_id ON public.users FOR EACH ROW EXECUTE FUNCTION inspectai_private.primary_membership();

ALTER TABLE public.users ALTER COLUMN primary_department_id SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN capabilities SET NOT NULL;
ALTER TABLE public.users ADD CONSTRAINT user_department_tenant FOREIGN KEY(tenant_id,primary_department_id) REFERENCES public.departments(tenant_id,id);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['assets','work_instructions','work_orders'] LOOP
 EXECUTE format('ALTER TABLE public.%I ALTER COLUMN department_id SET NOT NULL',t);
 EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT department_tenant FOREIGN KEY(tenant_id,department_id) REFERENCES public.departments(tenant_id,id)',t);
 EXECUTE format('CREATE INDEX ON public.%I(tenant_id,department_id)',t);
END LOOP; END $$;
CREATE INDEX ON public.department_memberships(tenant_id,department_id,user_id);
CREATE INDEX ON public.audit_logs(tenant_id,form_id,created_at DESC);
CREATE INDEX ON public.audit_logs(tenant_id,work_order_id,created_at DESC);

-- Private RLS helpers use only the actor set by the authenticated backend transaction.
-- Browser roles have neither schema usage nor execute permission. Definer is needed
-- to avoid recursive membership/parent policies; no arbitrary SQL or writes occur here.
CREATE FUNCTION inspectai_private.has_capability(cap text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.users WHERE id=nullif(current_setting('app.actor_id',true),'')::uuid AND active AND (cap=ANY(capabilities) OR 'administrator'=ANY(capabilities)))
$$;
CREATE FUNCTION inspectai_private.department_access(tid uuid,did uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id=nullif(current_setting('app.actor_id',true),'')::uuid AND u.active AND u.tenant_id=tid AND
 ('administrator'=ANY(u.capabilities) OR u.primary_department_id=did OR EXISTS(SELECT 1 FROM public.department_memberships m WHERE m.user_id=u.id AND m.tenant_id=tid AND m.department_id=did)))
$$;
CREATE FUNCTION inspectai_private.order_access(oid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.work_orders w JOIN public.users u ON u.id=nullif(current_setting('app.actor_id',true),'')::uuid
 WHERE w.id=oid AND u.active AND u.tenant_id=w.tenant_id AND inspectai_private.department_access(w.tenant_id,w.department_id)
 AND (NOT ('inspector'=ANY(u.capabilities)) OR 'viewer'=ANY(u.capabilities) OR 'administrator'=ANY(u.capabilities) OR 'work_order_manager'=ANY(u.capabilities) OR w.assigned_to=u.id))
$$;
CREATE FUNCTION inspectai_private.form_access(fid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.work_instructions w WHERE w.id=fid AND inspectai_private.department_access(w.tenant_id,w.department_id))
$$;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_memberships ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.departments,public.department_memberships TO inspectai_runtime;
GRANT DELETE ON public.department_memberships TO inspectai_runtime;
CREATE POLICY api_runtime_access ON public.departments TO inspectai_runtime USING(true) WITH CHECK(true);
CREATE POLICY api_runtime_access ON public.department_memberships TO inspectai_runtime USING(true) WITH CHECK(true);
CREATE POLICY department_scope ON public.departments AS RESTRICTIVE TO inspectai_runtime USING(inspectai_private.department_access(tenant_id,id)) WITH CHECK(inspectai_private.has_capability('administrator'));
CREATE POLICY membership_scope ON public.department_memberships AS RESTRICTIVE TO inspectai_runtime USING(inspectai_private.department_access(tenant_id,department_id)) WITH CHECK(inspectai_private.has_capability('administrator'));
CREATE POLICY asset_scope ON public.assets AS RESTRICTIVE TO inspectai_runtime USING(inspectai_private.department_access(tenant_id,department_id)) WITH CHECK(inspectai_private.department_access(tenant_id,department_id));
CREATE POLICY form_scope ON public.work_instructions AS RESTRICTIVE TO inspectai_runtime USING(inspectai_private.department_access(tenant_id,department_id)) WITH CHECK(inspectai_private.department_access(tenant_id,department_id));
CREATE POLICY item_scope ON public.wi_checklist_items AS RESTRICTIVE TO inspectai_runtime USING(inspectai_private.form_access(work_instruction_id)) WITH CHECK(inspectai_private.form_access(work_instruction_id));
CREATE POLICY revision_scope ON public.wi_revision_history AS RESTRICTIVE TO inspectai_runtime USING(inspectai_private.form_access(work_instruction_id)) WITH CHECK(inspectai_private.form_access(work_instruction_id));
CREATE POLICY order_scope ON public.work_orders AS RESTRICTIVE TO inspectai_runtime USING(inspectai_private.department_access(tenant_id,department_id) AND (assigned_to=nullif(current_setting('app.actor_id',true),'')::uuid OR inspectai_private.has_capability('viewer') OR inspectai_private.has_capability('work_order_manager'))) WITH CHECK(inspectai_private.department_access(tenant_id,department_id));
CREATE POLICY record_scope ON public.inspection_records AS RESTRICTIVE TO inspectai_runtime USING(inspectai_private.order_access(work_order_id)) WITH CHECK(inspectai_private.order_access(work_order_id));
CREATE POLICY finding_scope ON public.inspection_findings AS RESTRICTIVE TO inspectai_runtime USING(EXISTS(SELECT 1 FROM public.inspection_records r WHERE r.id=inspection_record_id)) WITH CHECK(EXISTS(SELECT 1 FROM public.inspection_records r WHERE r.id=inspection_record_id));
CREATE POLICY approval_scope ON public.approval_records AS RESTRICTIVE TO inspectai_runtime USING(inspectai_private.form_access(work_instruction_id)) WITH CHECK(inspectai_private.form_access(work_instruction_id));
CREATE POLICY step_scope ON public.approval_steps AS RESTRICTIVE TO inspectai_runtime USING(EXISTS(SELECT 1 FROM public.approval_records r WHERE r.id=approval_record_id)) WITH CHECK(EXISTS(SELECT 1 FROM public.approval_records r WHERE r.id=approval_record_id));
CREATE POLICY audit_scope ON public.audit_logs AS RESTRICTIVE TO inspectai_runtime USING(
 (inspectai_private.has_capability('administrator') AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=nullif(current_setting('app.actor_id',true),'')::uuid AND u.tenant_id=audit_logs.tenant_id))
 OR (department_id IS NOT NULL AND inspectai_private.department_access(tenant_id,department_id) AND (work_order_id IS NULL OR inspectai_private.order_access(work_order_id)))
) WITH CHECK(true);

-- An immutable server snapshot, taken only on creation. Later asset edits never
-- rewrite historical work orders or existing signed payloads.
CREATE FUNCTION inspectai_private.snapshot_order() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.assets; f public.work_instructions;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=NEW.assigned_to AND u.tenant_id=NEW.tenant_id AND u.active AND ('inspector'=ANY(u.capabilities) OR 'administrator'=ANY(u.capabilities)) AND (u.primary_department_id=OLD.department_id OR EXISTS(SELECT 1 FROM public.department_memberships m WHERE m.user_id=u.id AND m.department_id=OLD.department_id))) THEN RAISE EXCEPTION 'Assigned inspector must belong to the asset department' USING ERRCODE='23514'; END IF;
  IF NEW.work_instruction_id IS DISTINCT FROM OLD.work_instruction_id AND NOT EXISTS(SELECT 1 FROM public.work_instructions w WHERE w.id=NEW.work_instruction_id AND w.tenant_id=NEW.tenant_id AND w.department_id=OLD.department_id) THEN RAISE EXCEPTION 'Asset and form must have the same department' USING ERRCODE='23514'; END IF;
  IF (NEW.asset_record_id,NEW.asset_name,NEW.asset_number_snapshot,NEW.location,NEW.department_id,NEW.department_name_snapshot) IS DISTINCT FROM (OLD.asset_record_id,OLD.asset_name,OLD.asset_number_snapshot,OLD.location,OLD.department_id,OLD.department_name_snapshot) THEN RAISE EXCEPTION 'Asset snapshots cannot be rewritten' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO a FROM public.assets WHERE id=NEW.asset_record_id AND tenant_id=NEW.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'A registered accessible asset is required' USING ERRCODE='23514'; END IF;
 SELECT * INTO f FROM public.work_instructions WHERE id=NEW.work_instruction_id AND tenant_id=NEW.tenant_id;
 IF f.department_id IS DISTINCT FROM a.department_id THEN RAISE EXCEPTION 'Asset and form must have the same department' USING ERRCODE='23514'; END IF;
 IF NEW.assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=NEW.assigned_to AND u.tenant_id=NEW.tenant_id AND u.active AND ('inspector'=ANY(u.capabilities) OR 'administrator'=ANY(u.capabilities)) AND (u.primary_department_id=a.department_id OR EXISTS(SELECT 1 FROM public.department_memberships m WHERE m.user_id=u.id AND m.department_id=a.department_id))) THEN RAISE EXCEPTION 'Assigned inspector must belong to the asset department' USING ERRCODE='23514'; END IF;
 NEW.department_id=a.department_id; NEW.asset_name=a.name; NEW.asset_number_snapshot=a.asset_number; NEW.location=a.location;
 SELECT name INTO NEW.department_name_snapshot FROM public.departments WHERE id=a.department_id;
 RETURN NEW;
END $$;
CREATE TRIGGER snapshot_order BEFORE INSERT OR UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION inspectai_private.snapshot_order();

CREATE OR REPLACE FUNCTION public.audit_business_change() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE rowdata jsonb; beforedata jsonb; afterdata jsonb; fid uuid; oid uuid; did uuid; actor uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN beforedata=to_jsonb(OLD)-ARRAY['signature_data_url','signed_payload','photo_urls','encrypted_password','password','token']; END IF;
 IF TG_OP<>'DELETE' THEN afterdata=to_jsonb(NEW)-ARRAY['signature_data_url','signed_payload','photo_urls','encrypted_password','password','token']; END IF;
 rowdata=coalesce(afterdata,beforedata); actor=nullif(current_setting('app.actor_id',true),'')::uuid;
 IF TG_TABLE_NAME='work_instructions' THEN fid=(rowdata->>'id')::uuid;
 ELSIF TG_TABLE_NAME IN ('wi_checklist_items','wi_revision_history','approval_records') THEN fid=(rowdata->>'work_instruction_id')::uuid;
 ELSIF TG_TABLE_NAME='approval_steps' THEN SELECT work_instruction_id INTO fid FROM public.approval_records WHERE id=(rowdata->>'approval_record_id')::uuid;
 ELSIF TG_TABLE_NAME='work_orders' THEN oid=(rowdata->>'id')::uuid;
 ELSIF TG_TABLE_NAME='inspection_records' THEN oid=(rowdata->>'work_order_id')::uuid;
 ELSIF TG_TABLE_NAME='inspection_findings' THEN SELECT work_order_id INTO oid FROM public.inspection_records WHERE id=(rowdata->>'inspection_record_id')::uuid;
 END IF;
 IF fid IS NOT NULL THEN SELECT department_id INTO did FROM public.work_instructions WHERE id=fid;
 ELSIF oid IS NOT NULL THEN SELECT department_id INTO did FROM public.work_orders WHERE id=oid;
 ELSE did=coalesce((rowdata->>'department_id')::uuid,(rowdata->>'primary_department_id')::uuid); END IF;
 INSERT INTO public.audit_logs(tenant_id,user_id,action,entity_type,entity_id,department_id,form_id,work_order_id,detail)
 VALUES((rowdata->>'tenant_id')::uuid,actor,lower(TG_OP)||'.'||TG_TABLE_NAME,TG_TABLE_NAME,(rowdata->>'id')::uuid,did,fid,oid,
 jsonb_build_object('before',beforedata,'after',afterdata,'reason',nullif(current_setting('app.change_reason',true),'')));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.wi_checklist_items FOR EACH ROW EXECUTE FUNCTION public.audit_business_change();
CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.wi_revision_history FOR EACH ROW EXECUTE FUNCTION public.audit_business_change();
CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.audit_business_change();
CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION public.audit_business_change();
-- Memberships have a composite key, so they are audited transactionally by the admin API.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA inspectai_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA inspectai_private TO inspectai_runtime;
REVOKE ALL ON public.departments,public.department_memberships FROM anon,authenticated;
-- Once assigned, a started inspection retains its original approved revision,
-- including when a later revision is published while the work is in progress.
CREATE OR REPLACE FUNCTION public.guard_work_order() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE wi public.work_instructions;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status IN ('complete','cancelled') THEN RAISE EXCEPTION 'Closed work order is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='in_progress' AND NEW.work_instruction_id IS DISTINCT FROM OLD.work_instruction_id THEN RAISE EXCEPTION 'An inspection in progress cannot change checklist' USING ERRCODE='23514'; END IF;
 SELECT * INTO wi FROM public.work_instructions WHERE id=NEW.work_instruction_id AND tenant_id=NEW.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'An accessible inspection form is required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND (NEW.work_instruction_id IS DISTINCT FROM OLD.work_instruction_id OR (OLD.status='open' AND NEW.status='in_progress'))) THEN
  IF wi.status<>'active' OR (wi.expiry_date IS NOT NULL AND wi.expiry_date<CURRENT_DATE) OR (wi.effective_date IS NOT NULL AND wi.effective_date>CURRENT_DATE) THEN RAISE EXCEPTION 'An approved effective and unexpired instruction is required' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='complete' AND NOT EXISTS(SELECT 1 FROM public.inspection_records WHERE work_order_id=NEW.id AND tenant_id=NEW.tenant_id AND completed_at IS NOT NULL AND signed_payload IS NOT NULL) THEN RAISE EXCEPTION 'Signed inspection required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- Capture changes to access data in the same transaction; exclude image values.
CREATE OR REPLACE FUNCTION inspectai_private.redact_audit_value(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE WHEN value->>'captured_value' LIKE 'data:image/%' THEN jsonb_set(value,'{captured_value}','"[signature evidence recorded]"'::jsonb) ELSE value END
$$;
-- Keep sensitive evidence out of before/after values even for question signatures.
CREATE FUNCTION inspectai_private.audit_redaction() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.detail ? 'before' AND NEW.detail->'before'<>'null'::jsonb THEN NEW.detail=jsonb_set(NEW.detail,'{before}',inspectai_private.redact_audit_value(NEW.detail->'before')); END IF;
 IF NEW.detail ? 'after' AND NEW.detail->'after'<>'null'::jsonb THEN NEW.detail=jsonb_set(NEW.detail,'{after}',inspectai_private.redact_audit_value(NEW.detail->'after')); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER redact_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION inspectai_private.audit_redaction();
CREATE FUNCTION inspectai_private.form_contributor(fid uuid,uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.form_id=fid AND a.user_id=uid AND
 (a.entity_type='wi_checklist_items' OR (a.entity_type='work_instructions' AND
 (a.action='insert.work_instructions' OR ((a.detail->'before')-ARRAY['status','effective_date','updated_at']) IS DISTINCT FROM ((a.detail->'after')-ARRAY['status','effective_date','updated_at'])))))
$$;
CREATE FUNCTION inspectai_private.protect_approval_decision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ar public.approval_records; wi public.work_instructions; actor uuid;
BEGIN
 IF NEW.status IN ('done','rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
  actor=nullif(current_setting('app.actor_id',true),'')::uuid;
  SELECT * INTO ar FROM public.approval_records WHERE id=NEW.approval_record_id AND tenant_id=NEW.tenant_id;
  SELECT * INTO wi FROM public.work_instructions WHERE id=ar.work_instruction_id AND tenant_id=NEW.tenant_id;
  IF actor IS NULL OR NOT inspectai_private.has_capability('form_approver') OR NOT inspectai_private.department_access(NEW.tenant_id,wi.department_id) THEN RAISE EXCEPTION 'An authorised departmental reviewer is required' USING ERRCODE='23514'; END IF;
  IF actor=ar.submitted_by OR actor=wi.owner_id OR inspectai_private.form_contributor(wi.id,actor) THEN RAISE EXCEPTION 'Form contributors cannot approve or reject their own revision' USING ERRCODE='23514'; END IF;
  IF actor IS DISTINCT FROM NEW.approver_id AND NOT inspectai_private.has_capability('administrator') THEN RAISE EXCEPTION 'The review is assigned to another reviewer' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_approval_decision BEFORE UPDATE ON public.approval_steps FOR EACH ROW EXECUTE FUNCTION inspectai_private.protect_approval_decision();
CREATE POLICY notification_scope ON public.notifications AS RESTRICTIVE TO inspectai_runtime USING(
 CASE entity_type WHEN 'work_orders' THEN inspectai_private.order_access(entity_id)
 WHEN 'inspection_records' THEN EXISTS(SELECT 1 FROM public.inspection_records r WHERE r.id=entity_id)
 WHEN 'work_instructions' THEN inspectai_private.form_access(entity_id)
 WHEN 'approval_records' THEN EXISTS(SELECT 1 FROM public.approval_records a WHERE a.id=entity_id)
 ELSE true END
) WITH CHECK(true);
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA inspectai_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA inspectai_private TO inspectai_runtime;
-- Question signatures use validated image evidence; ordinary text remains capped.
CREATE OR REPLACE FUNCTION public.guard_finding() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ir public.inspection_records; wid uuid; ci public.wi_checklist_items; n numeric;
BEGIN
 SELECT * INTO ir FROM public.inspection_records WHERE id=NEW.inspection_record_id AND tenant_id=NEW.tenant_id FOR UPDATE;
 IF NOT FOUND OR ir.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Inspection missing or already signed' USING ERRCODE='23514'; END IF;
 SELECT work_instruction_id INTO wid FROM public.work_orders WHERE id=ir.work_order_id AND tenant_id=ir.tenant_id;
 SELECT * INTO ci FROM public.wi_checklist_items WHERE id=NEW.checklist_item_id AND tenant_id=NEW.tenant_id AND work_instruction_id=wid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Checklist item is not part of inspection' USING ERRCODE='23514'; END IF;
 IF ci.field_type='heading' THEN RAISE EXCEPTION 'Headings cannot have findings' USING ERRCODE='23514'; END IF;
 IF coalesce(array_length(NEW.photo_urls,1),0)>10 THEN RAISE EXCEPTION 'Maximum ten photos per item' USING ERRCODE='23514'; END IF;
 IF length(coalesce(NEW.notes,''))>10000 OR length(coalesce(NEW.captured_value,''))>(CASE WHEN ci.field_type='signature' THEN 2800000 ELSE 10000 END) THEN RAISE EXCEPTION 'Evidence exceeds the response size limit' USING ERRCODE='23514'; END IF;
 IF ci.required AND NEW.result IN ('pass','fail') AND ci.field_type IN ('text','textarea') AND coalesce(trim(NEW.captured_value),'')='' THEN RAISE EXCEPTION 'Required text evidence is missing' USING ERRCODE='23514'; END IF;
 IF NEW.result='pass' AND ci.field_type IN ('number','measurement') THEN
  BEGIN n=NEW.captured_value::numeric; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'A numeric reading is required' USING ERRCODE='23514'; END;
  IF n IS NULL OR n::text IN ('NaN','Infinity','-Infinity') OR (ci.min_value IS NOT NULL AND n<ci.min_value) OR (ci.max_value IS NOT NULL AND n>ci.max_value) THEN RAISE EXCEPTION 'PASS contradicts measurement limits' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.result IS NOT NULL AND ci.required AND NEW.result='na' AND coalesce(trim(NEW.notes),'')='' THEN RAISE EXCEPTION 'Required N/A needs a reason' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
COMMIT;
