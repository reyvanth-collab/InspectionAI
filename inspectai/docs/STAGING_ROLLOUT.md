# inspectai staging rollout — 25 October 2026

Target: `ehrgsakhrpbtintshjha`. Owner confirmed this is staging and authorized
migrations and synthetic test accounts/records.

Preflight found one tenant, six application profiles, five instructions, six
orders, and no completed inspection records. The public schema/data snapshot
is ignored by Git. It was restored locally and upgraded with all existing
values preserved. Auth credentials are not in that snapshot.

The atomic rollout applies these files in this dependency order, without
editing or resetting the four existing migrations:

1. `20261025074936_legacy_schema_bridge.sql`: additive typed checklist/evidence
   fields, signature image field, MOMS table/indexes/RLS.
2. `20260728000000_assets.sql`: assets, durable jobs, order asset relationship.
3. `20260812000000_wi_layout.sql`: checklist layout field.
4. `20261025000000_release_integrity.sql`: signed payload/evidence fields,
   business-event auditing and five integrity guards; revoke browser table and
   sequence grants.
5. `20261025000001_runtime_role.sql`: restricted backend role and server policies.
6. `20261025074938_auth_provisioning_hardening.sql`: remove automatic signup
   role/tenant assignment, use an invoker view, restrict helper functions, and
   remove obsolete browser policies (including recursive profile policies).
7. `20261025075602_guard_search_paths.sql`: pin integrity/audit function lookup.
8. `20261025081416_runtime_auth_access.sql`: initial managed-schema compatibility
   grant; superseded by the narrower private view below.
9. `20261025081643_private_session_versions.sql`: server-only private fingerprint
   view; remove runtime Auth-table grants and standard-role membership. Handles
   hosted Auth-table RLS without changing any managed Auth policies.

Both the app ledger and Supabase bundle history record the rollout. Use
`backend/scripts/migrate.mjs` for future deployments: it explicitly orders the
legacy bridge before its release-integrity dependency. Plain chronological
Supabase CLI replay is not the deployment path for this legacy project.

Operational configuration enables LOGIN for `inspectai_runtime` using a newly
generated password held only in ignored local secret files. The app connects
through the session pooler with TLS verification and keeps its existing
database-backed authorization. Existing account passwords and membership are
unchanged. Test accounts use separate synthetic tenants.

Completed: nine source migrations are recorded in the app ledger. Hosted
Supabase history contains the initial atomic six-file bundle and three
follow-ups. The restricted session-pooler connection verifies TLS against the
official CA URL used by Supabase Studio:
`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`.
See AUTH_VERIFICATION.md for final results and remaining release limitations.

Rollback is forward-fix first. Revoking runtime LOGIN and stopping the local
backend contains app access without altering records. Do not remove integrity
guards or rewrite signed records to roll back the UI. The local snapshot is
not a substitute for a provider disaster-recovery backup or an Auth backup.
