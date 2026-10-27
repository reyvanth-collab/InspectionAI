# Fictional rail demonstration tenant

This seed is opt-in and restricted to the authorised staging project `ehrgsakhrpbtintshjha`. It refuses production mode, a different project, an unintended tenant identity, cross-tenant profile reuse or a public API URL. It never runs on startup or as a normal migration.

The fixed demo tenant is `c7a54fc9-6050-4c6b-8912-5bc476676b1a`, slug `inspectai-synthetic-rail-demo`. Its name explicitly says **Synthetic rail demonstration — not operational**. Do not point the seed at customer data.

The eight rail departments below own the synthetic assets/forms. The existing account-provisioning trigger also creates a General department; it is not an extra rail department or a blanket membership for departmental personas.

The fixture supplies 60 assets, 20 distinct rail forms with 10 meaningful questions each, 20 seeded work orders, 27 Auth personas, and eight departments. Three additional form revisions demonstrate Draft, Awaiting approval and Previous version/Published states. Inspection states include open, in progress, signed pass and signed fail. Required notes, readings, N/A reasons, photo evidence and authenticated signatures are exercised. Labels, locations, asset details and equipment scenarios are fictional. Numerical examples use explicitly fictional demo units, not operational rail tolerances. Evidence images and signatures used by fixtures are synthetic test images, not photographs or human sign-offs.

| Department | Assets | Distinct forms |
| --- | ---: | ---: |
| Rolling Stock | 10 | 3 |
| Signalling | 10 | 3 |
| Permanent Way | 10 | 3 |
| Traction Power | 8 | 3 |
| Communications | 6 | 2 |
| Station Mechanical | 6 | 2 |
| Station Electrical | 6 | 2 |
| Depot Equipment | 4 | 2 |

## See the full sample data in the app

Pulling code and signing in with an existing account does **not** switch the
account's workspace. The verification-workflow workspace contains deliberately
tiny one-question forms used by automated checks. Those are not the rail sample
forms. Customer/legacy workspaces also do not share the rail-demo records.

1. Start the updated backend and frontend using `LOCAL_WINDOWS.md`.
2. Preserve/copy the existing ignored `backend/.env.rail-demo.json` from the
   original checkout. The update helper now copies it when present and never
   overwrites a destination file. If it is missing, use the guarded provisioning
   instructions below; do not invent a password or place credentials in Git.
3. In the backend terminal run **`npm run check:rail-demo`**. This uses the
   fixture's administrator through the normal login API and verifies the data
   through the same permission-enforced APIs as the UI. It prints counts and
   workspace name, never passwords or tokens. It checks 60 sample assets, 20
   published sample forms, at least 10 answerable questions on each form, and
   20 work orders. It does not reseed or change inspection content; normal login
   creates an authentication audit event.
4. Sign out of the app. Open the ignored JSON file **locally** and use
   `personas.admin.email` and `personas.admin.password` on the normal login page.
   Do not paste credentials into chat. Confirm the visible workspace is
   **Synthetic rail demonstration — not operational**.
5. Open Assets with search cleared and status **All statuses**. Open Inspection Forms
   with department **All departments**, search cleared, **Created by me** disabled and
   **Published** selected: expect 20 published forms with 10 questions each.
   The All forms tab also includes three additional revisions.
6. Open Inspections, clear search and select **All statuses** for the 20
   seeded work orders. Department-specific author,
   reviewer and inspector accounts deliberately see only permitted subsets.

The current workspace name is supplied by the backend on sign-in and session
reload and is visible on every working page and in the account menu. It is
informational; authorisation still uses the authenticated tenant, department,
capability and assignment checks. There is no cross-tenant switch or shared
demo password.

## Credentials and personas

Generated, unique passwords and synthetic emails are saved only in ignored `backend/.env.rail-demo.json`. Open that file locally; do not paste it into chat or commit it. Persona keys include `admin`, `viewer`, `cross-reviewer` and department-specific keys such as `RS-author`, `RS-reviewer`, `RS-inspector`, `SIG-author`, etc. The cross-reviewer has explicit Signalling and Rolling Stock memberships. Authors have author/viewer capabilities and no administrator or approval capability. Reviewers have reviewer/viewer capabilities and no author capability. Inspectors are assigned within their own department.

Each Auth account is created through the supported Supabase Auth admin API; metadata does not assign application privileges. App profiles and memberships are provisioned in the fixed demo tenant by the controlled fixture setup. The workflow verifies each used persona against Supabase Auth and the current application profile/session fingerprint, then uses the existing server token issuer for fixture sessions. Interactive login throttling remains enabled. All assets, forms, approvals, orders, findings, evidence and completion go through protected application APIs and database integrity guards.

## Standalone administrative setup

Securely configure server-only `MIGRATION_DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, the existing runtime `DATABASE_URL`, `SUPABASE_URL` and `JWT_SECRET` in the ignored backend environment. The migration connection must identify the same staging project and have administrative provisioning privileges. Keep the local backend running on port 4000.

```powershell
cd C:\Users\reyva\vsCodeProjects\InspectionAI\inspectai\backend
npm run seed:rail-demo -- --project-ref ehrgsakhrpbtintshjha --confirm-synthetic-demo
```

Re-running preserves existing seeded assets/forms/orders and signed payloads. It does not reset in-progress demonstration work. A failed initial run can resume from its persisted identities and existing entities. The backend suite verifies counts and signed-record counts after repeated runs.

## Setup through the connected database administrator

When an administrative database URL is unavailable locally, use the existing Supabase connection for the controlled provisioning step:

```powershell
npm run build
node scripts/seed-rail-demo.mjs --project-ref ehrgsakhrpbtintshjha --confirm-synthetic-demo --prepare
```

This creates/reuses only the fictional Auth personas and writes ignored `.env.rail-demo.provision.sql`. Review its fixed tenant identity checks, Auth UUIDs, department/profile inserts and explicit cross-review membership. Apply it to the verified staging project as the connected database administrator. Read the file as **UTF-8**; its label contains an em dash. The SQL contains no passwords or server keys. Then run the workflow with the normal restricted runtime connection:

```powershell
node scripts/seed-rail-demo.mjs --project-ref ehrgsakhrpbtintshjha --confirm-synthetic-demo --workflow-only
```

This is the provisioning route used for the reviewed staging demo. Access the app at `http://127.0.0.1:3000` using a persona from the ignored credentials file.

## Retire the demo safely

```powershell
node scripts/seed-rail-demo.mjs --project-ref ehrgsakhrpbtintshjha --confirm-synthetic-demo --workflow-only --cleanup
```

Cleanup deactivates only this demo tenant's app profiles, immediately blocking existing application sessions and future app logins. It deliberately retains signed records and audit history; it does not disable integrity triggers, purge history or alter customer tenants. Full reprovisioning (or the reviewed prepare/provisioning step) reactivates the fictional accounts when the demo is needed again. Never treat a seed cleanup as a customer-data deletion mechanism.
