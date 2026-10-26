import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import pg from 'pg'
import jwt from 'jsonwebtoken'
import { createRequire } from 'node:module'
dotenv.config()
if (
  process.env.NODE_ENV === 'production' ||
  process.env.SUPABASE_URL !== 'https://ehrgsakhrpbtintshjha.supabase.co'
)
  throw new Error('Authorized inspectai staging only')
const require = createRequire(import.meta.url)
const { canonicalJson } = require('../dist/lib/signature.js')
const fixture = JSON.parse(
  await fs.readFile(new URL('../.env.staging-test-users.json', import.meta.url), 'utf8'),
)
const base = process.env.VERIFY_API_URL ?? 'http://127.0.0.1:4000/api'
const tokens = {}
let checks = 0
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
async function request(expected, method, path, body, role = 'admin') {
  const response = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(tokens[role] ? { Authorization: 'Bearer ' + tokens[role] } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json()
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`)
  checks++
  return payload
}
try {
  await db.connect()
  await db.query("SELECT set_config('app.actor_id',$1,false)", [fixture.users.admin.id])
  await request(200, 'GET', '/health')
  await request(200, 'GET', '/ready')
  await request(401, 'GET', '/auth/me')
  await request(401, 'POST', '/auth/login', {
    email: fixture.users.admin.email,
    password: 'intentionally-wrong-password',
  })
  for (const [role, user] of Object.entries(fixture.users)) {
    const login = await request(200, 'POST', '/auth/login', {
      email: user.email,
      password: user.password,
    })
    assert.equal(login.user.id, user.id)
    assert.equal(login.user.role, user.role)
    assert.equal(login.user.tenantId, role === 'foreign' ? fixture.otherTenantId : fixture.tenantId)
    tokens[role] = login.token
    const me = await request(200, 'GET', '/auth/me', undefined, role)
    assert.equal(me.data.role, user.role)
    checks += 4
  }
  await request(200, 'GET', '/inspections/summary')
  const asset = (
    await request(201, 'POST', '/assets', {
      assetNumber: 'VERIFY-' + crypto.randomBytes(5).toString('hex'),
      name: 'Synthetic staging verification asset',
      status: 'active',
      criticality: 'medium',
    })
  ).data
  await request(
    403,
    'POST',
    '/assets',
    { assetNumber: 'DENIED', name: 'Must not be created' },
    'viewer',
  )
  await request(404, 'GET', '/assets/' + asset.id, undefined, 'foreign')
  const forged = jwt.sign({ ...jwt.decode(tokens.viewer), role: 'admin' }, process.env.JWT_SECRET)
  const saved = tokens.viewer
  tokens.viewer = forged
  await request(
    403,
    'POST',
    '/assets',
    { assetNumber: 'DENIED-CLAIM', name: 'Must not be created' },
    'viewer',
  )
  tokens.viewer = saved
  const wi = (
    await request(201, 'POST', '/work-instructions', {
      wiNumber: 'VERIFY-' + crypto.randomBytes(5).toString('hex'),
      title: 'SYNTHETIC DEMO — fictional indicator check',
      description: 'Training fixture only; not an approved engineering procedure.',
      revision: '1',
      checklistItems: [
        {
          itemNo: '1',
          description: 'Fictional training indicator',
          acceptanceCriteria:
            'FICTIONAL: 2–5 demo units is a software validation example, with no operational or safety meaning.',
          fieldType: 'measurement',
          unit: 'demo units',
          minValue: 2,
          maxValue: 5,
          required: true,
          sortOrder: 1,
        },
      ],
    })
  ).data
  await request(400, 'POST', '/work-instructions/' + wi.id + '/submit-approval', {
    approverIds: [fixture.users.admin.id],
  })
  await request(200, 'POST', '/work-instructions/' + wi.id + '/submit-approval', {
    approverIds: [fixture.users.approver.id],
  })
  const approvals = (await request(200, 'GET', '/approvals', undefined, 'approver')).data
  const approval = approvals.find((row) => row.wi_id === wi.id)
  const step = approval.approval_steps.find((row) => row.status === 'active')
  await request(200, 'PATCH', '/approvals/steps/' + step.id + '/approve', {}, 'approver')
  const wo = (
    await request(201, 'POST', '/inspections', {
      assetId: asset.id,
      assignedTo: fixture.users.inspector.id,
      workInstructionId: wi.id,
    })
  ).data
  await request(404, 'GET', '/inspections/' + wo.id, undefined, 'foreign')
  await request(403, 'POST', '/inspections/' + wo.id + '/start', {}, 'viewer')
  await request(403, 'POST', '/inspections/' + wo.id + '/start', {}, 'approver')
  const record = (await request(200, 'POST', '/inspections/' + wo.id + '/start', {}, 'inspector'))
    .data
  const instruction = (
    await request(200, 'GET', '/work-instructions/' + wi.id, undefined, 'inspector')
  ).data
  const item = instruction.wi_checklist_items[0]
  await request(
    409,
    'POST',
    '/inspections/' + wo.id + '/findings',
    { inspectionRecordId: record.id, checklistItemId: item.id, result: 'pass', capturedValue: '9' },
    'inspector',
  )
  await request(
    200,
    'POST',
    '/inspections/' + wo.id + '/findings',
    { inspectionRecordId: record.id, checklistItemId: item.id, result: 'pass', capturedValue: '3' },
    'inspector',
  )
  const signature =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYZkAAAAASUVORK5CYII='
  await request(
    400,
    'POST',
    '/inspections/' + wo.id + '/complete',
    { inspectionRecordId: record.id, signatureDataUrl: 'invalid' },
    'inspector',
  )
  await request(
    200,
    'POST',
    '/inspections/' + wo.id + '/complete',
    { inspectionRecordId: record.id, signatureDataUrl: signature },
    'inspector',
  )
  const signed = (
    await request(200, 'GET', '/inspections/' + wo.id + '/record', undefined, 'inspector')
  ).data
  assert.equal(signed.signed_payload.items[0].captured_value, '3')
  assert.equal(
    signed.signature_hash,
    crypto.createHash('sha256').update(canonicalJson(signed.signed_payload)).digest('hex'),
  )
  checks += 2
  await request(
    409,
    'POST',
    '/inspections/' + wo.id + '/findings',
    { inspectionRecordId: record.id, checklistItemId: item.id, result: 'fail' },
    'inspector',
  )
  await assert.rejects(
    db.query('UPDATE public.inspection_findings SET notes=$1 WHERE inspection_record_id=$2', [
      'tamper',
      record.id,
    ]),
    /already signed/,
  )
  await assert.rejects(
    db.query('UPDATE public.inspection_records SET notes=$1 WHERE id=$2', ['tamper', record.id]),
    /immutable/,
  )
  await assert.rejects(
    db.query('UPDATE public.audit_logs SET action=$1', ['tamper']),
    /permission denied/,
  )
  checks += 3
  await request(200, 'GET', '/reports/inspection-summary?days=30&page=1', undefined, 'inspector')
  fixture.lastVerification = {
    workOrderId: wo.id,
    recordId: record.id,
    workInstructionId: wi.id,
    checks,
    at: new Date().toISOString(),
  }
  await fs.writeFile(
    new URL('../.env.staging-test-users.json', import.meta.url),
    JSON.stringify(fixture, null, 2),
    { mode: 0o600 },
  )
  console.log(
    `PASS ${checks} live assertions: hosted Supabase Auth, current DB roles, tenant isolation, independent approval, measurement limits, signed completion/hash, reload/report and tamper rejection`,
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await db.end().catch(() => {})
}
