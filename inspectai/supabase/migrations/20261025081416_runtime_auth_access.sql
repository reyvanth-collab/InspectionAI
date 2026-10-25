-- Supabase's postgres role cannot grant USAGE directly on the managed auth
-- schema. Inherit the standard role's schema usage; public browser grants stay
-- revoked and application permissions still come from api_runtime_access.
GRANT authenticated TO inspectai_runtime;
-- Password-change invalidation needs only these columns, not all Auth data.
REVOKE SELECT ON auth.users FROM inspectai_runtime;
GRANT SELECT (id, encrypted_password) ON auth.users TO inspectai_runtime;
