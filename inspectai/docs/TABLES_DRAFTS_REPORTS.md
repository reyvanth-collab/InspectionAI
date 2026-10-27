# Tables, inspection drafts and completed reports

Feature branch: `feature/tables-drafts-inspection-pdf`, based on release commit `964eb9e`.

Assets, Inspections and Inspection Forms use a shared accessible table. Desktop columns retain full values with wrapping. Phone rows show references and descriptions with an explicit expandable Details control. Column buttons sort on the server using fixed SQL identifier maps and a stable ID tie-breaker. Search, lifecycle/status/department/approval filters, pagination and matching totals use the authorised dataset.

Inspection edits are saved as versioned drafts after a short quiet period. Incomplete responses are stored separately from final findings. Results, readings, notes, N/A explanations and photo evidence remain distinct; missing results remain unanswered. The browser serializes writes and preserves newer edits while a previous request finishes. Failed writes retain input in memory for retry. There is no local-storage draft, offline queue or offline replay. Unsaved navigation prompts include browser back/forward and page unload.

Each draft update locks its inspection and checks the expected version. A stale tab receives a conflict and retains its local edits; loading the latest version requires explicit confirmation that local edits will be discarded. Lost-response retries with identical content are idempotent, including evidence. Draft audit events contain version/question IDs, excluding response/image payloads. Existing signed-record guards and tenant/department/assignment rules remain active.

Review & sign asks “Save your responses and continue to review?” Keep editing closes the dialog. Save & review waits for draft persistence and displays missing/invalid responses, failed items and evidence. Server review validates final answers and returns a digest bound to the actor, record, version and exact saved items. Signature submission checks that state again and uses the authenticated signer. A later edit invalidates review. Final findings, signed payload and work-order completion are committed together. The legacy findings API is rejected once an inspection has a versioned draft; existing fixture/older-client workflows without a draft retain their final validation path.

Download report PDF and Print report request the same authenticated PDF document. The report is built from the immutable signed payload and signing metadata; current asset/form/profile values are not substituted for unavailable historical information. New snapshots retain workspace, signer, form reference/title/revision, question sections/layout/units, separate N/A reasons, evidence and signature. Legacy unavailable fields are labelled. Hash validation runs before rendering, and no public report URL or shared PDF cache is created.

The A4 template includes repeated checklist headings, page numbers, evidence captions, structured response tables and safe wrapping of long Unicode content. Puppeteer Core is a pinned runtime dependency. The production image supplies Chromium and Noto fonts, runs as the existing unprivileged container user, and uses temporary writable Chromium directories. Chromium's inner sandbox is disabled in that container; the renderer has JavaScript disabled, accepts only validated inline images, escapes text, blocks remote/file requests and allows at most two simultaneous renders. Windows uses installed Chrome, or an explicitly configured `PDF_CHROMIUM_PATH`. PDF import/extraction is not supplied.

## Database update

`20261027150153_inspection_drafts.sql` is additive: one draft table, tenant index, RLS, and guard/audit triggers. It does not backfill or alter signed records. It is already applied and recorded in the explicitly authorised `inspectai` staging project (`ehrgsakhrpbtintshjha`). The 11 previously signed records retained combined digest `4eaac46166daa6da42a9597565629c07` immediately after migration and after live acceptance (excluding the new acceptance record).

Other environments need the normal migration runner with a separate administrative `MIGRATION_DATABASE_URL`. Keep the web app on `inspectai_runtime`. Readiness now also requires draft guards and RLS; investigate a 503 rather than relaxing the controls.

## Safe local update

Preserve the original checkout and ignored files. On the prepared sibling checkout, inspect status before switching/updating:

```powershell
cd C:\Users\reyva\vsCodeProjects\InspectionAI-november
git status --short
git fetch origin feature/tables-drafts-inspection-pdf
# Continue only when local changes have been preserved and this branch is checked out:
git switch feature/tables-drafts-inspection-pdf
git merge --ff-only origin/feature/tables-drafts-inspection-pdf
```

If the target has edits or divergent commits, preserve and integrate them on a child branch. Do not reset. On another computer, use `LOCAL_WINDOWS.md` and its helper to prepare the release sibling checkout first, fetch the feature, then create a local branch tracking it. Reuse an existing worktree if Git says the branch is already checked out.

Keep backend/frontend `.env`, frontend `.env.local`, demo `.env.rail-demo.json` and the database CA file ignored. The setup helper copies only missing `.env` and demo files; copy an existing frontend `.env.local` only when the destination is missing. Preserve certificate paths or copy/repoint the same trusted CA securely.

```powershell
cd inspectai/backend
npm ci --ignore-scripts
npm test
npm start
```

In another terminal:

```powershell
cd inspectai/frontend
npm ci --ignore-scripts
npm test
npm run lint
npm run build
npm run dev -- --host 127.0.0.1 --port 3000 --strictPort
```

Stop only an older InspectionAI process on the requested port. Open `http://127.0.0.1:3000`; sign in normally with `personas.admin` from the ignored demo file. Confirm the synthetic workspace banner. The existing 60 assets and 20 published sample forms remain. Live acceptance adds one clearly labelled work order, so the demo now has 21 orders. The original sample signed records are preserved.

## Verification

The backend suite replays all migrations in PostgreSQL/PGlite and tests real Express handlers/RLS with stubbed Auth. Added coverage includes pages beyond the first, sort injection fallback, incomplete reload, idempotent retry, stale drafts, department/capability denial, evidence requirements, stale review rejection, post-sign rejection, distinct N/A notes, report access and snapshot content. It creates representative PDF fixtures in ignored `backend/.env.pdf-checks`.

```powershell
cd inspectai/backend
node scripts/verify-report-layout.mjs
# Optional legacy snapshot verification, using the ignored original local snapshot:
node scripts/verify-legacy-upgrade.mjs ../../../InspectionAI/.env.hosted-pre-migration.snapshot.json
```

The PDF layout check parses document text and renders representative pages for visual inspection. Fixtures cover ordinary reports, a 61-page Unicode stress report, a structured response table, and a live four-page report with a large image and actual synthetic signature.

```powershell
cd inspectai/frontend
$env:PLAYWRIGHT_CHANNEL='chrome'
node node_modules/@playwright/test/cli.js test --workers=1 --reporter=line
# Explicit hosted acceptance; creates/reuses one isolated synthetic work order:
$env:VERIFY_LIVE_DRAFT_REPORT='true'
node node_modules/@playwright/test/cli.js test live-drafts-report.spec.ts --workers=1 --reporter=line
```

Mocked browser tests cover phone/desktop tables, save failure/retry, incomplete input, rapid edits, navigation warning, both confirmation actions, failed photo persistence and signing gates. The opt-in live test uses normal hosted Auth and tests a real two-tab conflict, reload, evidence, review, signing and PDF download. Re-runs preserve its signed result. No credential values are recorded in traces or output.

GitHub CI also renders a PDF inside the production image with a read-only root and temporary `/tmp`. Docker is unavailable on the local Windows tool path, so the actual image check runs in CI. Physical printers/devices, recovery email, production concurrency/load and backup restoration remain separate acceptance checks.

Local results: backend build, 58 release assertions, 518 department/workflow assertions and 26 additional draft/report assertions passed. Fresh migration replay and legacy snapshot upgrade passed. Frontend session tests, lint and production build passed; 11 mocked browser checks passed, with the four hosted tests opt-in by default. The new hosted draft/report browser check passed separately against staging. Backend and frontend production dependency audits reported zero advisories. The staging security advisor has the same pre-existing leaked-password warning and intentionally private migration registry information; this patch added no new security advisory.
