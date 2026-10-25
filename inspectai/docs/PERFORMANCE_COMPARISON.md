# Local PostgreSQL versus Supabase staging

Use the same integrated application commit and representative synthetic records in both environments. Keep the laptop backend connected to local PostgreSQL for the local run. For staging, deploy the backend near the Supabase database (Singapore in the current staging plan). Benchmark the deployed backend URL, not a laptop backend connected over the internet to Supabase.

Before measuring, check `/api/ready` on each backend. It must return HTTP 200. A health check alone does not test database access.

From `inspectai/backend`, set these environment variables for one environment at a time:

```powershell
$env:BENCH_BASE_URL = 'http://127.0.0.1:4000'
$env:BENCH_EMAIL = '<test-user-email>'
$env:BENCH_PASSWORD = '<test-user-password>'
npm run benchmark:api
```

Then change `BENCH_BASE_URL` to the HTTPS staging origin and use the staging test user's credentials. The script logs no password or token. It makes one login request, warms each endpoint once, then measures 20 sequential authenticated requests per endpoint and reports p50/p95/max in milliseconds. All measured endpoints are read-only. Set `BENCH_SAMPLES` between 3 and 100 if needed.

Compare p95 for login, inspection list, work instructions, dashboard summary and reports. Run each benchmark several times, including after the staging service has slept, because a cold start and steady-state latency are different. Record data volume and host region alongside results. The existing `load-test` script measures concurrency separately; its default health endpoint is not a database performance test.

The application selects the database with backend `DATABASE_URL`. Keep the administrative `MIGRATION_DATABASE_URL` out of the runtime service. Supabase staging also requires the matching public frontend URL/key and backend-only service key. See [NEW_SETUP.md](NEW_SETUP.md) and [RELEASE.md](RELEASE.md) for migration and restricted runtime-role setup. Do not copy the laptop's live records to staging before reviewing whether they contain sensitive data; synthetic records are sufficient for the first comparison.
