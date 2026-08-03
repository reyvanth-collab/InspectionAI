# Production readiness checklist

## Completed in code

- Production startup validates database, Supabase, frontend, and JWT configuration.
- Placeholder Anthropic credentials are rejected in production.
- JSON request limits support the 20 MB inspection-photo limit without allowing unbounded payloads.
- Photo analysis validates media type and base64 payload size.
- Database schema and the assets migration include asset RLS and canonical work-order links.

## Must be completed against the deployment environment

1. Apply `inspectai/supabase/schema.sql` to a new environment, or run the migrations in order for an existing environment.
2. Confirm the `assets`, `asset_record_id`, indexes, trigger, and RLS policies exist in Supabase.
3. Verify two tenant accounts cannot read or mutate each other’s assets, work orders, or inspection records.
4. Set production secrets outside source control and confirm no placeholder values remain.
5. Test offline inspection queueing, reconnect synchronization, duplicate submission, and browser refresh recovery.
6. Test AI timeout, invalid image, provider outage, and rate-limit responses.
7. Test MOMS import size/type limits and reject malformed spreadsheets.
8. Configure database backups, log retention, and an alert for repeated 5xx responses.
