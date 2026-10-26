# Focused inspection workflow

Work branch: `feature/focused-inspection-workflow`.

InspectionAI supports controlled inspection forms, manual asset and work-order management, single-asset checklist completion, evidence, authenticated signatures, reports and change history. This is a reviewed staging implementation, not a declaration of production readiness.

## Start locally

Use the existing ignored `backend/.env` and `frontend/.env` configuration. Never copy server credentials into frontend variables. The backend uses the restricted `inspectai_runtime` database account; an administrative migration connection belongs only in a migration/provisioning process.

In separate PowerShell terminals:

```powershell
cd C:\Users\reyva\vsCodeProjects\InspectionAI\inspectai\backend
npm ci
npm run dev
```

```powershell
cd C:\Users\reyva\vsCodeProjects\InspectionAI\inspectai\frontend
npm ci
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:3000`. The API listens on port 4000. Stop an existing instance on the same port before starting another one. The running review instance uses the built backend, so changes to that instance require a build and restart.

## Permissions and ownership

Profiles have a primary department, explicit additional memberships, and separate capabilities: inspector, form author, form approver, viewer, administrator, asset manager and work-order manager. Existing role values remain for compatibility. Request authorization reloads the current profile; it does not trust authorization claims from user-editable Auth metadata or stale role claims in a token.

The API checks capabilities and assignment. Restrictive runtime RLS policies check tenant and department access, and inspection records/findings follow the permitted work order. The same policies scope reports, exports, search, evidence, linked history and related notifications. Private database helpers accept only the authenticated actor context established by the server. They are unavailable to browser roles.

Departmental authors do not need an administrator role or approval capability. Cross-department reviewers need an explicit membership. A form's author, submitter and recorded content contributors cannot approve their own revision. Administrator overrides require a reason and record the actual authenticated decision actor.

Work-order creation requires a registered asset and a published, effective, unexpired form from the asset's department. Near-expiry forms remain usable until their actual expiry date. Work-order numbers are generated under a tenant lock and protected by a tenant uniqueness constraint. The database copies the asset number, name, location and department into an immutable historical snapshot. Assignment changes and form replacement are available before the inspection starts.

## Forms, inspections and history

Navigation contains Inspections, Inspection Forms, Assets, Reports, and administrator Settings. Inspection-capable users land on inspections; authors and reviewers without inspection capability land on their form tasks. Existing dashboard, analytics, approval and activity-history links redirect to the appropriate new destination. MOMS application routes/screens/API exposure are removed; historical schema and migrations remain.

Form questions retain their IDs while a draft is edited, and copied revisions retain question lineage. Checklist layout survives save/reload and revision creation. Published content remains immutable. Publishing a later revision does not rewrite signed inspections or change the revision on an inspection already in progress.

Checklist responses have explicit results and independent readings/notes. Unanswered questions never become passes. Required N/A reasons, failure notes and photo evidence follow the saved response policy. Each card shows unsaved, saving, saved or failed status. Failed saves retain the local response for retry. Unsaved responses/photos and pending operations block signing. Review identifies incomplete/invalid responses and failed items. Signing uses the authenticated account; the server validates completion, stores a canonical payload/hash and locks the signed record. Optional unanswered items remain unanswered in that payload.

Form details contain Content, Approval & comments and History. History includes related versions and question/approval events, exact timestamps with timezone, actor, readable before/after values and available reasons. Mandatory change events are written by database triggers in the business transaction. Ordinary runtime users cannot update/delete audit events. Passwords, tokens, raw signature images and photo binaries are excluded from audit diffs. Missing legacy actor information is labelled as missing, not attributed to a system actor.

## Migration and legacy allocation

Apply all versioned migrations using the existing migration runner and an administrative `MIGRATION_DATABASE_URL`:

```powershell
cd inspectai/backend
npm run db:migrate
```

The three new migrations are `20261025132236_focused_departments_history.sql`, `20261025143453_approved_form_usability.sql` and `20261025145434_focused_access_indexes.sql`. The last adds indexes for new foreign keys and avoids repeated constant actor lookups in access policies. Existing migration files and the legacy prerequisite order are retained. They were generated using the installed Supabase CLI. When an administrator applies a migration through the connected Supabase tool, its filename must also be recorded in `public.inspectai_migrations`, which is the repository runner's applied-file registry. All three new files are recorded in the authorised staging project.

Existing user department text is retained and mapped to stable tenant department IDs. Assets and forms had no ownership department field. Five of seven staging work orders had conflicting possible departments if inferred from asset creators versus form authors. Existing application records therefore receive an explicit **General (legacy allocation)** department, and existing users receive an explicit membership preserving their prior access there. New departmental fixtures and newly provisioned users do not receive a blanket General membership.

Existing asset/form/work-order field values and timestamps are preserved. The backfill adds ownership/snapshot columns and transactional backfill events; it does not rewrite signed payloads. The previously signed staging record's count and digest matched immediately before/after migration.

Before a customer rollout, an owner must review the General allocation and approve an actual departmental ownership/access mapping. Do not infer engineering ownership from a person's job title. Published revisions and completed inspection history must stay intact when preparing departmental replacements.

## Verification commands

```powershell
cd inspectai/backend
npm test
node scripts/verify-legacy-upgrade.mjs ../../.env.hosted-pre-migration.snapshot.json
```

Backend tests use PostgreSQL in PGlite with the real schema, migrations, RLS, triggers and Express route handlers. The Auth provider is stubbed in that suite; it is not a substitute for live Auth verification. The upgrade command needs the existing ignored schema snapshot. Fresh installation replay is part of the backend suites.

```powershell
cd inspectai/frontend
npm test
npm run lint
npm run build
$env:PLAYWRIGHT_CHANNEL='chrome' # installed Chrome on this Windows machine
node node_modules/@playwright/test/cli.js test --reporter=line
```

Without an installed Chrome channel, install the locked Playwright Chromium build and omit `PLAYWRIGHT_CHANNEL`. Browser workflow tests label mocked API coverage explicitly. Live tests are opt-in, use ignored local fixture credentials, disable tracing, and require the local app/backend and authorised staging database:

```powershell
$env:VERIFY_LIVE_STAGING='true'
$env:VERIFY_LIVE_DEMO='true'
node node_modules/@playwright/test/cli.js test live-staging.spec.ts live-demo.spec.ts --workers=1 --reporter=line
```

The live demo completion test changes only its explicitly synthetic inspection. If that inspection is already signed, it verifies the signed view instead of changing the record.

## Verified staging results — 26 October 2026

- Backend build, asset validation and AI-provider regression checks passed; 56 release integration assertions and 390 department/lifecycle/audit/demo/permission assertions passed against PostgreSQL in PGlite.
- Fresh schema replay and the ignored pre-migration snapshot upgrade passed, preserving original field values/timestamps and five integrity guards.
- Frontend session regression tests, lint and production build passed. Five desktop/phone browser checks passed with mocked APIs; three separate live browser checks passed against hosted Auth and the running backend. Live phone completion persisted failure evidence, N/A explanation and a separate reading, preserved an unanswered optional item, and signed with the authenticated inspector.
- The final backend passed 62 live API assertions covering hosted Auth, current profile roles, tenant denial, independent approval, measurement validation, completion/hash, reload/reports and tamper rejection.
- Staging contains 60 synthetic assets, 20 distinct forms across 23 versions, 20 work orders and 27 personas across eight rail departments. The tenant also has the automatically created General department. Repeating the final seed preserved asset/form/order/record counts and the signed-payload digest. The later browser completion intentionally changed one open demonstration inspection into a signed failure.
- The original pre-department-migration signed record remains unchanged: count 1 and combined digest `1ccb917e91a6108786bbabd483227581` (MD5 of ordered ID, signature hash and JSONB payload text).
- The connected project is `inspectai` (`ehrgsakhrpbtintshjha`), healthy. The runtime role is neither superuser nor able to bypass RLS. All three new migration filenames are recorded in the repository migration registry.
- Security advisor: the existing leaked-password-protection warning remains; the migration registry's RLS/no-policy information is intentional. Performance advisor: four newly introduced missing-FK-index notices were resolved; 31 legacy FK-index notices and unused-index information remain. It still flags two actor-context policy lookups even though their stored definitions use scalar SELECT subqueries. Those warnings are not reported as resolved; larger-scale query-plan/load validation remains outstanding. See the [RLS performance advisory](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan) and [foreign-key index advisory](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

## Deliberate boundaries and owner actions

- Manual form creation is supported. The old spreadsheet import buttons pointed at missing backend endpoints; the PDF endpoint was disabled. These unavailable controls are excluded from normal editing rather than presented as working features. AI/PDF extraction flags are not enabled.
- No routes/stops, multi-asset orders, PM scheduler, customer MMS connector, corrective-order integration, offline replay, AI feature or SSO setup is added. Failed inspection items remain visible in results/reports without implying that an external corrective work order was created.
- Browser phone checks use an emulated viewport, not physical devices. Email recovery delivery, assistive-technology testing, production load/operations, backup restoration and customer-specific policy acceptance need separate verification.
- Rotate the server key previously shared in the conversation, update ignored server configuration securely, and review Supabase's existing leaked-password-protection warning before production use. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The migration-registry table intentionally has RLS with no ordinary-access policy.
- No merge to main or public deployment is part of this work.

See [RAIL_DEMO.md](RAIL_DEMO.md) for demo provisioning, access and cleanup.
