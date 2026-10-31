# Question assessment, user access and report catalogue

Branch: `feature/question-policy-users-reports`, based on reviewed commit `03cb086`.
The earlier local pagination labels and `npm run check` alias are retained.

## Question behaviour

Response type, requiredness and assessment are independent. Each answerable
question has **Require Pass/Fail assessment**, a separate **Permit N/A** option,
and manual, expected-answer or configured numeric-limit modes. Condition checks
and measurements start with assessment enabled; information, dates, photos and
signatures start without assessment. Explicit settings survive response-type
changes, duplication, editing and revisions. Incompatible combinations must be
corrected before saving/submitting. Headings have no response or assessment.

The policy is stored in the existing versioned `conditional_json` definition:
`assessment: {required, mode, expectedAnswer?, optionMap?}` and `allowNA`.
Missing assessment configuration deliberately retains legacy manual behaviour
and legacy optional-question rules. Published definitions are not backfilled or
changed. **No database migration or new grants are required.**

Frontend and backend use the same tested policy implementation. Drafts still
accept incomplete input; strict validation runs when progressing to review and
again on signing. Derived assessments use explicit saved rules. Yes/No has no
implied result, valid readings outside explicit limits are failures, and malformed
numeric input is an error. Failure notes, photos and N/A reasons remain enforced.
Information answers retain a null result. New information-only completions have
no overall assessment result and display **Completed — no assessed checks**.

New signed snapshots (version 4) include the saved configuration, question
lineage, explicit assessment/answered flags and assessment summary. Existing
signed records and their hashes remain immutable. The PDF renderer verifies the
signed snapshot and labels information, N/A and unanswered items separately.

## Approval confirmation and validation

Submission saves the draft, validates it and prepares a confirmation showing the
reference, revision, department and ordered reviewers. **Preview form** opens a
clearly labelled inspector preview; **Keep editing** preserves fields and reviewer
selections. Only the final **Submit for approval** changes the lifecycle.

The server binds confirmation to saved form/questions, authenticated actor and
ordered reviewers using an HMAC. It checks that content again while holding the
form lock. Changed content or reviewers require fresh confirmation; duplicate
submissions are rejected. Independent-reviewer and contributor restrictions are
unchanged. The detail page routes submission through the common editor flow.
Draft updates also support an expected update timestamp and retain local input
when a concurrent edit is detected.

Validation summaries link to affected controls, reveal the containing section,
show inline descriptions, set `aria-invalid`/`aria-describedby` and focus the first
invalid control. This covers inspection progression, form editing/submission,
asset/work-order creation, department creation, approval decisions and user access.
Draft persistence remains separate from completion validation. API field errors
are retained by the frontend error type for mapping to question controls.

## Users & Access

The administrator table searches name, email and staff ID; filters department,
capability and account status; and sorts/paginates on the server with matching
totals. Phone rows expose additional access through expandable details. Actual
capabilities, rather than legacy role labels, determine what is shown.

The existing access endpoint retains current-profile checks, self-change denial,
tenant validation and transactional before/after auditing. A reason is required.
Changing primary department removes its previous implicit membership; retaining
that access requires an explicit additional-department selection. Saving never
silently applies a legacy role bundle.

## Report definitions and limits

The catalogue opens six named reports. All aggregates are calculated by the
backend over the full authorised filtered dataset; pagination affects presentation
only. Signed-condition reports use immutable snapshot observations from completed
signed inspections, excluding drafts and save events. Current workload is a
separate report over work orders created in the selected range, with overdue
evaluated against actual due dates and current completion status.

* Frequently failing assets: failed items, distinct inspections containing failures,
  signed inspection exposure, assessed inspection exposure and both failure rates.
  Item failure rate uses passed + failed assessed items; inspection failure rate
  uses inspections containing evaluated checks. Information-only inspections are
  visible exposure but do not dilute condition rates.
* Failure Pareto: stable checkpoint identity plus compatible recorded definition
  and classification; counts and cumulative percentage use signed failures.
* Repeated failed observations: the same asset/checkpoint fails in at least two
  distinct signed inspections; dates and supporting records are shown. It makes
  no claim that repair or closure occurred between observations.
* Failure trends: UTC month or Monday-based week, raw failures, assessed denominator,
  failure rate and signed inspection volume. Increased volume alone is not evidence
  of worse reliability.
* Completion and overdue: assigned/open/in-progress/completed work and actual dates;
  this is current workload, not a condition-outcome report.
* Measurement trends: numeric readings grouped by asset, checkpoint, exact form
  revision, units, limits and compatible definition. Unrelated revisions or units
  are never merged. Missing units remain explicitly unrecorded.

Historical questions without lineage use their exact recorded form/question IDs;
labels are not treated as identity. Missing classifications are **Unclassified**.
There is no inferred component hierarchy, repair metric, failure cause or predictive
analytics. Charts have accessible data tables and authorised supporting-inspection
links. CSV and printable output include all filtered rows, and CSV text is guarded
against spreadsheet formulas. Individual completed-inspection PDFs remain on the
inspection record.

## Safe local update and checks

The prepared checkout is `C:\Users\reyva\vsCodeProjects\InspectionAI-november`.
First inspect `git status --short`; preserve any edits before switching branches
or fast-forwarding. Never reset or overwrite ignored environment files.

```powershell
cd C:\Users\reyva\vsCodeProjects\InspectionAI-november
git status --short
git fetch origin feature/question-policy-users-reports
git switch feature/question-policy-users-reports
git merge --ff-only origin/feature/question-policy-users-reports

cd inspectai/backend
npm ci --ignore-scripts
npm test
npm start
```

In another terminal:

```powershell
cd C:\Users\reyva\vsCodeProjects\InspectionAI-november\inspectai\frontend
npm ci --ignore-scripts
npm test
npm run lint
npm run build
npm run dev -- --host 127.0.0.1 --port 3000 --strictPort
```

The app is at `http://127.0.0.1:3000`. Use the ignored demo credential file locally;
verify the synthetic workspace banner. No credentials are printed or committed.
Backend `npm run check` verifies rail fixtures through normal protected APIs.
The backend suite replays migrations in PostgreSQL/PGlite and includes policy,
approval-integrity, report, export and permission tests. Browser checks run with:

```powershell
$env:PLAYWRIGHT_CHANNEL='chrome'
node node_modules/@playwright/test/cli.js test --workers=1 --reporter=line
# Explicit staging acceptance; creates/reuses only clearly synthetic fixtures:
$env:VERIFY_LIVE_POLICY='true'
node node_modules/@playwright/test/cli.js test live-policy.spec.ts --workers=1 --reporter=line
```

The live test reuses IDs in ignored `.env.policy-owner.json` and already signed
results on subsequent runs. It uses normal author, independent reviewer and
inspector sessions. Session files remain ignored and failure diagnostics clear
login inputs. Repeated interactive login is subject to the unchanged 10-attempt,
15-minute throttle. Native printer dialogs are not automated: the live check
verifies the loaded authenticated PDF is the document targeted by Print, while
PDF parsing/rendered pages verify layout. Physical printing remains an owner check.

## Verified delivery

Backend build and tests passed: 59 release assertions, 589 workflow/permission
assertions, 26 draft/report assertions and 53 policy/report assertions. Fresh
migration replay and the preserved legacy-schema upgrade check passed. Frontend
session tests, lint, build and 19 mocked desktop/phone browser checks passed.
Hosted tests remain opt-in; the new live policy workflow passed separately.

The live workflow created/reused only `SYNTHETIC-POLICY-MIXED` and
`SYNTHETIC-POLICY-INFORMATION` in the dedicated rail-demo tenant. It verified
independent approval, incomplete draft persistence, explicit Yes/No rules,
numeric failure/evidence, information-only signing, report denominators and
department denial. Both signed PDFs downloaded successfully. The print target
was verified without opening a native printer dialog. Generated PDF fixtures
and the live PDFs were parsed and rendered for visual layout review.

All 14 pre-existing hosted signed records retained digest
`d82876cdf9c07ac267a0fd167008d41f` for their original IDs. Existing published sample
questions and all ignored configuration/credential copies were preserved.

Production dependency audits are clean. The frontend locks `follow-redirects`
to patched version 1.16.2 for [GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p).
The full development dependency audit still reports 15 moderate notices in the
existing ESLint/glob chain with no automatic fix available. Those packages are
not shipped in the production runtime. The hosted advisors show the same
pre-existing leaked-password-protection warning and intentionally private
migration-registry information; no RLS/grant changes were made.
