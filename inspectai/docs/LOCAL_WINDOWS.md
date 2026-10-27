# Run or update InspectionAI locally

Use Git and Node.js **24**. The current product branch is
`release/november-product-completion`. `main` and the older hardening branch do
not contain the complete departmental product work. Run the React/Express app,
not the old standalone HTML prototype.

## Safest update: a separate checkout

In a PowerShell terminal at the root of your existing InspectionAI clone:

```powershell
git fetch origin release/november-product-completion
if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the release branch' }
$helper = Join-Path $env:TEMP 'inspectai-prepare-local.mjs'
git show FETCH_HEAD:inspectai/scripts/prepare-local.mjs | Set-Content -Encoding utf8 $helper
if ($LASTEXITCODE -ne 0) { throw 'Could not load the update helper' }
node $helper --repo .
```

The helper creates a sibling `InspectionAI-november` folder on
`local/november-product`, tracking the release branch. It preserves the original
checkout, including uncommitted work. Existing ignored backend/frontend `.env`
files are copied only when the destination does not already have them. Their
contents are never printed. No database migration, seed, install or app startup
runs automatically.

Run the same commands again for a safe fast-forward update. If the new folder
has edits or divergent commits, the helper stops without discarding them. Ask
Codex to compare and integrate those changes; do not use `reset --hard`. If the
local branch name is already in use in another worktree, open that worktree
(`git worktree list`) rather than creating a duplicate.

Open the new folder in VS Code. Before editing, your Codex should read
`inspectai/docs/NOVEMBER_RELEASE.md`, check `git status`, and use the current
release branch as its base. Do not merge an old laptop branch over this work.

## Install and start

Use two terminals in the new checkout:

```powershell
cd inspectai/backend
npm ci
# Only on a new setup, if .env does not already exist:
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

```powershell
cd inspectai/frontend
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Open **http://localhost:3000**. The API is on **http://localhost:4000**.
Stop older instances on these ports first; do not kill unrelated processes.
Render is not needed locally.

A full workflow requires a migrated staging database and provisioned users.
The backend `.env` needs its actual `SUPABASE_URL`, server-only Supabase key,
`DATABASE_URL` for the restricted `inspectai_runtime` role, and `JWT_SECRET`.
Use `NODE_ENV=development`, `PORT=4000`, and
`FRONTEND_URL=http://localhost:3000`. The frontend needs only the project's
`VITE_SUPABASE_URL` and public `VITE_SUPABASE_ANON_KEY`. Never copy privileged
server/database credentials into frontend variables. Leave optional AI/import
flags off. Example values do not create accounts or a working database.

## Database updates are a separate step

Identify the staging target and take a verified backup before migrating an
existing database. With an administrative connection supplied securely:

```powershell
cd inspectai/backend
$env:MIGRATION_DATABASE_URL = '<administrative staging connection>'
npm run db:migrate
Remove-Item Env:MIGRATION_DATABASE_URL
npm run verify:staging
```

Do not change the web app's runtime `DATABASE_URL` to administrator credentials.
See `FOCUSED_APP.md`, `NEW_SETUP.md` and `RELEASE.md` for provisioning and migration
details, and `RAIL_DEMO.md` for the opt-in fictional demo tenant. No new schema
migration is required by the November follow-up patch itself; all existing
focused-workflow migrations are still required.

`/api/health` confirms the process runs. `/api/ready` must return 200 only with
the restricted runtime role, enabled inspection guards, department RLS and
restrictive access policies. A 503 is a setup failure to investigate, not a
reason to weaken the controls.

For recovery links, allow `http://localhost:3000/reset-password` in Supabase.
Configure and test recovery email delivery separately.

## Verify before sharing changes

```powershell
cd inspectai/backend
npm test
cd ../frontend
npm test
npm run lint
npm run build
npx playwright install chromium
npx playwright test --reporter=line
```

The build needs real public Supabase configuration. CI uses inert values only
for mocked browser tests. Live acceptance, email, backup restore, load and
physical-device checks remain separate release gates.
