-- Intentional owner-rights view in a non-exposed schema. Only the backend
-- database role can read the password-change fingerprint; no password hashes
-- or general Auth access are exposed to the runtime or browser roles.
CREATE SCHEMA IF NOT EXISTS inspectai_private;
REVOKE ALL ON SCHEMA inspectai_private FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE VIEW inspectai_private.session_versions
WITH (security_barrier = true) AS
SELECT id, encode(sha256(convert_to(encrypted_password, 'UTF8')), 'hex') AS auth_version
FROM auth.users;
REVOKE ALL ON inspectai_private.session_versions FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA inspectai_private TO inspectai_runtime;
GRANT SELECT ON inspectai_private.session_versions TO inspectai_runtime;
REVOKE authenticated FROM inspectai_runtime;
REVOKE ALL ON auth.users FROM inspectai_runtime;
REVOKE SELECT (id, encrypted_password) ON auth.users FROM inspectai_runtime;
