# Inspection workflow QA

Run this checklist against a non-production tenant after applying the Supabase schema/migration.

## Automated checks

```powershell
cd inspectai/backend
npm test
npm run build

cd ../frontend
npm run lint
npm run build
```

## End-to-end smoke test

1. Sign in as an admin or approver.
2. Create an asset with a number, name, location, status, criticality, and PM date.
3. Verify the asset appears in the asset list and summary counters update.
4. Edit the asset and change its status to `maintenance`; verify the change persists.
5. Create a work instruction with at least one checklist item and submit/approve it.
6. Create a work order and select the registered asset from the asset selector.
7. Verify the work-order list shows the asset name and location from the asset register.
8. Open the work order, start the inspection, complete checklist items, and save a finding.
9. Complete the inspection and verify the completion result/report.
10. Confirm the asset's open-work-order and completed-inspection counts update.
11. Sign in as a different tenant and verify the asset and work order are not visible.
12. Attempt duplicate asset number, invalid dates, and an asset from another tenant; verify clear 4xx errors.
