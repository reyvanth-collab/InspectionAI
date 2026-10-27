# InspectionAI

Online inspection workflow release candidate. See [release scope, checks and deployment](inspectai/docs/RELEASE.md).

Current focused workflow: [start, permissions, migration strategy and verification](inspectai/docs/FOCUSED_APP.md). Optional fictional rail data: [safe seed and cleanup](inspectai/docs/RAIL_DEMO.md).

```sh
cd inspectai/backend
npm ci
npm test
cd ../frontend
npm ci
npm test
npm run lint
VITE_SUPABASE_URL=https://example.invalid VITE_SUPABASE_ANON_KEY=test-build-only npm run build
```

The example build uses inert configuration for compilation only. Use your actual project configuration when deploying. Do not use the legacy standalone HTML prototype as a production application. Demo seed data and historical exports are not part of the release image.

## November product release

The current product follow-up is on `release/november-product-completion`.
See [the deliverable review and 30 November release gates](inspectai/docs/NOVEMBER_RELEASE.md)
and [safe VS Code setup/update instructions](inspectai/docs/LOCAL_WINDOWS.md).
