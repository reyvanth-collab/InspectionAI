const assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  fs = require('node:fs')
module.exports = async ({
  call,
  request,
  assetId,
  personas,
  demoSignature,
  db,
  base,
  jwt,
  fixturePassword,
  departmentIds,
}) => {
  const {
    answerProblem,
    derivedResult,
    configurationProblem,
    defaultAssessment,
  } = require('../dist/lib/questionPolicy')
  const { buildReport, safeCsv } = require('../dist/lib/reportEngine')
  let checks = 0
  const q = (type, required = true, mode = 'manual', extra = {}) => ({
    field_type: type,
    required: true,
    conditional_json: JSON.stringify({ assessment: { required, mode, ...extra }, allowNA: false }),
  })
  assert.equal(answerProblem(q('text', false), { value: 'Serial 123' }), null)
  assert.match(answerProblem(q('text'), { value: 'Door seal condition' }), /assessment/)
  assert.match(answerProblem(q('text'), { result: 'pass', value: '' }), /response/)
  assert.equal(answerProblem(q('text'), { result: 'pass', value: 'Seal condition recorded' }), null)
  for (const type of ['date', 'signature', 'yes_no', 'table', 'textarea', 'photo'])
    assert.equal(defaultAssessment(type).required, false)
  for (const type of ['date', 'signature']) assert.equal(configurationProblem(q(type, true)), null)
  assert.equal(
    derivedResult(q('yes_no', true, 'expected', { expectedAnswer: 'No' }), { value: 'No' }),
    'pass',
  )
  assert.equal(
    derivedResult(q('yes_no', true, 'expected', { expectedAnswer: 'Yes' }), { value: 'No' }),
    'fail',
  )
  assert.equal(
    derivedResult(
      { ...q('measurement', true, 'limits'), min_value: 0, max_value: 10 },
      { value: '11' },
    ),
    'fail',
  )
  assert.match(
    answerProblem(
      { ...q('measurement', true, 'limits'), min_value: 0, max_value: 10 },
      { value: 'abc' },
    ),
    /numeric/,
  )
  assert.match(configurationProblem(q('pass_fail', false)), /response type/)
  assert.equal(answerProblem(q('text', false), { value: 'Recorded', result: 'pass' }), null) // materialisation removes supplied assessments for information fields
  assert.equal(derivedResult(q('text', false), { value: 'Recorded', result: 'pass' }), null)
  assert.equal(
    fs.readFileSync('src/lib/questionPolicy.ts', 'utf8'),
    fs.readFileSync('../frontend/src/lib/questionPolicy.ts', 'utf8'),
  )
  assert.match(
    answerProblem(
      { ...q('measurement', true, 'limits'), min_value: 0, max_value: 10 },
      { value: '0x20' },
    ),
    /numeric/,
  )
  assert.equal(
    derivedResult(q('yes_no', true, 'expected', { optionMap: { No: 'pass', Yes: 'fail' } }), {
      value: 'No',
    }),
    'pass',
  )
  assert.equal(
    derivedResult(q('text', true, 'expected', { optionMap: { No: 'pass', Yes: 'fail' } }), {
      value: 'constructor',
    }),
    null,
  )
  checks += 22
  const observation = {
    recordId: 'r1',
    workOrderId: 'w1',
    number: 'WO-1',
    date: '2026-10-01T00:00:00Z',
    assetId: 'asset',
    assetNumber: 'ASSET',
    asset: 'Synthetic asset',
    departmentId: 'dept',
    formId: 'form',
    form: 'F',
    revision: '1',
    itemId: 'q',
    lineage: 'checkpoint',
    description: 'Seal',
    classification: 'Unclassified',
    fieldType: 'measurement',
    unit: 'mm',
    min: 0,
    max: 10,
    criteria: 'Explicit demo limit',
    policy: 'explicit',
    assessed: true,
    result: 'fail',
    value: '11',
    answered: true,
  }
  const observations = [
    observation,
    {
      ...observation,
      recordId: 'r2',
      workOrderId: 'w2',
      number: 'WO-2',
      date: '2026-10-15T00:00:00Z',
    },
    { ...observation, recordId: 'r3', result: 'pass', value: '5' },
    {
      ...observation,
      itemId: 'info',
      lineage: 'info',
      assessed: false,
      result: null,
      fieldType: 'text',
      value: 'Info',
    },
    { ...observation, itemId: 'na', lineage: 'na', result: 'na' },
  ]
  const ranked = buildReport('failing-assets', observations)[0]
  assert.equal(ranked.failedItems, 2)
  assert.equal(ranked.assessedItems, 3)
  assert.equal(ranked.itemFailureRate, 66.67)
  const withInformationOnly = buildReport('failing-assets', [
    ...observations,
    {
      ...observation,
      recordId: 'information-only',
      workOrderId: 'information-order',
      assessed: false,
      result: null,
      fieldType: 'text',
      value: 'Information',
    },
  ])[0]
  assert.equal(withInformationOnly.inspectionFailureRate, 66.67)
  assert.equal(buildReport('repeated-observations', observations)[0].failedInspections, 2)
  assert.equal(buildReport('failure-pareto', observations)[0].cumulativePercent, 100)
  assert.equal(buildReport('failure-trends', observations)[0].failureRate, 66.67)
  assert.notEqual(
    buildReport('measurement-trends', [
      observation,
      { ...observation, recordId: 'r2', formId: 'revision2', revision: '2' },
    ])[0].series,
    buildReport('measurement-trends', [
      observation,
      { ...observation, recordId: 'r2', formId: 'revision2', revision: '2' },
    ])[1].series,
  )
  assert.match(safeCsv([{ name: ' =HYPERLINK("bad")' }], [['name', 'Name']]), /' =HYPERLINK/)
  checks += 9
  const before = (
    await db.query(
      "SELECT md5(string_agg(id::text||signature_hash||signed_payload::text,',' ORDER BY id)) digest FROM public.inspection_records WHERE completed_at IS NOT NULL",
    )
  ).rows[0].digest
  const baselineIds = (
    await db.query('SELECT id FROM public.inspection_records WHERE completed_at IS NOT NULL')
  ).rows.map((r) => r.id)
  const items = [
    ['text', true, 'manual', {}, 'Condition observation'],
    ['text', false, 'manual', {}, 'Information serial'],
    ['yes_no', true, 'expected', { expectedAnswer: 'No' }, 'No is acceptable'],
    ['yes_no', true, 'expected', { expectedAnswer: 'Yes' }, 'Yes is acceptable'],
    ['measurement', true, 'limits', {}, 'Fictional reading'],
    ['date', false, 'manual', {}, 'Inspection date'],
    ['signature', false, 'manual', {}, 'Acknowledgement'],
  ].map(([type, required, mode, extra, label], index) => ({
    id: crypto.randomUUID(),
    itemNo: String(index + 1),
    description: label,
    fieldType: type,
    required: true,
    conditionalJson: JSON.stringify({ assessment: { required, mode, ...extra }, allowNA: false }),
    minValue: type === 'measurement' ? 0 : undefined,
    maxValue: type === 'measurement' ? 10 : undefined,
    unit: type === 'measurement' ? 'fictional mm' : undefined,
    sortOrder: index,
  }))
  const input = {
    wiNumber: 'SYNTHETIC-POLICY-ONLY',
    title: 'SYNTHETIC isolated assessment regression',
    revision: '1',
    departmentId: departmentIds.RS,
    checklistItems: items,
  }
  const form = (await call('RS-author', 'POST', '/work-instructions', input)).data
  const reloaded = (await call('RS-author', 'GET', '/work-instructions/' + form.id)).data
  assert.deepEqual(
    reloaded.wi_checklist_items.map((i) => JSON.parse(i.conditional_json).assessment),
    items.map((i) => JSON.parse(i.conditionalJson).assessment),
  )
  checks++
  const approverIds = [personas['RS-reviewer'].id]
  const preview = (
    await call('RS-author', 'POST', `/work-instructions/${form.id}/approval-preview`, {
      approverIds,
    })
  ).data
  const historyBefore = (await call('RS-author', 'GET', '/approvals')).data.filter(
    (a) => a.wi_id === form.id,
  )
  assert.equal(historyBefore.length, 0)
  await request(
    'RS-author',
    'POST',
    `/work-instructions/${form.id}/submit-approval`,
    { approverIds },
    409,
  )
  await call('RS-author', 'PUT', '/work-instructions/' + form.id, {
    ...input,
    title: input.title + ' changed',
  })
  await request(
    'RS-author',
    'POST',
    `/work-instructions/${form.id}/submit-approval`,
    { approverIds, confirmationToken: preview.confirmationToken },
    409,
  )
  await call('RS-author', 'PUT', '/work-instructions/' + form.id, {
    ...input,
    effectiveDate: '2026-01-01',
  })
  const dated = (
    await call('RS-author', 'POST', `/work-instructions/${form.id}/approval-preview`, {
      approverIds,
    })
  ).data
  await call('RS-author', 'PUT', '/work-instructions/' + form.id, {
    ...input,
    effectiveDate: '2026-02-01',
  })
  await request(
    'RS-author',
    'POST',
    `/work-instructions/${form.id}/submit-approval`,
    { approverIds, confirmationToken: dated.confirmationToken },
    409,
  )
  await call('RS-author', 'POST', `/work-instructions/${form.id}/submit-approval`, { approverIds })
  await request(
    'RS-author',
    'POST',
    `/work-instructions/${form.id}/submit-approval`,
    { approverIds },
    409,
  )
  const approval = (await call('RS-reviewer', 'GET', '/approvals')).data.find(
    (a) => a.wi_id === form.id,
  )
  await call(
    'RS-reviewer',
    'PATCH',
    '/approvals/steps/' + approval.approval_steps[0].id + '/approve',
    { comment: 'Synthetic policy reviewed' },
  )
  const revision = (
    await call('RS-author', 'POST', '/work-instructions/' + form.id + '/revise', {
      changeSummary: 'Synthetic policy preservation',
    })
  ).data
  const revisionItems = (await call('RS-author', 'GET', '/work-instructions/' + revision.id)).data
    .wi_checklist_items
  assert.deepEqual(
    revisionItems.map((i) => i.conditional_json),
    reloaded.wi_checklist_items.map((i) => i.conditional_json),
  )
  checks += 3
  async function completeForm(formId, answersFor) {
    const order = (
      await call('admin', 'POST', '/inspections', {
        assetId,
        workInstructionId: formId,
        assignedTo: personas['RS-inspector'].id,
        notes: 'SYNTHETIC policy test',
      })
    ).data
    const record = (await call('RS-inspector', 'POST', '/inspections/' + order.id + '/start', {}))
      .data
    const definitions = (await call('RS-inspector', 'GET', '/inspections/' + order.id)).data
      .checklist_items
    const answers = Object.fromEntries(
      definitions.map((q, i) => [
        q.id,
        { result: null, value: '', notes: '', photos: [], ...answersFor(q, i) },
      ]),
    )
    await call('RS-inspector', 'PUT', '/inspections/' + order.id + '/draft', {
      version: 0,
      answers,
    })
    const reviewed = (
      await call('RS-inspector', 'POST', '/inspections/' + order.id + '/review', {
        inspectionRecordId: record.id,
        draftVersion: 1,
      })
    ).data
    await call('RS-inspector', 'POST', '/inspections/' + order.id + '/complete', {
      inspectionRecordId: record.id,
      draftVersion: 1,
      reviewToken: reviewed.reviewToken,
      signatureDataUrl: demoSignature,
    })
    return (await call('RS-inspector', 'GET', '/inspections/' + order.id + '/record')).data
  }
  const signed = await completeForm(form.id, (q, i) => ({
    result: i === 0 ? 'pass' : null,
    value: ['Condition recorded', 'SERIAL-1', 'No', 'Yes', '11', '2026-10-31', demoSignature][i],
  }))
  assert.equal(signed.passed_items, 3)
  assert.equal(signed.failed_items, 1)
  assert.equal(signed.signed_payload.assessmentSummary.informational, 3)
  assert.equal(
    signed.signed_payload.items.find((i) => i.description === 'Information serial').result,
    null,
  )
  checks += 4
  const infoInput = {
    ...input,
    wiNumber: 'SYNTHETIC-INFORMATION-ONLY',
    checklistItems: [{ ...items[1], id: crypto.randomUUID() }],
  }
  const info = (await call('RS-author', 'POST', '/work-instructions', infoInput)).data
  await call('RS-author', 'POST', `/work-instructions/${info.id}/submit-approval`, { approverIds })
  const infoApproval = (await call('RS-reviewer', 'GET', '/approvals')).data.find(
    (a) => a.wi_id === info.id,
  )
  await call(
    'RS-reviewer',
    'PATCH',
    '/approvals/steps/' + infoApproval.approval_steps[0].id + '/approve',
    { comment: 'Synthetic information-only form' },
  )
  const information = await completeForm(info.id, () => ({
    value: 'Information without assessment',
  }))
  assert.equal(information.passed_items, 0)
  assert.equal(information.overall_result, null)
  assert.equal(information.signed_payload.assessmentSummary.assessed, 0)
  assert.match(information.signed_payload.assessmentSummary.completionLabel, /no assessed checks/)
  checks += 4
  const { inspectionReportHtml, renderInspectionPdf } = require('../dist/lib/inspectionReport')
  assert.match(inspectionReportHtml(information), /Completed — no assessed checks/)
  await fs.promises.mkdir('.env.pdf-checks', { recursive: true })
  await fs.promises.writeFile('.env.pdf-checks/policy-mixed.pdf', await renderInspectionPdf(signed))
  await fs.promises.writeFile(
    '.env.pdf-checks/policy-information.pdf',
    await renderInspectionPdf(information),
  )
  checks++
  const report = await call(
    'admin',
    'GET',
    `/reports/run/failing-assets?from=2020-01-01&to=2099-01-01&formId=${form.id}&pageSize=1`,
  )
  assert.equal(report.summary.assessed, 4)
  assert.equal(report.summary.failures, 1)
  const full = await call(
    'admin',
    'GET',
    '/reports/run/failing-assets?from=2020-01-01&to=2099-01-01&pageSize=100',
  )
  const paged = await call(
    'admin',
    'GET',
    '/reports/run/failing-assets?from=2020-01-01&to=2099-01-01&pageSize=1&page=2',
  )
  assert.deepEqual(full.summary, paged.summary)
  assert.equal(full.meta.total, paged.meta.total)
  await request('RS-inspector', 'GET', '/users', undefined, 403)
  await request('SIG-inspector', 'GET', '/inspections/' + signed.work_order_id, undefined, 404)
  const users = await call(
    'admin',
    'GET',
    '/users?search=RS-author&capability=form_author&pageSize=1',
  )
  assert(users.data.every((u) => u.capabilities.includes('form_author')))
  assert(users.meta.total >= users.data.length)
  const raw = await fetch(
    base + '/reports/run/failing-assets?from=2020-01-01&to=2099-01-01&format=csv&pageSize=1',
    {
      headers: {
        Authorization:
          'Bearer ' +
          jwt.signToken({
            ...personas.admin,
            authVersion: crypto.createHash('sha256').update(fixturePassword).digest('hex'),
          }),
      },
    },
  )
  assert.equal(raw.status, 200)
  assert((await raw.text()).split('\r\n').length > 2)
  const after = (
    await db.query(
      "SELECT md5(string_agg(id::text||signature_hash||signed_payload::text,',' ORDER BY id)) digest FROM public.inspection_records WHERE id=ANY($1::uuid[])",
      [baselineIds],
    )
  ).rows[0].digest
  assert.equal(after, before)
  checks += 9
  console.log(
    `PASS ${checks} assessment, information-only signing, confirmation integrity, user access, report denominator/export and legacy-preservation assertions`,
  )
}
