# Local development in VS Code (Windows PowerShell)

Install Git and Node.js 24. Open the repository folder in VS Code. For an existing clone:

```powershell
git fetch origin
git switch fix/production-release-hardening
git pull --ff-only
```

The main branch does not contain the release-candidate work. The standalone inspection-app-v9.html is an older prototype, not the app to run.

## Frontend-only preview

```powershell
cd inspectai/frontend
npm ci
Copy-Item .env.example .env
code .env
npm run dev
```

Populate VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY with the actual staging project's public configuration when available. Placeholder configuration may render the sign-in page, but does not supply a functioning database, account, login, or password-recovery service. Open http://localhost:3000. The development proxy now uses the configured project rather than an old hardcoded project.

## Full local workflow

A fresh Supabase project must first have the production schema, release migrations, a tenant, and invited auth users with matching public.users profiles. Follow RELEASE.md/NEW_SETUP.md. Running only npm install/dev does not create accounts or a database. Render is not required for local development.

In a separate VS Code terminal, starting at repository root:

```powershell
cd inspectai/backend
npm ci
Copy-Item .env.example .env
code .env
npm run dev
```

Set DATABASE_URL to the migrated staging runtime-role connection, generate JWT_SECRET, retain NODE_ENV=development, PORT=4000 and FRONTEND_URL=http://localhost:3000. Set the actual Supabase backend configuration; remove unused placeholder AI keys and leave optional AI/import flags false. Never put the service-role key in the frontend environment file.

For migrations use administrative credentials in a temporary environment variable, not in the web app's .env:

```powershell
$env:MIGRATION_DATABASE_URL = '<administrative staging connection>'
npm run db:migrate
Remove-Item Env:MIGRATION_DATABASE_URL
```

The app's DATABASE_URL must use its restricted runtime role. Provision that role and test accounts as described in RELEASE.md before login. Check http://localhost:4000/api/health and http://localhost:4000/api/ready; readiness should be successful only after migration.

For local password recovery, allow http://localhost:3000/reset-password in Supabase redirect URLs. Default email restrictions still apply; do not assume ordinary user email delivery is configured.

## Development status

The online inspection flow has automated regression coverage. Offline replay/AI assistance are disabled; SSO and enterprise integrations are not supplied. A local run is a test, not production acceptance. Browser/device and live database/email/backup checks remain separate release gates.
