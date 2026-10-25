# Completed staging verification - 25 October 2026

Local app: http://127.0.0.1:3000, backend port 4000, hosted project
`ehrgsakhrpbtintshjha` (`inspectai`). This is a staging setup.

Supabase Auth validates passwords. The backend issues its existing two-hour
tokens and checks the current database role, tenant, active profile and
password-change fingerprint on every protected request. User metadata cannot
grant application privileges. Frontend reload validates `/api/auth/me`.

The restricted runtime connection uses the session pooler and official Supabase
CA with `sslmode=verify-full`. The role has neither superuser nor BYPASSRLS.
It cannot access the Auth schema or read password hashes. An intentional
owner-rights view in non-exposed `inspectai_private` exposes only IDs and
password-change fingerprints to the server role. Browser roles cannot access
that schema or public app tables. The migration ledger deliberately has no
runtime/browser policy or grants.

Nine source migrations are recorded; the original four files are unchanged.
The pre-migration public snapshot was restored and upgraded locally with all
original values preserved. Synthetic tests use two separate test tenants;
existing users and business records were unchanged. See STAGING_ROLLOUT.md.

## Passed checks

- Backend unit/provider tests and 50 PostgreSQL integration assertions,
  including Auth-table RLS, account activity, password invalidation,
  role/tenant checks and signed-record tamper protection.
- Restored legacy snapshot upgrade, existing values preserved, five integrity
  guards, restricted runtime access and browser denial.
- 62 live hosted Auth/PostgreSQL assertions: login, current database roles,
  forged role claims, tenant isolation, independent approval, measurements,
  signed completion/hash, reload/report and API/database tamper denial.
- Additional live metadata escalation denial, account deactivation, expired
  and tenant-tampered token denial, password-change invalidation/new sign-in.
  Only the dedicated synthetic viewer was changed.
- Frontend session tests, lint and production build with actual public config.
- Two production-bundle Chromium smoke tests and one opt-in live Chromium
  test: real login, backend-validated refresh, signed inspection viewing,
  logout and forged-session rejection. Live browser test uses no API mocks.

## Remaining limitations

Staging structural verification passes 14 of 15 checks. `no_demo_accounts`
detects pre-existing demo profiles; these were preserved rather than silently
disabled or deleted. Retire them before production.

Security advisors now report only disabled leaked-password protection
(warning) and intentional RLS-without-policy on the migration ledger (info).
Enable leaked-password protection where the project plan permits it.

The server key pasted into chat must be rotated in Supabase and replaced
locally. Setup scripts print no secrets. Database URL, JWT secret, generated
test passwords and snapshot are in ignored files. Test admin, approver,
inspector and viewer credentials are in `backend/.env.staging-test-users.json`.

SMTP/email delivery, recovery redirects/email, MFA, physical camera/touch
devices, production deployment, load and provider backup restore were not
verified. The local public-data restore is not an Auth backup or provider
disaster-recovery test. Local processes must remain running; this is not a
public internet deployment.
