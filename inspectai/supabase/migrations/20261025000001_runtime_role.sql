BEGIN;
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='inspectai_runtime') THEN CREATE ROLE inspectai_runtime NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public, auth TO inspectai_runtime;
GRANT SELECT ON auth.users TO inspectai_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO inspectai_runtime;
GRANT DELETE ON public.wi_checklist_items TO inspectai_runtime;
REVOKE UPDATE ON public.audit_logs FROM inspectai_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO inspectai_runtime;
-- Server-only role: the API enforces actor and tenant scope. Browser roles have no public-table grants.
DO $$ DECLARE t text; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'inspectai_migrations' LOOP
 EXECUTE format('CREATE POLICY api_runtime_access ON public.%I TO inspectai_runtime USING (true) WITH CHECK (true)',t);
END LOOP; END $$;
COMMIT;
