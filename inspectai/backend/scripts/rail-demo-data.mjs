export const DEMO_TENANT = 'c7a54fc9-6050-4c6b-8912-5bc476676b1a'
export const DEMO_SLUG = 'inspectai-synthetic-rail-demo'
export const DEMO_NAME = 'Synthetic rail demonstration — not operational'
export const departments = [
  {
    code: 'RS',
    name: 'Rolling Stock',
    assets: 10,
    forms: [
      [
        'Passenger doors',
        ['Door leaf exterior', 'Visible seals and edging', 'Passenger information markings'],
      ],
      [
        'Saloon equipment',
        ['Seat and handrail condition', 'Interior panels and fittings', 'Visible cleanliness'],
      ],
      [
        'Underframe visual condition',
        [
          'Visible equipment covers',
          'Externally visible fastenings',
          'Evidence of external damage',
        ],
      ],
    ],
  },
  {
    code: 'SIG',
    name: 'Signalling',
    assets: 10,
    forms: [
      [
        'Point machines',
        ['External housing condition', 'Identification labels', 'Surrounding visible obstructions'],
      ],
      [
        'Signalling cabinets',
        ['Cabinet exterior', 'Door and latch condition', 'Visible weather protection'],
      ],
      [
        'Axle-counter equipment',
        ['Visible sensor housing', 'External cable protection', 'Equipment identification'],
      ],
    ],
  },
  {
    code: 'PW',
    name: 'Permanent Way',
    assets: 10,
    forms: [
      [
        'Track visual condition',
        ['Visible track-bed condition', 'Accessible line-side signage', 'Visible foreign objects'],
      ],
      [
        'Turnout condition',
        [
          'Visible component condition',
          'Equipment identification',
          'Visible surrounding obstruction',
        ],
      ],
      [
        'Track drainage',
        ['Visible channel condition', 'Drain cover condition', 'Accessible debris observations'],
      ],
    ],
  },
  {
    code: 'TP',
    name: 'Traction Power',
    assets: 8,
    forms: [
      [
        'Substation visual condition',
        ['External building condition', 'Restricted-access signage', 'Visible room housekeeping'],
      ],
      [
        'Switchgear external condition',
        [
          'Closed enclosure exterior',
          'Identification label readability',
          'External warning signage',
        ],
      ],
      [
        'Equipment-room condition',
        ['Accessible floor condition', 'Visible ventilation openings', 'Door and access markings'],
      ],
    ],
  },
  {
    code: 'COM',
    name: 'Communications',
    assets: 6,
    forms: [
      [
        'CCTV equipment',
        [
          'External camera housing',
          'Identification and location label',
          'Visible cable protection',
        ],
      ],
      [
        'Public-address equipment',
        ['External speaker condition', 'Accessible equipment labels', 'Visible mounting condition'],
      ],
    ],
  },
  {
    code: 'SM',
    name: 'Station Mechanical',
    assets: 6,
    forms: [
      [
        'Ventilation equipment',
        ['Visible grille condition', 'External casing condition', 'Equipment-room housekeeping'],
      ],
      [
        'Drainage pumps',
        [
          'Accessible external housing',
          'Visible identification labels',
          'Surrounding drainage observations',
        ],
      ],
    ],
  },
  {
    code: 'SE',
    name: 'Station Electrical',
    assets: 6,
    forms: [
      [
        'Station lighting',
        ['Visible luminaire exterior', 'Accessible lighting labels', 'Visible diffuser condition'],
      ],
      [
        'Distribution enclosures',
        ['Closed enclosure exterior', 'Warning label readability', 'External access condition'],
      ],
    ],
  },
  {
    code: 'DE',
    name: 'Depot Equipment',
    assets: 4,
    forms: [
      [
        'Workshop equipment pre-use',
        [
          'External equipment condition',
          'Readability of equipment labels',
          'Visible surrounding housekeeping',
        ],
      ],
      [
        'Lifting-equipment visual condition',
        [
          'External visual condition only',
          'Identification label readability',
          'Visible storage condition',
        ],
      ],
    ],
  },
]
export const demoSignature =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYZkAAAAASUVORK5CYII='
export function questionsFor(topic, checks) {
  const questions = [
    {
      description: `Confirm the registered identity of this ${topic.toLowerCase()} asset`,
      fieldType: 'pass_fail',
      category: 'Identification and access',
      acceptanceCriteria:
        'Compare the displayed synthetic asset number with this work order. Record any discrepancy.',
    },
    {
      description: 'Record whether the demonstration observation area is accessible',
      fieldType: 'yes_no',
      category: 'Identification and access',
      acceptanceCriteria: 'Observation only. Do not enter restricted areas or operate equipment.',
    },
    ...checks.map((description, i) => ({
      description,
      fieldType: 'pass_fail',
      category: 'Visual observations',
      acceptanceCriteria:
        'Describe visible condition using synthetic scenario information. This is not an operational acceptance standard.',
      ...(i === 0
        ? {
            conditionalJson: JSON.stringify({
              notesOnFail: true,
              photoOnFail: true,
              naReasonRequired: true,
            }),
          }
        : {}),
    })),
    {
      description: `Describe the observed condition of the ${topic.toLowerCase()}`,
      fieldType: 'textarea',
      category: 'Evidence',
      acceptanceCriteria:
        'Record a meaningful training observation; do not use this checklist for operational release.',
    },
    {
      description: 'Record the fictional training indicator reading',
      fieldType: 'measurement',
      unit: 'demo units',
      minValue: 0,
      maxValue: 100,
      category: 'Evidence',
      acceptanceCriteria:
        'FICTIONAL EXAMPLE ONLY: 0–100 demo units demonstrates input validation. This range has no engineering or safety meaning.',
    },
    {
      description: 'Select the demonstration condition category',
      fieldType: 'dropdown',
      optionsJson: JSON.stringify([
        'Synthetic normal condition',
        'Synthetic condition needs review',
      ]),
      category: 'Evidence',
    },
    {
      description: 'Record the date of the demonstration observation',
      fieldType: 'date',
      category: 'Evidence',
    },
    {
      description: 'Add any further demonstration observations',
      fieldType: 'text',
      required: false,
      category: 'Review',
    },
  ]
  return questions.map((q, i) => ({
    required: true,
    ...q,
    itemNo: String(i + 1),
    sortOrder: i * 10,
    layoutJson: JSON.stringify({ width: 'full' }),
  }))
}

// request(persona,method,path,body) must use the real backend routes. This module
// never writes form, approval, work-order or signed inspection tables directly.
export async function seedWorkflow({ request, departmentIds, personas, tenantId = DEMO_TENANT }) {
  if (tenantId !== DEMO_TENANT) throw new Error('Refusing a non-demo tenant')
  const assets = (await request('admin', 'GET', '/assets?pageSize=100')).data
  const forms = (await request('admin', 'GET', '/work-instructions')).data
  const orders = (await request('admin', 'GET', '/inspections?pageSize=100')).data
  let formIndex = 0
  for (const dept of departments) {
    const did = departmentIds[dept.code],
      departmentAssets = []
    for (let n = 1; n <= dept.assets; n++) {
      const number = `DEMO-${dept.code}-${String(n).padStart(3, '0')}`
      let asset = assets.find((a) => a.asset_number === number)
      if (!asset) {
        asset = (
          await request('admin', 'POST', '/assets', {
            assetNumber: number,
            name: `Synthetic ${dept.forms[(n - 1) % dept.forms.length][0]} asset ${n}`,
            departmentId: did,
            category: dept.name,
            location: `FIC-${String((n % 4) + 1).padStart(2, '0')} · Fictional Northbank ${n % 2 ? 'Station' : 'Depot'}, training zone ${n}`,
            status: n % 10 === 0 ? 'maintenance' : 'active',
            criticality: ['low', 'medium', 'high'][n % 3],
            manufacturer: 'Fictional Demonstration Works',
            model: `TRAIN-${dept.code}`,
            serialNumber: `SYNTHETIC-${dept.code}-${n}`,
            notes: 'SYNTHETIC DEMONSTRATION ASSET. Not an operational railway asset.',
          })
        ).data
        assets.push(asset)
      }
      departmentAssets.push(asset)
    }
    for (let n = 0; n < dept.forms.length; n++) {
      const [topic, checks] = dept.forms[n],
        ref = `DEMO-${dept.code}-F${n + 1}`,
        author = `${dept.code}-author`,
        reviewer = `${dept.code}-reviewer`,
        inspector = `${dept.code}-inspector`
      let form = forms.find((f) => f.wi_number === ref && f.revision === 'Demo 1')
      if (!form) {
        form = (
          await request(author, 'POST', '/work-instructions', {
            wiNumber: ref,
            title: `SYNTHETIC DEMO — ${topic}`,
            description:
              'Training content only. Not an approved engineering procedure, safety assessment, or permission to operate equipment.',
            revision: 'Demo 1',
            departmentId: did,
            category: dept.name,
            checklistItems: questionsFor(topic, checks),
          })
        ).data
        forms.push(form)
      }
      if (form.status === 'draft') {
        await request(author, 'POST', `/work-instructions/${form.id}/submit-approval`, {
          approverIds: [personas[reviewer].id],
        })
        form.status = 'pending_approval'
      }
      if (form.status === 'pending_approval') {
        const approvals = (await request(reviewer, 'GET', '/approvals')).data
        for (const a of approvals.filter((a) => a.wi_id === form.id && a.final_status === 'active'))
          for (const step of a.approval_steps.filter((s) => s.status === 'active'))
            await request(reviewer, 'PATCH', `/approvals/steps/${step.id}/approve`, {
              comment:
                'Approved for synthetic demonstration only; not an operational engineering procedure.',
            })
        form.status = 'active'
      }
      const note = `SYNTHETIC RAIL DEMO ${ref}`
      let order = orders.find((o) => o.notes === note)
      if (!order) {
        order = (
          await request('admin', 'POST', '/inspections', {
            assetId: departmentAssets[n].id,
            workInstructionId: form.id,
            assignedTo: personas[inspector].id,
            notes: note,
            priority: formIndex % 3 === 0 ? 'high' : 'medium',
            dueDate: '2027-01-15',
          })
        ).data
        orders.push(order)
      }
      if (
        formIndex % 3 !== 0 &&
        order.status !== 'complete' &&
        !(formIndex % 3 === 1 && order.status === 'in_progress')
      ) {
        const previous =
          order.status === 'in_progress'
            ? (await request(inspector, 'GET', `/inspections/${order.id}/record`)).data
            : null
        const record =
          previous || (await request(inspector, 'POST', `/inspections/${order.id}/start`, {})).data
        const detail = (await request(inspector, 'GET', `/inspections/${order.id}`)).data
        const items = detail.checklist_items
        const toAnswer = formIndex % 3 === 1 ? items.slice(0, 3) : items
        for (const item of toAnswer) {
          const failed = formIndex % 2 === 0 && item.item_no === '3',
            na = item.item_no === '5' && formIndex % 2 === 1
          const result = failed ? 'fail' : na ? 'na' : 'pass'
          const capturedValue =
            item.field_type === 'measurement'
              ? '42'
              : item.field_type === 'yes_no'
                ? 'Yes'
                : item.field_type === 'date'
                  ? '2026-10-25'
                  : item.field_type === 'dropdown'
                    ? 'Synthetic normal condition'
                    : ['text', 'textarea'].includes(item.field_type)
                      ? `Synthetic training observation for ${topic}; no operational decision made.`
                      : ''
          const notes = failed
            ? 'Synthetic visible condition needs review; training evidence attached.'
            : na
              ? 'Synthetic scenario does not include this component.'
              : ''
          const prior = previous?.inspection_findings?.find((f) => f.checklist_item_id === item.id)
          if (
            prior?.result &&
            (prior.result !== result ||
              (prior.captured_value || '') !== capturedValue ||
              (prior.notes || '') !== notes)
          )
            throw new Error(
              'Refusing to overwrite an edited demonstration response; complete the inspection manually before reseeding',
            )
          if (!prior?.result)
            await request(inspector, 'POST', `/inspections/${order.id}/findings`, {
              inspectionRecordId: record.id,
              checklistItemId: item.id,
              result,
              capturedValue,
              notes,
            })
          if (failed && !prior?.photo_urls?.length)
            await request(inspector, 'POST', `/inspections/${order.id}/findings/photo`, {
              inspectionRecordId: record.id,
              checklistItemId: item.id,
              imageDataUrl: demoSignature,
            })
        }
        if (formIndex % 3 === 2)
          await request(inspector, 'POST', `/inspections/${order.id}/complete`, {
            inspectionRecordId: record.id,
            signatureDataUrl: demoSignature,
          })
      }
      if (
        formIndex < 3 &&
        !forms.some(
          (f) =>
            f.previous_revision_id === form.id ||
            (f.wi_number === ref && String(f.revision).startsWith('Draft')),
        )
      ) {
        const draft = (
          await request(author, 'POST', `/work-instructions/${form.id}/revise`, {
            changeSummary: 'Synthetic next revision for lifecycle demonstration',
          })
        ).data
        forms.push({ ...draft, previous_revision_id: form.id })
        if (formIndex === 1 || formIndex === 2)
          await request(author, 'POST', `/work-instructions/${draft.id}/submit-approval`, {
            approverIds: [personas[reviewer].id],
          })
        if (formIndex === 2) {
          const approvals = (await request(reviewer, 'GET', '/approvals')).data
          const active = approvals.find((a) => a.wi_id === draft.id && a.final_status === 'active')
          const step = active.approval_steps.find((s) => s.status === 'active')
          await request(reviewer, 'PATCH', `/approvals/steps/${step.id}/approve`, {
            comment:
              'Published synthetic next revision; historical inspection retains its original version.',
          })
        }
      }
      formIndex++
    }
  }
  return {
    assets: assets.filter((a) => a.asset_number.startsWith('DEMO-')).length,
    distinctForms: new Set(
      forms.filter((f) => f.wi_number.startsWith('DEMO-')).map((f) => f.wi_number),
    ).size,
    workOrders: orders.filter((o) => o.notes?.startsWith('SYNTHETIC RAIL DEMO')).length,
  }
}
