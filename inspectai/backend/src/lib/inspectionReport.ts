import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { canonicalJson } from './signature'
import { createHash } from 'node:crypto'
import { validPhoto } from './inspectionDraft'

const escape = (v: unknown) =>
  String(v ?? 'Not recorded in signed snapshot').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const text = (v: unknown) => `<span class="value">${escape(v)}</span>`
const image = (v: unknown, caption: string) =>
  validPhoto(v)
    ? `<figure><img src="${v}" alt="${escape(caption)}"><figcaption>${escape(caption)}</figcaption></figure>`
    : '<p>Image unavailable in the signed record.</p>'
function response(item: any) {
  if (item.field_type === 'signature')
    return item.captured_value ? image(item.captured_value, 'Question signature') : 'Unanswered'
  if (item.field_type === 'table' && item.captured_value) {
    try {
      const values = JSON.parse(item.captured_value),
        layout = JSON.parse(item.layout_json || '{}'),
        columns = layout.tableColumns || ['Item', 'Observation']
      const count = Math.min(
        100,
        Math.max(
          Number(layout.tableRows) || 0,
          ...Object.keys(values).map((k) => Number(k.split(':')[0]) + 1),
        ),
      )
      return `<table class="response"><thead><tr>${columns.map((c: unknown) => `<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: count }, (_, r) => `<tr>${columns.map((_: unknown, c: number) => `<td>${text(values[`${r}:${c}`] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    } catch {
      return text(item.captured_value)
    }
  }
  return text(item.captured_value || (item.result ? item.result.toUpperCase() : 'Unanswered'))
}
export function inspectionReportHtml(record: any): string {
  const p = record.signed_payload
  if (!p || !Array.isArray(p.items))
    throw new Error(
      'This legacy inspection has no immutable signed snapshot; a report cannot be reconstructed safely.',
    )
  if (createHash('sha256').update(canonicalJson(p)).digest('hex') !== record.signature_hash)
    throw new Error('Signed snapshot integrity check failed')
  const items = p.items,
    failed = items.filter((i: any) => i.result === 'fail'),
    answered = items.filter((i: any) => i.result)
  const ref = `IR-${record.id}`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(ref)}</title><style>
 @page{size:A4;margin:24mm 15mm 22mm}*{box-sizing:border-box}body{font:10pt Arial,'Noto Sans','Noto Sans CJK SC',sans-serif;color:#193047;line-height:1.5}h1{font-size:22pt;margin:5mm 0}h2{font-size:13pt;color:#175b9c;border-bottom:1px solid #c9d5df;padding-bottom:2mm;margin:7mm 0 3mm}h3{font-size:11pt;margin:3mm 0}p{margin:2mm 0}.muted{color:#506579}.identity{color:#175b9c;font-weight:bold}.meta{display:grid;grid-template-columns:1fr 1fr;gap:3mm;padding:5mm;background:#f0f5f9}.meta div{min-width:0}.label{display:block;font-size:8pt;color:#506579}.value{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.summary{padding:4mm;border:1px solid #aebfce;margin:5mm 0}.question{border-bottom:1px solid #c9d5df;padding:3mm 0}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th,td{border:1px solid #c9d5df;padding:2mm;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eaf1f7}tr{break-inside:avoid}figure{margin:4mm 0;break-inside:avoid}img{max-width:100%;max-height:125mm;object-fit:contain}figcaption{font-size:8pt;color:#506579}.signature img{max-height:30mm}h2,h3{break-after:avoid}.fail{color:#a22b27}.hash{font:7pt monospace;overflow-wrap:anywhere}.response{font-size:9pt}
 </style></head><body><div class="identity">${escape(p.workspaceName)}</div><h1>Completed inspection report</h1><p class="muted">${escape(ref)}</p>
 <div class="meta">${[
   ['Work order', p.workOrderNumber],
   ['Asset number', p.assetNumber],
   ['Asset description', p.assetName],
   ['Department', p.departmentName],
   ['Location', p.location],
   ['Form reference', p.formReference],
   ['Form title', p.formTitle],
   ['Exact revision', p.formRevision],
   ['Inspector / signer', p.signerName || p.signerId],
   [
     'Signed at (UTC)',
     new Date(record.signed_at).toISOString().replace('T', ' ').replace('Z', ' UTC'),
   ],
 ]
   .map(([k, v]) => `<div><span class="label">${escape(k)}</span>${text(v)}</div>`)
   .join('')}</div>
 <div class="summary"><strong>Outcome: ${escape(record.overall_result?.toUpperCase())}</strong><p>${answered.length} answered / ${items.filter((i: any) => i.field_type !== 'heading').length} questions · ${failed.length} failed · ${items.filter((i: any) => i.result === 'na').length} N/A · ${items.filter((i: any) => i.field_type !== 'heading' && !i.result).length} unanswered</p></div>
 <h2>Failed-item summary</h2>${failed.length ? failed.map((i: any) => `<p class="fail">${escape(i.item_no)} — ${escape(i.description)}${i.notes ? ' — ' + escape(i.notes) : ''}</p>`).join('') : '<p>No failed items recorded.</p>'}
 <h2>Checklist and recorded evidence</h2><table><thead><tr><th style="width:16%">Question</th><th>Recorded response and evidence</th></tr></thead><tbody>${items.map((i: any) => (i.field_type === 'heading' ? `<tr><td colspan="2"><h3>${escape(i.description)}</h3></td></tr>` : `<tr><td>${escape(i.item_no)}<p class="muted">${escape(i.result?.toUpperCase() || 'Unanswered')}</p></td><td><h3>${escape(i.description)}</h3><p class="muted">Section: ${escape(i.category)}</p><p><strong>Acceptance criteria:</strong> ${text(i.acceptance_criteria)}</p><p><strong>Response${['number', 'measurement'].includes(i.field_type) ? ' / reading' : ''}:</strong> ${response(i)} ${escape(i.unit || (i.field_type === 'measurement' ? 'Unit not recorded (legacy)' : ''))}</p>${i.na_reason ? `<p><strong>N/A explanation:</strong> ${text(i.na_reason)}</p>` : ''}${i.notes ? `<p><strong>${i.result === 'na' && !i.na_reason ? 'N/A explanation (legacy)' : 'Notes'}:</strong> ${text(i.notes)}</p>` : ''}${(i.photo_urls || []).map((v: unknown, n: number) => image(v, `Question ${i.item_no} — evidence ${n + 1}: ${i.description}`)).join('')}</td></tr>`)).join('')}</tbody></table>
 <h2>Recorded signature</h2><div class="signature">${image(p.signatureDataUrl, 'Authenticated inspection signature')}</div><p>Signer: ${escape(p.signerName || p.signerId)}</p><p class="hash">Snapshot SHA-256: ${escape(record.signature_hash)}</p><p class="muted">Generated from the immutable signed inspection snapshot. Unavailable legacy information is explicitly labelled.</p></body></html>`
}
let active = 0
export async function renderInspectionPdf(record: any): Promise<Buffer> {
  if (active >= 2) throw new Error('Report renderer is busy. Please retry shortly.')
  const html = inspectionReportHtml(record)
  const executablePath =
    process.env.PDF_CHROMIUM_PATH ||
    (process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : '/usr/bin/chromium')
  if (!existsSync(executablePath))
    throw new Error('Report renderer is unavailable. Configure PDF_CHROMIUM_PATH.')
  active++
  let browser
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        ...(process.env.PDF_NO_SANDBOX === 'true' ? ['--no-sandbox'] : []),
      ],
    })
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', (r) => {
      void (r.url().startsWith('data:') ? r.continue() : r.abort())
    })
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 })
    return Buffer.from(
      await page.pdf({
        format: 'A4',
        waitForFonts: false,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate:
          '<div style="font:8px Arial;width:100%;text-align:center;color:#506579">InspectionAI · Completed inspection report</div>',
        footerTemplate:
          '<div style="font:8px Arial;width:100%;text-align:center;color:#506579">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
        margin: { top: '24mm', bottom: '22mm', left: '15mm', right: '15mm' },
        timeout: 30000,
      }),
    )
  } finally {
    await browser?.close()
    active--
  }
}
