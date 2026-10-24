# InspectionAI

Online inspection workflow release candidate. See [release scope, checks and deployment](inspectai/docs/RELEASE.md).

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
