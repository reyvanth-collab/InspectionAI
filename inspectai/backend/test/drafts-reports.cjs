const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  crypto = require('node:crypto')
module.exports = async ({
  call,
  request,
  assetId,
  formId,
  personas,
  demoSignature,
  db,
  fixturePassword,
}) => {
  let checks = 0
  // Every page uses the same whitelisted order, including tied descriptions.
  for (const [endpoint, sort] of [
    ['assets', 'location'],
    ['work-instructions', 'title'],
    ['inspections', 'asset'],
  ]) {
    const full = await call('admin', 'GET', `/${endpoint}?sort=${sort}&direction=desc&pageSize=100`)
    const collected = []
    for (let page = 1; page <= 100; page++) {
      const r = await call(
        'admin',
        'GET',
        `/${endpoint}?sort=${sort}&direction=desc&pageSize=7&page=${page}`,
      )
      assert.equal(r.meta.total, full.meta.total)
      collected.push(...r.data.map((x) => x.id))
      if (!r.meta.hasMore) break
    }
    assert.deepEqual(
      collected,
      full.data.map((x) => x.id),
    )
    assert.equal(new Set(collected).size, collected.length)
    checks += 3
    await call('admin', 'GET', `/${endpoint}?sort=title%3BDROP%20TABLE%20users&direction=DROP`)
  }
  const order = (
    await call('admin', 'POST', '/inspections', {
      assetId,
      workInstructionId: formId,
      assignedTo: personas['RS-inspector'].id,
    })
  ).data
  const record = (await call('RS-inspector', 'POST', `/inspections/${order.id}/start`, {})).data
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('app.actor_id','',false)")
  const foreignTenant = crypto.randomUUID()
  const assignedDepartment = (
    await db.query('SELECT primary_department_id FROM public.users WHERE id=$1', [
      personas['RS-inspector'].id,
    ])
  ).rows[0].primary_department_id
  await db.query('INSERT INTO public.tenants(id,name,slug) VALUES($1,$2,$3)', [
    foreignTenant,
    'Isolated regression fixture',
    'draft-foreign-' + foreignTenant,
  ])
  for (const [key, tenant, department] of [
    ['foreign-draft', foreignTenant, null],
    ['unassigned-draft', personas['RS-inspector'].tenantId, assignedDepartment],
  ]) {
    const id = crypto.randomUUID()
    await db.query('INSERT INTO auth.users(id,encrypted_password) VALUES($1,$2)', [
      id,
      fixturePassword,
    ])
    await db.query(
      "INSERT INTO public.users(id,tenant_id,name,email,staff_id,role,primary_department_id,capabilities) VALUES($1,$2,$3,$4,$3,'inspector',$5,ARRAY['inspector'])",
      [id, tenant, key, key + '@example.invalid', department],
    )
    personas[key] = {
      id,
      tenantId: tenant,
      role: 'inspector',
      name: key,
      email: key + '@example.invalid',
      staffId: key,
    }
  }
  await db.exec('SET ROLE inspectai_runtime')
  await request(
    'foreign-draft',
    'PUT',
    `/inspections/${order.id}/draft`,
    { version: 0, answers: {} },
    404,
  )
  await request(
    'unassigned-draft',
    'PUT',
    `/inspections/${order.id}/draft`,
    { version: 0, answers: {} },
    404,
  )
  const detail = (await call('RS-inspector', 'GET', `/inspections/${order.id}`)).data
  const items = detail.checklist_items.filter((q) => q.field_type !== 'heading'),
    answers = {}
  const text = items.find((q) => q.field_type === 'textarea')
  answers[text.id] = { result: null, value: 'Incomplete draft — 測試', notes: '', photos: [] }
  let saved = await call('RS-inspector', 'PUT', `/inspections/${order.id}/draft`, {
    version: 0,
    answers,
  })
  assert.equal(saved.data.version, 1)
  const reloaded = (await call('RS-inspector', 'GET', `/inspections/${order.id}/record`)).data
  assert.equal(reloaded.draft.answers[text.id].result, null)
  assert.equal(reloaded.draft.answers[text.id].value, answers[text.id].value)
  assert.equal(reloaded.inspection_findings.length, 0)
  checks += 4
  await call('RS-inspector', 'PUT', `/inspections/${order.id}/draft`, { version: 0, answers }) // retry after lost acknowledgement
  await request(
    'RS-inspector',
    'PUT',
    `/inspections/${order.id}/draft`,
    { version: 0, answers: {} },
    409,
  )
  await request(
    'SIG-inspector',
    'PUT',
    `/inspections/${order.id}/draft`,
    { version: 1, answers },
    404,
  )
  await request('RS-author', 'PUT', `/inspections/${order.id}/draft`, { version: 1, answers }, 403)
  await request(
    'RS-inspector',
    'POST',
    `/inspections/${order.id}/review`,
    { inspectionRecordId: record.id, draftVersion: 1 },
    409,
  )
  for (const q of items) {
    answers[q.id] = {
      result: q.required === false ? null : q.item_no === '3' ? 'fail' : 'pass',
      value:
        q.field_type === 'measurement'
          ? '42'
          : q.field_type === 'yes_no'
            ? 'Yes'
            : q.field_type === 'date'
              ? '2026-10-27'
              : q.field_type === 'dropdown'
                ? 'Synthetic normal condition'
                : ['text', 'textarea'].includes(q.field_type)
                  ? 'Synthetic observation — 測試'
                  : '',
      notes: q.item_no === '3' ? 'Visible synthetic defect' : '',
      photos: [],
    }
  }
  saved = await call('RS-inspector', 'PUT', `/inspections/${order.id}/draft`, {
    version: 1,
    answers,
  })
  await request(
    'RS-inspector',
    'POST',
    `/inspections/${order.id}/review`,
    { inspectionRecordId: record.id, draftVersion: 2 },
    409,
  )
  const photo = items.find((q) => q.item_no === '3')
  answers[photo.id].photos = [demoSignature, demoSignature]
  const na = items.find((q) => q.item_no === '5')
  answers[na.id] = {
    result: 'na',
    value: '',
    notes: 'Retained observation note',
    naReason: 'Fictional component not present',
    photos: [],
  }
  await call('RS-inspector', 'PUT', `/inspections/${order.id}/draft`, { version: 2, answers })
  let review = (
    await call('RS-inspector', 'POST', `/inspections/${order.id}/review`, {
      inspectionRecordId: record.id,
      draftVersion: 3,
    })
  ).data
  assert.equal(review.items.find((i) => i.id === photo.id).photo_urls.length, 1)
  checks++
  await request(
    'RS-inspector',
    'POST',
    `/inspections/${order.id}/complete`,
    {
      inspectionRecordId: record.id,
      signatureDataUrl: demoSignature,
      draftVersion: 3,
      reviewToken: crypto.randomBytes(32).toString('hex'),
    },
    409,
  )
  answers[text.id].value += ' edited after review'
  await call('RS-inspector', 'PUT', `/inspections/${order.id}/draft`, { version: 3, answers })
  await request(
    'RS-inspector',
    'POST',
    `/inspections/${order.id}/complete`,
    {
      inspectionRecordId: record.id,
      signatureDataUrl: demoSignature,
      draftVersion: 3,
      reviewToken: review.reviewToken,
    },
    409,
  )
  await request(
    'RS-inspector',
    'POST',
    `/inspections/${order.id}/findings`,
    { inspectionRecordId: record.id, checklistItemId: text.id, result: 'pass' },
    409,
  )
  review = (
    await call('RS-inspector', 'POST', `/inspections/${order.id}/review`, {
      inspectionRecordId: record.id,
      draftVersion: 4,
    })
  ).data
  await call('RS-inspector', 'POST', `/inspections/${order.id}/complete`, {
    inspectionRecordId: record.id,
    signatureDataUrl: demoSignature,
    draftVersion: 4,
    reviewToken: review.reviewToken,
  })
  await request(
    'RS-inspector',
    'PUT',
    `/inspections/${order.id}/draft`,
    { version: 4, answers },
    409,
  )
  await request('SIG-inspector', 'GET', `/inspections/${order.id}/report.pdf`, undefined, 404)
  await request('foreign-draft', 'GET', `/inspections/${order.id}/report.pdf`, undefined, 404)
  const signed = (await call('RS-inspector', 'GET', `/inspections/${order.id}/record`)).data
  assert.equal(
    signed.signed_payload.items.find((i) => i.id === text.id).captured_value,
    answers[text.id].value,
  )
  assert.equal(signed.signed_payload.items.find((i) => i.required === false).result, null)
  checks += 2
  assert.equal(
    signed.signed_payload.items.find((i) => i.id === na.id).na_reason,
    'Fictional component not present',
  )
  assert.equal(
    signed.signed_payload.items.find((i) => i.id === na.id).notes,
    'Retained observation note',
  )
  checks += 2
  const { inspectionReportHtml, renderInspectionPdf } = require('../dist/lib/inspectionReport')
  const html = inspectionReportHtml(signed)
  assert(html.includes('edited after review'))
  assert(html.includes('Question 3'))
  assert(!html.includes('<script>'))
  assert(html.includes('UTC'))
  checks += 4
  const long = structuredClone(signed)
  long.signed_payload.items = Array.from({ length: 30 }, (_, n) => ({
    ...signed.signed_payload.items[n % items.length],
    item_no: String(n + 1),
    captured_value: 'Long observation 測試 & <script>do not execute</script>\n'.repeat(40),
    photo_urls: n === 0 ? [demoSignature] : [],
  }))
  long.signed_payload.items.push({
    item_no: '31',
    description: 'Synthetic response table',
    field_type: 'table',
    result: 'pass',
    layout_json: JSON.stringify({
      tableColumns: ['Component', 'Observation', '位置'],
      tableRows: 3,
    }),
    captured_value: JSON.stringify({
      '0:0': 'Synthetic cover',
      '0:1': 'Sealed',
      '0:2': 'Northbank',
    }),
  })
  long.signature_hash = crypto
    .createHash('sha256')
    .update(require('../dist/lib/signature').canonicalJson(long.signed_payload))
    .digest('hex')
  const escaped = inspectionReportHtml(long)
  assert(!escaped.includes('<script>'))
  assert(escaped.includes('&lt;script&gt;'))
  checks += 2
  fs.mkdirSync('.env.pdf-checks', { recursive: true })
  for (const [name, r] of [
    ['completed', signed],
    ['long-multipage', long],
  ]) {
    const bytes = await renderInspectionPdf(r)
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    fs.writeFileSync(`.env.pdf-checks/${name}.pdf`, bytes)
    checks++
  }
  console.log(
    `PASS ${checks} additional draft conflict, idempotency, review integrity, sorting, PDF content and rendering assertions`,
  )
}
