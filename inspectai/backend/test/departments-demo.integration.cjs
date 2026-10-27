const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  crypto = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite'),
  { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto'),
  { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp')
require('express-async-errors')
process.env.JWT_SECRET = 'department-fixture-server-only-secret-long-enough'
const express = require('express'),
  dbModule = require('../dist/lib/db'),
  jwt = require('../dist/lib/jwt'),
  { actorContext } = require('../dist/lib/actor')
;(async () => {
  const { DEMO_TENANT, DEMO_SLUG, DEMO_NAME, departments, seedWorkflow, demoSignature } =
    await import('../scripts/rail-demo-data.mjs')
  const { migrationPlan } = await import('../scripts/migration-plan.mjs'),
    db = new PGlite({ extensions: { pgcrypto, uuid_ossp } })
  await db.exec(
    'CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,encrypted_password text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;',
  )
  await db.exec(fs.readFileSync('../supabase/schema.sql', 'utf8'))
  await db.exec(
    'CREATE TABLE public.inspectai_migrations(name text PRIMARY KEY); ALTER TABLE public.inspectai_migrations ENABLE ROW LEVEL SECURITY;',
  )
  for (const name of migrationPlan(fs.readdirSync('../supabase/migrations')))
    await db.exec(fs.readFileSync('../supabase/migrations/' + name, 'utf8'))
  const query = (sql, p) => db.query(sql, p)
  dbModule.query = async (sql, p) => {
    await db.query("SELECT set_config('app.actor_id',$1,false)", [actorContext.getStore() || ''])
    return query(sql, p)
  }
  dbModule.pool.connect = async () => ({ query, release() {} })
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  for (const [path, file] of [
    ['auth', 'auth'],
    ['assets', 'assets'],
    ['work-instructions', 'workInstructions'],
    ['inspections', 'inspections'],
    ['approvals', 'approvals'],
    ['history', 'history'],
    ['departments', 'departments'],
    ['users', 'users'],
    ['reports', 'reports'],
    ['analytics', 'analytics'],
  ])
    app.use('/' + path, require('../dist/routes/' + file).default)
  app.use(require('../dist/middleware/errorHandler').errorHandler)
  app.use((_req, res) => res.status(404).json({ error: 'API endpoint not found' }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  const base = 'http://127.0.0.1:' + server.address().port
  const personas = {},
    departmentIds = {}
  let checks = 0
  async function request(persona, method, path, body, expected = 200) {
    const u = personas[persona]
    const r = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          'Bearer ' +
          jwt.signToken({
            ...u,
            authVersion: crypto.createHash('sha256').update('fixture-password').digest('hex'),
          }),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await r.json()
    assert.equal(r.status, expected, `${persona} ${method} ${path}: ${JSON.stringify(data)}`)
    checks++
    return data
  }
  try {
    await db.query('INSERT INTO public.tenants(id,name,slug) VALUES($1,$2,$3)', [
      DEMO_TENANT,
      DEMO_NAME,
      DEMO_SLUG,
    ])
    for (const d of departments)
      departmentIds[d.code] = (
        await db.query(
          'INSERT INTO public.departments(tenant_id,code,name) VALUES($1,$2,$3) RETURNING id',
          [DEMO_TENANT, d.code, d.name],
        )
      ).rows[0].id
    for (const dept of departments)
      for (const [kind, role, caps] of [
        ['author', 'viewer', ['form_author', 'viewer']],
        ['reviewer', 'approver', ['form_approver', 'viewer']],
        ['inspector', 'inspector', ['inspector']],
      ]) {
        const key = dept.code + '-' + kind,
          id = crypto.randomUUID()
        personas[key] = {
          id,
          tenantId: DEMO_TENANT,
          role,
          name: key,
          email: key + '@example.invalid',
          staffId: key,
        }
        await db.query('INSERT INTO auth.users VALUES($1,$2)', [id, 'fixture-password'])
        await db.query(
          'INSERT INTO public.users(id,tenant_id,staff_id,name,email,role,primary_department_id,capabilities) VALUES($1,$2,$3,$3,$4,$5,$6,$7)',
          [id, DEMO_TENANT, key, key + '@example.invalid', role, departmentIds[dept.code], caps],
        )
      }
    const adminId = crypto.randomUUID()
    personas.admin = {
      id: adminId,
      tenantId: DEMO_TENANT,
      role: 'admin',
      name: 'Admin',
      email: 'admin@example.invalid',
      staffId: 'ADMIN',
    }
    await db.query('INSERT INTO auth.users VALUES($1,$2)', [adminId, 'fixture-password'])
    await db.query(
      "INSERT INTO public.users(id,tenant_id,staff_id,name,email,role) VALUES($1,$2,'ADMIN','Admin','admin@example.invalid','admin')",
      [adminId, DEMO_TENANT],
    )
    await db.exec('SET ROLE inspectai_runtime')
    const call = async (persona, method, path, body) =>
      request(
        persona,
        method,
        path,
        body,
        method === 'POST' &&
          (['/assets', '/work-instructions', '/inspections'].includes(path) ||
            path.endsWith('/revise'))
          ? 201
          : 200,
      )
    const counts = await seedWorkflow({ request: call, departmentIds, personas })
    assert.deepEqual(counts, { assets: 60, distinctForms: 20, workOrders: 20 })
    checks++
    const { verifyRailDemo } = await import('../scripts/verify-rail-demo-data.mjs')
    const visibleDemo = await verifyRailDemo(path => call('admin', 'GET', path))
    assert.equal(visibleDemo.assets, 60)
    assert.equal(visibleDemo.publishedForms, 20)
    assert.equal(visibleDemo.minimumQuestions, 10)
    assert.equal(visibleDemo.workOrders, 20)
    await assert.rejects(verifyRailDemo(path => call('RS-inspector', 'GET', path)), /department-limited/)
    await assert.rejects(verifyRailDemo(async () => ({ data: { tenantId: crypto.randomUUID(), capabilities: ['administrator'] } })), /different workspace/)
    await assert.rejects(verifyRailDemo(async path => {
      const result = await call('admin', 'GET', path)
      if (path.startsWith('/work-instructions')) result.data[0].checkable_item_count = 1
      return result
    }), /10 answerable questions/)
    await assert.rejects(verifyRailDemo(async path => {
      const result = await call('admin', 'GET', path)
      if (path.startsWith('/assets')) result.data.pop()
      return result
    }), /60 sample assets/)
    checks += 8
    const size = async () =>
      (
        await db.query(
          'SELECT (SELECT count(*) FROM public.assets)::int assets,(SELECT count(*) FROM public.work_instructions)::int forms,(SELECT count(*) FROM public.work_orders)::int orders,(SELECT count(*) FROM public.inspection_records WHERE completed_at IS NOT NULL)::int signed',
        )
      ).rows[0]
    await db.exec('RESET ROLE')
    const first = await size()
    await db.exec('SET ROLE inspectai_runtime')
    assert.deepEqual(await seedWorkflow({ request: call, departmentIds, personas }), counts)
    await db.exec('RESET ROLE')
    assert.deepEqual(await size(), first)
    checks += 2
    const rs = (
      await db.query(
        'SELECT id FROM public.work_orders WHERE department_id=$1 ORDER BY wo_number',
        [departmentIds.RS],
      )
    ).rows[0]
    const sig = (
      await db.query('SELECT id FROM public.work_orders WHERE department_id=$1 LIMIT 1', [
        departmentIds.SIG,
      ])
    ).rows[0]
    const activeForm = (
      await db.query(
        "SELECT id FROM public.work_instructions WHERE department_id=$1 AND status='active' ORDER BY wi_number LIMIT 1",
        [departmentIds.RS],
      )
    ).rows[0]
    await db.exec('SET ROLE inspectai_runtime')
    await request('SIG-inspector', 'GET', '/inspections/' + rs.id, undefined, 404)
    await request('RS-inspector', 'GET', '/inspections/' + sig.id, undefined, 404)
    const deniedAssets = await request('RS-inspector', 'GET', '/assets?search=DEMO-SIG')
    assert.equal(deniedAssets.data.length, 0)
    checks++
    await request(
      'RS-author',
      'PATCH',
      '/approvals/steps/' + crypto.randomUUID() + '/approve',
      {},
      403,
    )
    await request('RS-reviewer', 'POST', '/work-instructions', { title: 'Not permitted' }, 403)
    await request('RS-author', 'POST', '/departments', { code: 'NO', name: 'No' }, 403)
    await request('RS-inspector', 'GET', '/analytics/audit-logs', undefined, 403)
    const deniedHistory = await request('SIG-inspector', 'GET', '/history?workOrderId=' + rs.id)
    assert.equal(deniedHistory.data.length, 0)
    checks++
    await assert.rejects(
      seedWorkflow({ request: call, departmentIds, personas, tenantId: crypto.randomUUID() }),
      /Refusing/,
    )
    checks++
    const cloned = (
      await call('RS-author', 'POST', `/work-instructions/${activeForm.id}/revise`, {
        changeSummary: 'Traceable revision test',
      })
    ).data
    const before = (await call('RS-author', 'GET', '/work-instructions/' + cloned.id)).data
    const input = {
      wiNumber: before.wi_number,
      title: before.title,
      revision: before.revision,
      checklistItems: before.wi_checklist_items.map((i) => ({
        id: i.id,
        itemNo: i.item_no,
        description: i.description,
        acceptanceCriteria: i.acceptance_criteria,
        fieldType: i.field_type,
        required: i.required,
        sortOrder: i.sort_order,
        layoutJson: i.layout_json,
        conditionalJson: i.conditional_json,
        optionsJson: i.options_json,
        minValue: i.min_value,
        maxValue: i.max_value,
      })),
    }
    input.checklistItems[0].acceptanceCriteria = 'Updated synthetic acceptance criteria'
    await call('RS-author', 'PUT', '/work-instructions/' + cloned.id, input)
    const after = (await call('RS-author', 'GET', '/work-instructions/' + cloned.id)).data
    assert.equal(after.wi_checklist_items[0].id, before.wi_checklist_items[0].id)
    assert.equal(after.wi_checklist_items[0].lineage_id, before.wi_checklist_items[0].lineage_id)
    assert.equal(after.wi_checklist_items[0].layout_json, before.wi_checklist_items[0].layout_json)
    checks += 3
    await call('RS-author', 'POST', `/work-instructions/${cloned.id}/submit-approval`, {
      approverIds: [personas['RS-reviewer'].id],
    })
    let approvals = (await call('RS-reviewer', 'GET', '/approvals')).data,
      step = approvals.find((a) => a.wi_id === cloned.id && a.final_status === 'active')
        .approval_steps[0]
    await call('RS-reviewer', 'PATCH', '/approvals/steps/' + step.id + '/reject', {
      comment: 'Clarify the synthetic criteria',
    })
    input.title += ' revised'
    await call('RS-author', 'PUT', '/work-instructions/' + cloned.id, input)
    await call('RS-author', 'POST', `/work-instructions/${cloned.id}/submit-approval`, {
      approverIds: [personas['RS-reviewer'].id],
    })
    approvals = (await call('RS-reviewer', 'GET', '/approvals')).data
    step = approvals.find((a) => a.wi_id === cloned.id && a.final_status === 'active')
      .approval_steps[0]
    await request('RS-author', 'PATCH', '/approvals/steps/' + step.id + '/approve', {}, 403)
    await call('RS-reviewer', 'PATCH', '/approvals/steps/' + step.id + '/approve', {
      comment: 'Synthetic criteria clarified',
    })
    const history = await call('RS-author', 'GET', '/history?formId=' + cloned.id)
    const events = [...history.data]
    for (let page = 2; page <= Math.ceil(history.meta.total / 30); page++)
      events.push(
        ...(await call('RS-author', 'GET', '/history?formId=' + cloned.id + '&page=' + page)).data,
      )
    assert(
      events.some(
        (e) =>
          e.detail?.before?.acceptance_criteria &&
          e.detail?.after?.acceptance_criteria === 'Updated synthetic acceptance criteria',
      ),
    )
    assert(history.meta.total > 0)
    checks += 2
    // Pagination/counts are over the entire filtered result set, not a loaded page.
    const page = await call('admin', 'GET', '/inspections?pageSize=1&search=DEMO-RS')
    assert.equal(page.data.length, 1)
    assert.equal(page.meta.total, 3)
    assert(page.meta.hasMore)
    checks += 3
    const emptyPage = await call('admin', 'GET', '/inspections?page=999&pageSize=1&search=DEMO-RS')
    assert.equal(emptyPage.data.length, 0)
    assert.equal(emptyPage.meta.total, 3)
    checks += 2
    const snapshot = await call('admin', 'GET', '/inspections/' + rs.id),
      assetId = snapshot.data.asset_record_id
    await call('admin', 'PATCH', '/assets/' + assetId, {
      name: 'Changed live asset label',
      location: 'Changed live location',
    })
    const historical = await call('admin', 'GET', '/inspections/' + rs.id)
    assert.equal(historical.data.asset_name, snapshot.data.asset_name)
    assert.equal(historical.data.location, snapshot.data.location)
    checks += 2
    await db.exec('RESET ROLE')
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM public.audit_logs WHERE detail::text LIKE '%data:image/%'",
        )
      ).rows[0].n,
      0,
    )
    checks++
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM public.inspection_records WHERE completed_at IS NOT NULL AND overall_result='fail'",
        )
      ).rows[0].n > 0,
      true,
    )
    checks++
    await db.exec('SET ROLE inspectai_runtime')
    await assert.rejects(
      db.query("UPDATE public.audit_logs SET action='tampered'"),
      /permission denied/,
    )
    checks++
    // Explicit cross-department review grants, and author/approver separation.
    const crossDraft = (
      await call('RS-author', 'POST', `/work-instructions/${cloned.id}/revise`, {
        changeSummary: 'Cross-department review test',
      })
    ).data
    await request(
      'RS-author',
      'POST',
      `/work-instructions/${crossDraft.id}/submit-approval`,
      { approverIds: [personas['SIG-reviewer'].id] },
      400,
    )
    await call('admin', 'PUT', '/departments/users/' + personas['SIG-reviewer'].id, {
      primaryDepartmentId: departmentIds.SIG,
      departmentIds: [departmentIds.SIG, departmentIds.RS],
      capabilities: ['form_approver', 'viewer'],
      reason: 'Explicit cross-department synthetic review grant',
    })
    await call('RS-author', 'POST', `/work-instructions/${crossDraft.id}/submit-approval`, {
      approverIds: [personas['SIG-reviewer'].id],
    })
    await call('SIG-reviewer', 'GET', '/work-instructions/' + crossDraft.id)
    approvals = (await call('SIG-reviewer', 'GET', '/approvals')).data
    step = approvals.find((a) => a.wi_id === crossDraft.id && a.final_status === 'active')
      .approval_steps[0]
    await call('SIG-reviewer', 'PATCH', '/approvals/steps/' + step.id + '/approve', {
      comment: 'Explicitly authorised cross-department review',
    })
    await request('RS-inspector', 'GET', '/history', undefined, 403)
    await call('admin', 'PUT', '/departments/users/' + personas['RS-author'].id, {
      primaryDepartmentId: departmentIds.RS,
      departmentIds: [departmentIds.RS],
      capabilities: ['form_author', 'form_approver', 'viewer'],
      reason: 'Synthetic author with both capabilities',
    })
    const ownDraft = (
      await call('RS-author', 'POST', `/work-instructions/${crossDraft.id}/revise`, {})
    ).data
    await request(
      'RS-author',
      'POST',
      `/work-instructions/${ownDraft.id}/submit-approval`,
      { approverIds: [personas['RS-author'].id] },
      400,
    )
    await call('RS-author', 'POST', `/work-instructions/${ownDraft.id}/submit-approval`, {
      approverIds: [personas['RS-reviewer'].id],
    })
    approvals = (await call('RS-reviewer', 'GET', '/approvals')).data
    step = approvals.find((a) => a.wi_id === ownDraft.id && a.final_status === 'active')
      .approval_steps[0]
    await request('RS-author', 'PATCH', '/approvals/steps/' + step.id + '/approve', {}, 403)
    // A required photo is enforced by the completion endpoint, including direct API callers.
    const photoOrder = (
      await call('admin', 'POST', '/inspections', {
        assetId,
        workInstructionId: crossDraft.id,
        assignedTo: personas['RS-inspector'].id,
        assetName: 'Forged client label',
        location: 'Forged client location',
      })
    ).data
    assert.notEqual(photoOrder.asset_name, 'Forged client label')
    assert.notEqual(photoOrder.location, 'Forged client location')
    checks += 2
    const photoRecord = (
      await call('RS-inspector', 'POST', `/inspections/${photoOrder.id}/start`, {})
    ).data
    const photoDetail = (await call('RS-inspector', 'GET', `/inspections/${photoOrder.id}`)).data
    for (const q of photoDetail.checklist_items) {
      const capturedValue =
        q.field_type === 'measurement'
          ? '42'
          : q.field_type === 'yes_no'
            ? 'Yes'
            : q.field_type === 'date'
              ? '2026-10-25'
              : q.field_type === 'dropdown'
                ? 'Synthetic normal condition'
                : ['text', 'textarea'].includes(q.field_type)
                  ? 'Synthetic observation'
                  : ''
      await call('RS-inspector', 'POST', `/inspections/${photoOrder.id}/findings`, {
        inspectionRecordId: photoRecord.id,
        checklistItemId: q.id,
        result: q.item_no === '3' ? 'fail' : 'pass',
        capturedValue,
        notes: q.item_no === '3' ? 'Synthetic defect description' : '',
      })
    }
    await request(
      'RS-inspector',
      'POST',
      `/inspections/${photoOrder.id}/complete`,
      { inspectionRecordId: photoRecord.id, signatureDataUrl: demoSignature },
      409,
    )
    const evidenceItem = photoDetail.checklist_items.find((i) => i.item_no === '3')
    await call('RS-inspector', 'POST', `/inspections/${photoOrder.id}/findings/photo`, {
      inspectionRecordId: photoRecord.id,
      checklistItemId: evidenceItem.id,
      imageDataUrl: demoSignature,
    })
    await call('RS-inspector', 'POST', `/inspections/${photoOrder.id}/complete`, {
      inspectionRecordId: photoRecord.id,
      signatureDataUrl: demoSignature,
      signedBy: personas.admin.id,
    })
    const savedPhoto = (await call('RS-inspector', 'GET', `/inspections/${photoOrder.id}/record`))
      .data
    assert.equal(savedPhoto.signed_by, personas['RS-inspector'].id)
    assert.equal(
      savedPhoto.inspection_findings.find((f) => f.checklist_item_id === evidenceItem.id).photo_urls
        .length,
      1,
    )
    checks += 2
    // Approved forms remain usable during their warning window, not after expiry
    // or before their effective date. Decisions retain the actual actor identity.
    const warning = (
      await call('RS-author', 'POST', '/work-instructions', {
        wiNumber: 'DEMO-WARNING',
        title: 'Synthetic expiry warning check',
        revision: '1',
        expiryDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        checklistItems: [{ itemNo: '1', description: 'Synthetic visual check', sortOrder: 1 }],
      })
    ).data
    await call('RS-author', 'POST', `/work-instructions/${warning.id}/submit-approval`, {
      approverIds: [personas['RS-reviewer'].id],
    })
    approvals = (await call('RS-reviewer', 'GET', '/approvals')).data
    step = approvals.find((a) => a.wi_id === warning.id && a.final_status === 'active')
      .approval_steps[0]
    await request('admin', 'PATCH', '/approvals/steps/' + step.id + '/approve', {}, 409)
    await call('admin', 'PATCH', '/approvals/steps/' + step.id + '/approve', {
      comment: 'Administrator oversight for synthetic warning-window fixture',
    })
    const decision = (await call('RS-reviewer', 'GET', '/approvals')).data.find(
      (a) => a.wi_id === warning.id,
    ).approval_steps[0]
    assert.equal(decision.decided_by, personas.admin.id)
    checks++
    await db.exec('RESET ROLE')
    await db.query("SELECT set_config('app.actor_id','',false)")
    await db.query("UPDATE public.work_instructions SET status='expiring' WHERE id=$1", [
      warning.id,
    ])
    await db.exec('SET ROLE inspectai_runtime')
    const warningOrder = (
      await call('admin', 'POST', '/inspections', {
        assetId,
        workInstructionId: warning.id,
        assignedTo: personas['RS-inspector'].id,
      })
    ).data
    await request(
      'admin',
      'PATCH',
      `/inspections/${warningOrder.id}/assignment`,
      { assignedTo: personas['SIG-inspector'].id },
      409,
    )
    await call('admin', 'PATCH', `/inspections/${warningOrder.id}/assignment`, {
      assignedTo: personas['RS-inspector'].id,
    })
    const foreignCandidates = await call(
      'RS-author',
      'GET',
      '/users/approvers?departmentId=' + departmentIds.TP,
    )
    assert.equal(foreignCandidates.data.length, 0)
    checks++
    await request('RS-inspector', 'GET', '/users/assignable', undefined, 403)
    await request('admin', 'GET', '/moms', undefined, 404)
    // All report pages must match the full scoped report, including tied rows.
    for (const endpoint of ['wi-compliance', 'inspection-summary', 'defect-analysis']) {
      const complete = await call('admin', 'GET', '/reports/' + endpoint)
      assert(complete.data.length > 1, endpoint + ' requires multiple fixture rows')
      const collected = []
      for (let n = 1; n <= complete.data.length + 1; n++) {
        const part = await call('admin', 'GET', '/reports/' + endpoint + '?pageSize=1&page=' + n)
        assert.equal(part.meta.pageSize, 1)
        collected.push(...part.data)
        if (!part.meta.hasMore) break
      }
      assert.deepEqual(collected, complete.data, endpoint + ' pages must equal full report')
      checks += 2
    }
    const { READINESS_SQL, databaseReady } = require('../dist/lib/readiness')
    assert(databaseReady((await db.query(READINESS_SQL)).rows[0]))
    await db.exec('RESET ROLE')
    assert.equal(databaseReady((await db.query(READINESS_SQL)).rows[0]), false, 'privileged connections cannot be ready')
    for (const damage of [
      'ALTER TABLE public.inspection_findings DISABLE TRIGGER guard_finding',
      'ALTER TABLE public.departments DISABLE ROW LEVEL SECURITY',
      'DROP POLICY asset_scope ON public.assets',
    ]) {
      await db.exec('BEGIN; ' + damage + '; SET LOCAL ROLE inspectai_runtime;')
      assert.equal(databaseReady((await db.query(READINESS_SQL)).rows[0]), false, damage)
      await db.exec('ROLLBACK')
    }
    checks += 5
    console.log(
      `PASS ${checks} department, lifecycle, audit, seed and permission assertions against PostgreSQL (PGlite); seed repeated without creating extra assets/forms/orders/signatures`,
    )
  } finally {
    server.close()
    await db.close()
    await dbModule.pool.end()
  }
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
