BEGIN;
ALTER TABLE public.inspection_records ADD COLUMN IF NOT EXISTS signed_payload jsonb;
ALTER TABLE public.inspection_findings ADD COLUMN IF NOT EXISTS captured_value text;
ALTER TABLE public.moms_checklist_steps ENABLE ROW LEVEL SECURITY;
-- API-only access: browser auth is used solely for password recovery. All application data goes through authenticated API.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
CREATE TABLE IF NOT EXISTS public.import_receipts (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), digest text NOT NULL,
 row_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,digest)
);
ALTER TABLE public.import_receipts ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.guard_instruction_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wid uuid; tid uuid; s public.wi_status;
BEGIN
 IF TG_OP='DELETE' THEN wid=OLD.work_instruction_id; tid=OLD.tenant_id; ELSE wid=NEW.work_instruction_id; tid=NEW.tenant_id; END IF;
 SELECT status INTO s FROM public.work_instructions WHERE id=wid AND tenant_id=tid FOR UPDATE;
 IF s IS DISTINCT FROM 'draft'::public.wi_status THEN RAISE EXCEPTION 'Only draft checklist items can be edited' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER guard_instruction_items BEFORE INSERT OR UPDATE OR DELETE ON public.wi_checklist_items FOR EACH ROW EXECUTE FUNCTION public.guard_instruction_items();
CREATE OR REPLACE FUNCTION public.guard_instruction_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status <> 'draft' AND (to_jsonb(NEW)-'status'-'effective_date'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'effective_date'-'updated_at') THEN
 RAISE EXCEPTION 'Submitted and approved revisions are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_instruction_revision BEFORE UPDATE ON public.work_instructions FOR EACH ROW EXECUTE FUNCTION public.guard_instruction_revision();
CREATE OR REPLACE FUNCTION public.guard_finding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ir public.inspection_records; wid uuid; ci public.wi_checklist_items; n numeric;
BEGIN
 SELECT * INTO ir FROM public.inspection_records WHERE id=NEW.inspection_record_id AND tenant_id=NEW.tenant_id FOR UPDATE;
 IF NOT FOUND OR ir.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Inspection missing or already signed' USING ERRCODE='23514'; END IF;
 SELECT work_instruction_id INTO wid FROM public.work_orders WHERE id=ir.work_order_id AND tenant_id=ir.tenant_id;
 SELECT * INTO ci FROM public.wi_checklist_items WHERE id=NEW.checklist_item_id AND tenant_id=NEW.tenant_id AND work_instruction_id=wid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Checklist item is not part of inspection' USING ERRCODE='23514'; END IF;
 IF ci.field_type='heading' THEN RAISE EXCEPTION 'Headings cannot have findings' USING ERRCODE='23514'; END IF;
 IF coalesce(array_length(NEW.photo_urls,1),0)>10 THEN RAISE EXCEPTION 'Maximum ten photos per item' USING ERRCODE='23514'; END IF;
 IF length(coalesce(NEW.notes,''))>10000 OR length(coalesce(NEW.captured_value,''))>10000 THEN RAISE EXCEPTION 'Evidence text exceeds 10000 characters' USING ERRCODE='23514'; END IF;
 IF ci.required AND NEW.result IN ('pass','fail') AND ci.field_type IN ('text','textarea') AND coalesce(trim(NEW.captured_value),'')='' THEN RAISE EXCEPTION 'Required text evidence is missing' USING ERRCODE='23514'; END IF;
 IF NEW.result='pass' AND ci.field_type IN ('number','measurement') THEN
  BEGIN n=NEW.captured_value::numeric; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'A numeric reading is required' USING ERRCODE='23514'; END;
  IF n IS NULL OR n::text IN ('NaN','Infinity','-Infinity') OR (ci.min_value IS NOT NULL AND n<ci.min_value) OR (ci.max_value IS NOT NULL AND n>ci.max_value) THEN RAISE EXCEPTION 'PASS contradicts measurement limits' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.result IS NOT NULL AND ci.required AND NEW.result='na' AND coalesce(trim(NEW.notes),'')='' THEN RAISE EXCEPTION 'Required N/A needs a reason' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_finding BEFORE INSERT OR UPDATE ON public.inspection_findings FOR EACH ROW EXECUTE FUNCTION public.guard_finding();
CREATE OR REPLACE FUNCTION public.guard_signed_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Signed inspection is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_signed_record BEFORE UPDATE ON public.inspection_records FOR EACH ROW EXECUTE FUNCTION public.guard_signed_record();
CREATE OR REPLACE FUNCTION public.guard_work_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wi public.work_instructions;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status IN ('complete','cancelled') THEN RAISE EXCEPTION 'Closed work order is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='in_progress' AND NEW.work_instruction_id IS DISTINCT FROM OLD.work_instruction_id THEN RAISE EXCEPTION 'An inspection in progress cannot change checklist' USING ERRCODE='23514'; END IF;
 SELECT * INTO wi FROM public.work_instructions WHERE id=NEW.work_instruction_id AND tenant_id=NEW.tenant_id;
 IF NOT FOUND OR wi.status <> 'active' OR (wi.expiry_date IS NOT NULL AND wi.expiry_date<CURRENT_DATE) THEN RAISE EXCEPTION 'An approved unexpired instruction is required' USING ERRCODE='23514'; END IF;
 IF NEW.status='complete' AND NOT EXISTS (SELECT 1 FROM public.inspection_records WHERE work_order_id=NEW.id AND tenant_id=NEW.tenant_id AND completed_at IS NOT NULL AND signed_payload IS NOT NULL) THEN RAISE EXCEPTION 'Signed inspection required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_work_order BEFORE INSERT OR UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.guard_work_order();
-- Mandatory business-event audit is inserted by DB in the same transaction. Application notifications remain best effort.
CREATE OR REPLACE FUNCTION public.audit_business_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rowdata jsonb; actor uuid;
BEGIN
 IF TG_OP='DELETE' THEN rowdata=to_jsonb(OLD); ELSE rowdata=to_jsonb(NEW); END IF;
 actor=NULLIF(current_setting('app.actor_id',true),'')::uuid;
 INSERT INTO public.audit_logs(tenant_id,user_id,action,entity_type,entity_id,detail)
 VALUES ((rowdata->>'tenant_id')::uuid,actor,lower(TG_OP)||'.'||TG_TABLE_NAME,TG_TABLE_NAME,(rowdata->>'id')::uuid,
 jsonb_build_object('operation',TG_OP,'record_id',rowdata->>'id'));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['assets','work_orders','work_instructions','inspection_records','inspection_findings','approval_records','approval_steps'] LOOP
 EXECUTE format('CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_business_change()',t);
END LOOP; END $$;
COMMIT;
