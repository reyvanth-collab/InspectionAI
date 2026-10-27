BEGIN;
CREATE TABLE public.inspection_drafts (
 record_id uuid PRIMARY KEY REFERENCES public.inspection_records(id),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 answers jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(answers)='object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inspection_drafts_tenant_idx ON public.inspection_drafts(tenant_id);
ALTER TABLE public.inspection_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY draft_scope ON public.inspection_drafts TO inspectai_runtime
 USING(EXISTS(SELECT 1 FROM public.inspection_records r WHERE r.id=record_id AND r.tenant_id=inspection_drafts.tenant_id))
 WITH CHECK(EXISTS(SELECT 1 FROM public.inspection_records r WHERE r.id=record_id AND r.tenant_id=inspection_drafts.tenant_id));
REVOKE ALL ON public.inspection_drafts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.inspection_drafts TO inspectai_runtime;
CREATE FUNCTION inspectai_private.guard_draft() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.inspection_records; w public.work_orders; actor uuid;
BEGIN
 actor=nullif(current_setting('app.actor_id',true),'')::uuid;
 SELECT * INTO r FROM public.inspection_records WHERE id=NEW.record_id AND tenant_id=NEW.tenant_id FOR UPDATE;
 IF NOT FOUND OR r.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Inspection unavailable or already signed' USING ERRCODE='23514'; END IF;
 SELECT * INTO w FROM public.work_orders WHERE id=r.work_order_id AND tenant_id=r.tenant_id;
 IF NOT inspectai_private.has_capability('inspector') OR (w.assigned_to IS DISTINCT FROM actor AND NOT inspectai_private.has_capability('administrator')) THEN RAISE EXCEPTION 'Assigned inspector required' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND (NEW.record_id<>OLD.record_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Invalid draft version' USING ERRCODE='23514'; END IF;
 IF octet_length(NEW.answers::text)>25000000 THEN RAISE EXCEPTION 'Draft exceeds size limit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_draft BEFORE INSERT OR UPDATE ON public.inspection_drafts FOR EACH ROW EXECUTE FUNCTION inspectai_private.guard_draft();
CREATE FUNCTION inspectai_private.audit_draft() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 INSERT INTO public.audit_logs(tenant_id,user_id,action,entity_type,entity_id,work_order_id,department_id,detail)
 SELECT NEW.tenant_id,nullif(current_setting('app.actor_id',true),'')::uuid,'inspection.draft.saved','inspection_records',NEW.record_id,r.work_order_id,w.department_id,jsonb_build_object('version',NEW.version,'questionIds',ARRAY(SELECT jsonb_object_keys(NEW.answers)))
 FROM public.inspection_records r JOIN public.work_orders w ON w.id=r.work_order_id WHERE r.id=NEW.record_id;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_draft AFTER INSERT OR UPDATE ON public.inspection_drafts FOR EACH ROW EXECUTE FUNCTION inspectai_private.audit_draft();
REVOKE ALL ON FUNCTION inspectai_private.guard_draft(),inspectai_private.audit_draft() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION inspectai_private.guard_draft(),inspectai_private.audit_draft() TO inspectai_runtime;
COMMIT;
