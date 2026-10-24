# Release candidate 1.0.0-rc.1

This is a hardened online inspection release candidate, not certification of a running deployment.

## Release scope

Assets → draft work instructions → independent approval → assigned-inspector execution → typed measurement/evidence capture → immutable signed completion → JSON reports. New revisions clone into separate drafts. API permissions and database guards protect records independently of UI controls. Mandatory database business-event audit is transactional; supplementary events and notifications are best effort. A signature hash binds a canonical inspection payload; it is not a legally qualified digital signature or protection against database-superuser access.

Offline replay is disabled. Existing local queue data is retained for supervised manual recovery, never replayed under another account. The offline overlay blocks interaction. Draft/photo storage remains sensitive; use individual managed browser profiles. There is no offline page-loading guarantee.

AI assistance, PDF extraction and historical imports default off. Enabling these requires separate live accuracy/resource validation. Historical import uses an XLSX parser, 5 MB and 10,000-row limits, atomic batches and whole-file hash deduplication; logically identical data in different workbook bytes is not deduplicated. SSO, white labelling and live Maximo/SAP/Teams integrations are excluded. Unimplemented settings are hidden; generated JSON is not a live integration.

## Tests

`backend/npm test` compiles TypeScript, runs asset/provider unit tests and a complete Express workflow against PostgreSQL (PGlite), with two tenants and four roles. It checks role/ownership denial, approval bypass, immutable drafts/revisions, measurement limits, invalid signatures, post-sign edits, revision cloning, audit writes and RLS presence. `frontend/npm test` exercises actual React contexts/hooks in jsdom for tenant switching, queue quarantine and split/error SSE. Lint, production build and production-dependency audits are additional gates.

Not verified locally: real browser/camera/touch devices, live Supabase grants/auth/email, provider accuracy, Docker image startup, real backup restore, proxy deployment, multi-user concurrency/load. Embedded PostgreSQL and jsdom do not replace these checks. No production data or paid AI calls are used by tests.

## Deploy to staging first

1. Create a dedicated Supabase staging project. Allow `https://YOUR_DOMAIN/reset-password` as a recovery redirect. Invite separate admin, approver and inspector auth accounts via Supabase, create a tenant and matching public.users rows. Never apply demo-seed.sql in production.
2. Back up existing databases and prove restoration before changes. The hardening migration revokes direct anon/authenticated public-table access because all application data uses the API. Other clients using the same database require compatibility review.
3. In backend: `npm ci`; set administrative `MIGRATION_DATABASE_URL`; run `npm run db:migrate`. Fresh projects bootstrap schema.sql without fixtures; existing projects apply recorded migrations once. Deployment uses an advisory lock. If a migration commits but its history insert is interrupted, inspect the database before retrying; do not reset history blindly.
4. The migration creates an inspectai_runtime NOLOGIN role. An administrator must enable LOGIN with a generated password securely, and set DATABASE_URL to this role with TLS certificate verification. Do not run the app as postgres or the schema owner. Keep migration credentials outside the app. Runtime has no DDL or audit UPDATE/DELETE privileges.
5. Copy `.env.production.example` to `.env.production`; replace all placeholders. Generate a random JWT_SECRET of at least 48 characters. Set actual Supabase URL, public anon key and backend service credentials. Never expose service keys in the frontend. Keep optional flags false. Password changes invalidate app tokens; tokens expire after two hours.
6. Configure domain DNS and a Docker host with ports 80/443. In inspectai: `docker compose --env-file .env.production build`, then `docker compose --env-file .env.production up -d`. Caddy provides HTTPS. The app port is private: never expose it around the trusted reverse proxy.
7. With runtime staging DATABASE_URL, run `npm run verify:staging`. Verify /api/health and /api/ready over HTTPS; refresh nested UI routes; confirm unknown /api routes return JSON 404. Exercise complete approval/inspection/sign/report and password-reset flows in real target browsers/tablets.
8. Prove two-tenant isolation, expired-token handling, out-of-order/concurrent save/sign behaviour, uploads, backup restore and representative load. Configure host log retention, alerting and backups. Deploy only the tested image and schema. Roll back images only with compatible schema, preserving signed records.

## External release gates

The hosting account/domain, Supabase project, credentials, authorised operational data, backup/retention policy and business acceptance cannot be inferred from repository code. Final production approval requires these environment-specific checks. Operational exports and the legacy prototype are excluded from the Docker build context/image; their existing public Git history remains a separate ownership/publication concern.
