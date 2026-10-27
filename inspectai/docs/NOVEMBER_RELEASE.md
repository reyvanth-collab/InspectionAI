# InspectionAI — delivery to 30 November 2026

Working release branch: **release/november-product-completion**.
Foundation: **feature/focused-inspection-workflow**, commit `8e5869d`.
Review date: **27 October 2026** (Singapore).

The target is a complete online, single-asset inspection product within the
agreed scope. A calendar date is not evidence of release readiness. Only checked
acceptance gates establish readiness. No background work or future execution is
implied by this plan.

## Scope and deliverable review

| Agreed deliverable | Code status | Primary evidence |
|---|---|---|
| Restrained rail login and consistent working theme | Implemented | `frontend/src/pages/Login.tsx`, `frontend/src/index.css`, shared UI components |
| Manual assets and WOs retained; mandatory WO reference; one asset per inspection | Implemented | `backend/src/routes/inspections.ts`, `frontend/src/pages/Inspections.tsx` |
| Server-side asset/location/department snapshot and tenant-scoped WO numbering | Implemented | `20261025132236_focused_departments_history.sql`, integration suite |
| At least 50 assets and 10–20 rail forms | Implemented; hosted counts rechecked | 60 assets, 20 distinct forms, 20 WOs; `backend/scripts/rail-demo-data.mjs`, `docs/RAIL_DEMO.md` |
| Inspection Forms naming and integrated approval tasks | Implemented | `MasterLibrary.tsx`, `WIDetail.tsx`, `FormApprovals.tsx`, navigation redirects |
| Stable departments and separate author/reviewer permissions | Implemented | department migration, `middleware/auth.ts`, department and approval routes |
| Assigned inspection, response/evidence saving, final review and authenticated signing | Implemented | `InspectionExecution.tsx`, inspection routes, browser and database suites |
| Published revisions and signed inspections preserved | Implemented | database guards, immutable revision workflow, integration suite |
| Remove MOMS Analytics from app/API | Implemented | router/navigation removal; denial check in department suite |
| Before/after history tied to form/question/revision/inspection | Implemented | transactional database auditing, `history.ts`, `History.tsx` |
| Revision endpoint, layout persistence, metadata update and list/count mismatches | Fixed in foundation; regression covered | form/inspection routes and department suite |
| Useful reports on phone and desktop with explicit errors and complete exports | Completed in November follow-up | paginated report endpoints, `Reports.tsx`, report browser tests |
| Password recovery consistent with working UI, confirmation and failed-request recovery | Completed in November follow-up | `ResetPassword.tsx`, recovery browser tests |
| Safe local pull/update instructions for Codex | Completed in November follow-up | `LOCAL_WINDOWS.md`, `scripts/prepare-local.mjs` and fixture test |
| Live deployment acceptance and operations | Still required | release gates below |

No routes/stops, multi-asset WOs, PM scheduling, customer MMS connector, external
CM creation, offline replay, AI assistant or SSO is promised for this release.
Unavailable PDF/spreadsheet authoring imports remain outside the normal UI.
Fictional rail forms are demonstration content, not engineering procedures.

## Verified here

- The baseline GitHub branch's backend, frontend and container checks passed on
  26 October. Those results belong to that commit, not automatically this patch.
- Backend suites replay the real schema and migrations in PGlite and execute
  Express routes under runtime RLS. Auth is stubbed in those suites.
- The follow-up extends coverage for all three report pagination paths and
  readiness failure when a guard/policy/RLS is removed or a privileged database
  account is used. It does not change database schema or hosted records.
- The update helper is tested against a temporary Git remote and dirty original
  clone. It preserves ignored configuration, fast-forwards a separate worktree,
  and refuses dirty or divergent target changes.
- Supabase read-only checks on 27 October confirmed `inspectai` is healthy, the
  runtime role has neither superuser nor bypass-RLS, all three focused-workflow
  migrations are recorded, and the demo has 60 assets, 20 distinct forms and
  20 work orders. Nine departments include eight rail departments plus General.
- Supabase's security advisor still reports leaked-password protection disabled.
  The migration registry's RLS/no-policy information is intentional; do not add
  broad access merely to silence it.
- Browser tests distinguish mocked API/Auth scenarios from opt-in hosted tests.
  Physical-device, recovery email delivery and real backup restoration are not
  established by those mocked tests.

Use the new branch's GitHub checks and PR for the final patch results. Do not
reuse old screenshots or counts as proof of a different commit's correctness.

## Follow-up verification results — 27 October

| Check | Result |
|---|---|
| Backend build and workflow suites | 56 release + 448 departmental/lifecycle/report assertions passed |
| Frontend session regressions, lint and production build | Passed; inert public config used for the test build |
| Production dependency audits | Backend 0, frontend 0 known advisories |
| Safe local-update fixture | Passed: dirty original and configuration preserved; dirty/divergent target refused |
| Real Chromium browser tests | 9 passed; 3 opt-in hosted tests skipped |
| Hosted database checks | Read-only counts, migration registry and role checks passed; no records changed |

The local browser run used Chromium 153 after the locked browser's CDN download
was truncated. GitHub CI uses the repository's standard Playwright browser and
container checks; consult the PR for those results. Browser tests use emulated
phone viewports and mocked API/Auth where named. They do not establish email
delivery, real hosted workflows for this patch, or physical-device acceptance.

## Finish by 30 November

| Window | Work | Acceptance evidence |
|---|---|---|
| 27 Oct–2 Nov | Integrate this branch into the local development workflow, run all CI, review the UI and departmental forms | Exact commit, green build/tests/browser/container gates, recorded product review |
| 3–9 Nov | Deploy the tested image to staging; verify Auth, invitations, password recovery, HTTPS, secrets and migration compatibility | Hosted workflow tests and actual reset email tested; restricted runtime DB role; recoverable deployment |
| 10–16 Nov | Representative users exercise author → reviewer → inspector → report workflows on actual target devices | Department/tenant/assignment denial, photo/camera/touch checks, accessibility and failed-network acceptance |
| 17–23 Nov | Operational validation: concurrent users, large datasets, backup restore, retention, monitoring and incident handling | Agreed load profile with measured latency/error thresholds; restore into isolated DB; alerts demonstrated |
| 24–27 Nov | Fix acceptance defects, freeze scope and create release candidate | No unresolved privacy, access, signature, persistence or audit defects; versioned image/schema and runbook |
| 28–30 Nov | Regression, owner acceptance and controlled release | Signed-off checklist, support/rollback ownership, production target and authorisation |

These windows are a delivery sequence, not booked future actions. Do not expand
scope while the core release gates are open. If an acceptance gate fails, fix it
or move the release date; do not lower integrity requirements to meet the date.

## Open release gates

- [ ] Select/configure the actual host and deployment URL; verify HTTPS, health,
      readiness, log retention, alerts and restart behaviour there.
- [ ] Confirm account provisioning/invitations and real recovery-email delivery.
- [ ] Review and enable [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
      where available, and verify the chosen password policy.
- [ ] Rotate any credentials previously shared outside secure configuration;
      record the rotation without placing credentials in Git or reports.
- [ ] Review legacy General department allocation before customer onboarding.
- [ ] Prove database backup restoration into an isolated environment and document
      recovery objectives and responsible operator.
- [ ] Agree expected concurrent users/data volume and pass representative load;
      a health endpoint stress test alone is insufficient.
- [ ] Test camera/photo, touch, keyboard and assistive technology on actual devices.
- [ ] Review retention/export/access policies and approved operational forms.
- [ ] Complete product acceptance and explicitly authorise production deployment.

## Local Codex handoff

Follow `LOCAL_WINDOWS.md` to create/update the sibling checkout. Then:

1. Read this file and `FOCUSED_APP.md`; inspect Git status before editing.
2. Keep local `.env` files ignored. Do not reset the old laptop checkout.
3. Run backend tests; frontend tests, lint/build; browser checks; production audits.
4. Use `RAIL_DEMO.md` only with its named fictional tenant, never a customer tenant.
5. Keep this branch as the shared base. If local changes diverge, integrate them
   on a child branch with tests instead of replacing the release tree.
6. Record the commit tested and exact external gates remaining. Open a review PR;
   do not merge or deploy merely because local checks pass.

## Demo visibility follow-up — 27 October

A separate verification workspace contains three tiny one-question forms; the
full fictional rail dataset is in its own tenant. Signing in with the wrong
workspace's account must not reveal another tenant's samples. The UI now shows
the backend-supplied workspace name after login and reload. The local checkout
helper preserves the ignored demo credential file, and `npm run check:rail-demo`
verifies visible counts through the normal authenticated API before UI testing.
Use `personas.admin` locally to inspect the entire demo, and department personas
to test restricted access. See `RAIL_DEMO.md`. No cross-tenant access, shared
password, customer records or signed inspections were changed.
