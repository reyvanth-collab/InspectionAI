# Operations guide

## Health endpoints

- `/api/health` confirms the process is running and reports version/uptime.
- `/api/ready` verifies that the API can reach PostgreSQL. Route traffic only to ready instances.
- `X-Request-Id` is returned on every response and should be included in support tickets and log searches.

Verify a staging database after applying the schema/migration:

```powershell
cd inspectai/backend
npm run verify:staging
```

## Shutdown and deployment

The API and worker drain cleanly on `SIGTERM`. Deployments should stop sending traffic, wait for readiness to leave service, then allow up to 15 seconds for connections to drain.

Run separate processes for:

```powershell
npm start
npm run worker
```

## Required external monitoring

- Alert on readiness failures, sustained 5xx responses, p95 latency, database saturation, and queued/failed jobs.
- Store logs centrally with the request ID, tenant ID, route, status, and duration.
- Keep database backups and test restoration before onboarding external customers.
