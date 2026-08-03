# Scaling checklist

## Implemented

- Database-backed `job_queue` table with retry fields and tenant ownership.
- `FOR UPDATE SKIP LOCKED` job claiming for multiple workers.
- Bounded API pagination for assets and work orders.
- Configurable PostgreSQL pool size through `DB_POOL_MAX`.
- Concurrency-safe work-order number allocation.
- Repeatable load-test command without extra dependencies.
- Standalone worker process with graceful shutdown and retry handling.

## Run a smoke load test

Start the backend first, then run:

```powershell
cd inspectai/backend
$env:LOAD_TEST_URL='http://localhost:4000/api/health'
$env:LOAD_TEST_CONCURRENCY='20'
$env:LOAD_TEST_REQUESTS='500'
npm run load-test
```

For authenticated endpoint testing, set `LOAD_TEST_URL` to a tenant-scoped GET endpoint and provide `LOAD_TEST_TOKEN`.

## Still required before multi-instance production

- Run the job worker as a separate process/service.
- Add handlers for AI, reports, and MOMS imports; notification handling is available.
- Move rate-limit state to Redis or another shared store.
- Run load tests against a staging database with realistic data.
- Verify p95 latency, error rate, database saturation, and queue latency.
