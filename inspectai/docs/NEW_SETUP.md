# New staging setup: Supabase + Render

Selected configuration: Supabase Free, Singapore ap-southeast-1, project name inspectai-staging; Render Free web service, Singapore, using render.yaml at repository root. This is a test environment with synthetic records only. No paid plan, custom domain, paid AI or production data is required for this first step.

## Account connection

The owner must create and authenticate their own Supabase and Render accounts and authorise the relevant ChatGPT integrations. These steps establish ownership and cannot be completed merely from GitHub repository access. Credentials should go through provider connection/secret interfaces, never source control. Do not upgrade accounts or create paid resources as part of initial staging.

## Provisioning sequence after both connections are confirmed

1. Inspect accessible organisations/workspaces and select the owner's free workspace. Create a fresh Supabase project in the specific Singapore region with a generated, securely stored database password. Keep it separate from any existing project referenced by older code.
2. Apply the production schema and both 20261025 migrations through an administrative connection. Do not apply demo-seed.sql. Follow RELEASE.md for migration tracking, runtime role and API-only grants. Enable runtime-role login with a generated password and retain the admin connection outside the web service.
3. Use a TLS PostgreSQL endpoint reachable from Render. Check IPv4/IPv6 and custom-role/session-pooler support against the actual project; do not assume a direct database hostname is IPv4 reachable. Use a session-compatible connection and certificate verification. Validate the restricted role before deploying.
4. Import render.yaml. Keep plan=free and autoDeployTrigger=off. Render handles HTTPS and reverse proxying; Docker/Caddy compose is an alternative self-hosting path and is not needed on Render.
5. Set DATABASE_URL to the restricted runtime connection, SUPABASE_URL and VITE_SUPABASE_URL to the same fresh project URL, VITE_SUPABASE_ANON_KEY to the project's public legacy anon key (the current frontend SDK configuration), and the backend-only service key as required by current startup checks. Never use service/admin keys for VITE_ variables. FRONTEND_URL must equal the actual allocated HTTPS Render origin; do not assume the requested service name determines the final hostname.
6. Supabase Auth site URL and allowed recovery redirect must match the allocated origin and /reset-password. Create owner test accounts and their application tenant/profiles without publishing or storing user passwords in Git.
7. Deploy manually, verify /api/health and /api/ready, then exercise login, independent approval, measurements/photos, sign/reload/report, invalid roles, two tenants and credential reset. Confirm data persists after the free service sleeps/restarts. Free instances are not an uptime/load or production acceptance environment.
8. Supabase's default email provider only delivers to project-team addresses and is heavily rate limited. Test owner recovery within those restrictions; before inviting ordinary users, configure custom SMTP with an owned verified sending domain and retest delivery. Do not add users as project administrators merely to bypass email restrictions.

## Cost and release gates

Staging targets free included quotas; limits still apply. Render Free sleeps on inactivity, and Supabase Free projects may pause. Do not treat a successful free staging deployment as production sign-off. Before actual users, choose always-on hosting, appropriate database backups, custom SMTP, restore/monitoring policies and realistic capacity, and confirm their then-current bill with the owner before creating paid resources.

Primary references checked during preparation:
- https://render.com/docs/blueprint-spec
- https://render.com/docs/docker
- https://render.com/docs/free
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/regions
- https://supabase.com/docs/guides/auth/auth-smtp

Connection state at preparation: no Supabase or Render account connection confirmed; no cloud project, service or live URL has been created.
