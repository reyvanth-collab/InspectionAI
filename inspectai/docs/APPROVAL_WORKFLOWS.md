# IA-08 / IA-09 — approval workflow designer and Person Groups

Feature branch: `feature/approval-workflow-designer`, based on
`feature/question-policy-users-reports` (`12cfa12`). PR #5 is the parent feature;
this change should be reviewed against that branch. Merging and deployment are
separate decisions. The migration has not been applied to the hosted project.

## Try the canvas without changing staging

Use Node 24 and the locked dependencies in both `inspectai/backend` and
`inspectai/frontend` (`npm ci --ignore-scripts` in each folder). From the backend:

```powershell
npm run demo:workflows
```

This compiles the current app, creates an ephemeral local PGlite database,
replays the migrations, and verifies synthetic API fixtures before opening a
localhost-only preview server. It prints the app URL and the path to
`backend/.env.workflow-browser/credentials.json`. Read the generated `admin`
persona there and use the normal login page. Passwords are not printed. The
preview uses a synthetic password adapter; it does not call hosted Auth or the
hosted database. Existing ignored configuration and demo credentials are not
changed. Stop with Ctrl+C. Preview records are discarded; credentials are
regenerated on the next launch.

1. Open **Settings → Users & Access → Person Groups**. Create a scoped group
   containing the synthetic signalling reviewer and replacement reviewer. The
   table shows status, active members and every draft/active/retired workflow
   reference. Search by group, department or workflow code. Manage membership
   and deactivate/reactivate groups without deleting historical references.
2. Open **Approval Workflows**, choose **New workflow**, set name/code,
   department and default, then create the draft. Use a unique code; a single
   active default is permitted for each exact department scope. A department
   default takes precedence over the all-departments fallback.
3. Drag Start, Group Approval, Individual Approval and Publish from the palette.
   Select the group stage, set its name/group and **Any one eligible member**.
   Select the individual stage and choose **Engineering Manager**.
4. Drag output handles to input handles to build
   **Start → Signalling Reviewer Group → Engineering Manager → Publish**.
   Handles also support click/Enter followed by click/Enter. The properties
   panel's **Next connected stage** control reconnects an edge with a keyboard.
   Remove edges with their minus buttons. Add/remove nodes with the palette and
   node buttons. Focus a node to move it with arrow keys, select it with Enter,
   or remove it with Delete. Zoom, pan and Fit are available as buttons.
5. Save and reload. The graph and node coordinates persist. Move a node and
   preview: route order stays the same. Reconnect edges and preview: order changes.
   Incomplete drafts are allowed; activation shows affected-node errors for
   disconnected routes, loops, branches and invalid assignments.
6. Restore the example route and activate. **Edit active version** creates a
   separate draft. Its later activation retires the prior active version and
   applies only to future submissions.
7. Sign in as the synthetic `author`, create/edit a draft form and submit using
   the existing confirmation. The scoped default route and resolved reviewers
   appear alongside **Preview form** and **Keep editing**. Use the reviewer
   personas to exercise the existing approval inbox. The manager receives a
   task only after the group passes; the form publishes only after the manager.

The preview contains other clearly synthetic API fixtures, including intentionally
incomplete drafts. Select your own workflow before editing. This preview is for
feature review, not for operational inspection records.

## Review of the previous attempt

Retained the native React/SVG canvas, node/edge schema, route validator,
versioned workflow APIs, group candidate resolution, existing confirmation HMAC
integration, one-row-per-reviewer group stages, and the initial tests.

Corrected or completed:

- Native pointer drawing of connectors, keyboard node movement/selection and
  edge reconnection, separated keyboard-add positions, read-only retired
  versions, activation errors within the preview, and prevention of browser
  focus scrolling the canvas away from its graph.
- A dedicated searchable Person Groups page under Users & Access, department
  scope, active member counts, workflow usage, deactivation and membership
  differences that preserve unchanged membership timestamps. Membership changes
  have transactional business audit events.
- Author access to the read-only route endpoint. Designer/group administration
  remains administrator-only; tenant and department checks remain on the server.
- A saved form-content snapshot and hash in every new approval run, in addition
  to the saved version/route/reviewer assignments. Confirmation binds saved
  content, actor, version and resolved reviewers. Changes require confirmation
  again. Each decision checks the submitted content before publication.
- Blocked assignments and stage status, with administrator-only replacement of
  an unavailable reviewer. A reason, eligible independent department reviewer,
  and unused reviewer slot are required. Reassignment retains the group rule,
  required count, original route snapshot, previous reviewer and audit history.
- New workflow tasks require the assigned reviewer. An administrator cannot
  satisfy multiple All slots by overriding them. Legacy administrator oversight
  remains available on legacy routes with its existing reason requirement.
- Approval-run locking before individual step locking; idempotent decision
  retries; cancellation of remaining Any/rejected tasks; immutable completed
  decisions; retained rejected snapshots and separate resubmission runs.

Group membership supplies routing candidates, not approval permissions. Routing
excludes inactive accounts, users without approval capability, users outside the
form department, the owner/submitter and contributors. Decisions recheck account
eligibility and independence. Removing someone from a group or deactivating a
group does not rewrite an existing run. Losing actual account permissions or
department access can block its pending slot. All needs every saved slot; Any
needs one eligible saved member. No eligible Any member, or any unavailable
required All member, blocks the stage until reassignment.

Authors use the active scoped default. Existing manual sequential approvals
remain available when no default is configured. Form-template approval remains
separate from inspection Review & sign.

## Migration review and rollout

`20261112090000_approval_workflow_designer.sql` is additive. It creates
`person_groups`, `person_group_members`, `approval_workflows`,
`approval_workflow_versions` and append-only `approval_reassignments`; adds
nullable version/route/content snapshot fields to approval runs; and adds group
rule/count/cancellation and saved reviewer name fields to steps. Existing runs
receive legacy-compatible single-reviewer defaults and retain null snapshots.
It adds tenant foreign keys, version/default uniqueness, RLS, explicit API-role
grants, transactional audit and history/decision guards. Browser roles have no
access to these tables. Readiness now requires the new guards and policies.

No prior migration was rewritten, no existing data was reseeded, no workspace
membership was moved, and no hosted database was changed. Before applying to a
shared environment, review the SQL, back up the database, and run the existing
administrative migration runner with the server-only migration URL. The app's
restricted runtime connection cannot apply migrations. Restart the updated app
after the approved migration; an old hosted schema will fail readiness.

## Repeat verification

From `inspectai/backend`:

```powershell
# Windows sandboxed test environments may need the existing PDF test flag:
$env:PDF_NO_SANDBOX = 'true'
npm test
npm run test:workflow:browser
```

From `inspectai/frontend`:

```powershell
npm test
npm run lint
npm run build
# Use locally installed Chrome if the bundled Playwright browser is absent:
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npx playwright test --reporter=line
```

The backend suite replays fresh migrations and separately upgrades a pre-feature
database containing pending and completed legacy approvals, then completes the
old pending review. It checks historical fields, RLS and browser-role denial.
Workflow API tests cover content/route reconfirmation, versions, defaults,
Any/All, membership/deactivation during review, blocked reassignment, rejection
and resubmission, independent approval, tenant/department isolation and retries.

The real-backend browser test runs the built React application through Express
and the migrated ephemeral database. It uses normal synthetic logins, creates a
Person Group through its page, actually drags all nodes and draws connectors,
tests layout/route persistence and movement/reconnection, activates the route,
submits as a non-administrator author, verifies staged inbox delivery and
publication, exercises All, changes/deactivates a group during review, replaces
a blocked manager, rejects/resubmits, and checks another tenant.

PGlite uses one leased connection, so it cannot prove PostgreSQL lock races.
The `workflow-browser` CI job additionally uses a fresh PostgreSQL 17 service
and independent runtime connections to run the same API and browser checks.
For a disposable local PostgreSQL instance, `test/workflow-postgres.cjs` accepts
only loopback hosts and a fresh database named `inspectai_workflow_test`, via
`WORKFLOW_TEST_DATABASE_URL`; it refuses existing application data. Set
`WORKFLOW_TEST_BROWSER=1` to include its browser scenario. No hosted URL is
accepted. Local credentials stay outside Git and test output.

Hosted Auth/database rollout, physical touch-device use and deployment are not
verified by these synthetic local/CI checks. The test screenshot is saved only
under ignored `backend/.env.workflow-browser/`; CI uploads PNGs, not credentials.
