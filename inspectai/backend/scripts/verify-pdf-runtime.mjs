// Runs inside the production image without database or Auth credentials.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
const require = createRequire(import.meta.url)
const { canonicalJson } = require('../dist/lib/signature.js')
const { renderInspectionPdf } = require('../dist/lib/inspectionReport.js')
const signed_payload = {
  workspaceName: 'Synthetic renderer smoke test',
  workOrderNumber: 'WO-SMOKE',
  formRevision: '1',
  signerName: 'Synthetic fixture',
  items: [{ item_no: '1', description: 'Synthetic observation', result: 'pass' }],
}
const record = {
  id: 'smoke-test',
  signed_at: '2026-10-27T00:00:00Z',
  overall_result: 'pass',
  signed_payload,
  signature_hash: createHash('sha256').update(canonicalJson(signed_payload)).digest('hex'),
}
const pdf = await renderInspectionPdf(record)
if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF renderer did not produce a PDF')
console.log('PASS production PDF renderer with installed Chromium and fonts')
