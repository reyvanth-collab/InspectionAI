-- Auth accounts never self-assign application roles or tenant membership.
-- An administrator provisions public.users explicitly after creating Auth users.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN RETURN NEW; END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

ALTER VIEW public.work_instructions_view SET (security_invoker = true);
ALTER FUNCTION public.current_tenant_id() SET search_path = '';
ALTER FUNCTION public.current_user_role() SET search_path = '';
ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.refresh_wi_status() SET search_path = '';
REVOKE EXECUTE ON FUNCTION public.current_tenant_id(), public.current_user_role(), public.refresh_wi_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id(), public.current_user_role() TO inspectai_runtime, service_role;
-- Scheduled status maintenance remains available to its owner, not API users.
REVOKE ALL ON public.inspectai_migrations FROM anon, authenticated, inspectai_runtime;
-- Historical browser policies include recursive user-profile lookups. Since
-- release_integrity makes public data API-only, keep only the server policies.
DO $$ DECLARE p record; BEGIN
 FOR p IN SELECT tablename, policyname FROM pg_policies
          WHERE schemaname = 'public' AND policyname <> 'api_runtime_access'
 LOOP
  EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
 END LOOP;
END $$;
