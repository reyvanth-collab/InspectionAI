import { Router, type Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import multer from 'multer'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { z } from 'zod'

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
})

const router = Router()

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// ── POST /api/ai/analyse-failure ─────────────────────────────────
// Streams Claude's failure analysis as SSE, enriched with MOMS history.
const AnalyseSchema = z.object({
  itemDescription:        z.string().min(1),
  acceptanceCriteria:     z.string().optional(),
  assetName:              z.string().optional(),
  location:               z.string().optional(),
  inspectorNotes:         z.string().optional(),
  momsHistoricalNokRate:  z.number().optional(),  // e.g. 23.4
  momsHistoricalTotal:    z.number().optional(),  // e.g. 45
})

router.post('/analyse-failure', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = AnalyseSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { itemDescription, acceptanceCriteria, assetName, location,
          inspectorNotes, momsHistoricalNokRate, momsHistoricalTotal } = parsed.data

  const historicalContext = (momsHistoricalNokRate !== undefined && momsHistoricalTotal !== undefined)
    ? `\n- Historical MOMS Data: This step has failed in ${momsHistoricalNokRate.toFixed(1)}% of ${momsHistoricalTotal} past inspections — treat as a known recurring failure point.`
    : ''

  const prompt = `You are an expert maintenance engineer AI embedded in an inspection management system.

A checklist item has been marked FAILED. Analyse the failure and provide structured, actionable recommendations.

## Inspection Context
- Asset: ${assetName ?? 'Not specified'}
- Location: ${location ?? 'Not specified'}
- Failed Item: ${itemDescription}
- Acceptance Criteria: ${acceptanceCriteria ?? 'Not specified'}${historicalContext}
${inspectorNotes ? `- Inspector Notes: ${inspectorNotes}` : ''}

## Respond EXACTLY in this format (use these exact bold headings, no extra text):

**Root Cause**
One concise sentence identifying the most likely root cause.

**Failure Class**
One of: Wear & Tear | Corrosion | Electrical Fault | Mechanical Failure | Calibration Error | Human Error | Environmental | Manufacturing Defect

**Failure Code**
Short alphanumeric code (e.g. EL-OC-001 for electrical open circuit).

**Recommended Action**
2–3 specific, numbered steps to rectify this failure.

**Urgency**
One of: Immediate shutdown required | Within 24 hours | Within 7 days | Schedule at next maintenance window`

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const stream = client.messages.stream({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }],
    })

    stream.on('text',    (text) => { res.write(`data: ${JSON.stringify({ text })}\n\n`) })
    stream.on('message', ()     => { res.write('data: [DONE]\n\n'); res.end() })
    stream.on('error',   (err)  => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI service error'
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
    res.end()
  }
})

// ── POST /api/ai/analyse-photo ───────────────────────────────────
// Accepts a base64 image + inspection context, returns Claude Vision analysis as SSE.
const PhotoSchema = z.object({
  imageBase64:         z.string().min(1),
  mediaType:           z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  itemDescription:     z.string().min(1),
  acceptanceCriteria:  z.string().optional(),
  assetName:           z.string().optional(),
  location:            z.string().optional(),
})

router.post('/analyse-photo', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = PhotoSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { imageBase64, mediaType, itemDescription, acceptanceCriteria, assetName, location } = parsed.data

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const stream = client.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `You are an expert maintenance engineer AI. Analyse this inspection photo.

## Context
- Asset: ${assetName ?? 'Not specified'}
- Location: ${location ?? 'Not specified'}
- Checklist Item: ${itemDescription}
- Acceptance Criteria: ${acceptanceCriteria ?? 'Not specified'}

Describe exactly what you see that constitutes a failure. Be specific: identify the defect location, appearance, and likely cause. Then provide:

**Visual Defect**
What you observe in the image that indicates a failure.

**Severity Assessment**
One of: Critical (immediate risk) | Major (significant degradation) | Minor (cosmetic / early-stage)

**Likely Cause**
Most probable root cause based on visual evidence.

**Recommended Action**
2–3 specific next steps.`,
          },
        ],
      }],
    })

    stream.on('text',    (text) => { res.write(`data: ${JSON.stringify({ text })}\n\n`) })
    stream.on('message', ()     => { res.write('data: [DONE]\n\n'); res.end() })
    stream.on('error',   (err)  => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI service error'
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
    res.end()
  }
})

// ── POST /api/ai/maximo-payload ──────────────────────────────────
// Generates a structured Maximo Work Order JSON payload from inspection results.
const MaximoSchema = z.object({
  woNumber:    z.string(),
  assetName:   z.string(),
  location:    z.string().optional(),
  wiNumber:    z.string().optional(),
  wiTitle:     z.string().optional(),
  overallResult: z.enum(['pass', 'fail', 'na']),
  completedAt: z.string(),
  inspectorName: z.string(),
  failedItems: z.array(z.object({
    item_no:     z.string(),
    description: z.string(),
    note:        z.string().optional(),
  })),
})

router.post('/maximo-payload', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = MaximoSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const d = parsed.data

  const prompt = `You are a Maximo integration specialist. Generate a valid IBM Maximo Work Order JSON payload based on this inspection result.

## Inspection Summary
- Work Order: ${d.woNumber}
- Asset: ${d.assetName}
- Location: ${d.location ?? 'Not specified'}
- Work Instruction: ${d.wiNumber ?? 'N/A'} — ${d.wiTitle ?? 'N/A'}
- Overall Result: ${d.overallResult.toUpperCase()}
- Completed At: ${d.completedAt}
- Inspector: ${d.inspectorName}

## Failed Items (${d.failedItems.length})
${d.failedItems.map(f => `- [${f.item_no}] ${f.description}${f.note ? `: ${f.note}` : ''}`).join('\n')}

Generate a single JSON object following the Maximo 7.6 REST API schema for a Work Order record. Include:
- siteId, wonum, description, status ("WAPPR" for approval), assetnum, location
- reportedByName, reportDate
- longDescription with full inspection summary
- actuals.failureReport array with one entry per failed item (failureCode, cause, remedy, failureClass)
- A "priority" field: 1 (Emergency) if overallResult is fail and there are ≥3 failed items, 2 (Urgent) if 1-2 failures, 3 (Routine) if passed.

Return ONLY the JSON object, no markdown, no explanation.`

  try {
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1500,
      messages:   [{ role: 'user', content: prompt }],
    })

    const content = message.content[0]
    if (content.type !== 'text') { res.status(500).json({ error: 'Unexpected AI response' }); return }

    // Strip any accidental markdown fences
    const json = content.text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()

    try {
      const payload = JSON.parse(json)
      res.json({ data: payload })
    } catch {
      // Return raw string if JSON parse fails — client can still display it
      res.json({ data: json, raw: true })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI service error'
    res.status(500).json({ error: message })
  }
})

// ── POST /api/ai/import-wi-pdf ───────────────────────────────────
// Accepts a PDF upload, uses Claude to extract all checklist items as structured JSON.
router.post('/import-wi-pdf', requireAuth, upload.single('pdf'), async (req: AuthRequest, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = (req as any).file as Express.Multer.File | undefined
  if (!file) { res.status(400).json({ error: 'No PDF file uploaded' }); return }
  if (file.mimetype !== 'application/pdf') { res.status(400).json({ error: 'File must be a PDF' }); return }

  const pdfBase64 = file.buffer.toString('base64')

  try {
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          } as Anthropic.DocumentBlockParam,
          {
            type: 'text',
            text: `Extract ALL checklist items from this Work Instruction PDF and return ONLY a JSON object.

Schema:
{
  "wiTitle": "full title string",
  "wiNumber": "WI number/code e.g. SIG/WI/PMW/0005",
  "revision": "revision e.g. Rev 15 or REV 15",
  "items": [
    {
      "itemNo": "item number or letter (e.g. A, 17.1, 17.1.1, 17.4.1)",
      "description": "the full task description text",
      "fieldType": "heading|pass_fail|text|measurement|textarea",
      "acceptanceCriteria": "specific pass/fail criteria if stated, else null",
      "required": true
    }
  ]
}

Rules for fieldType:
- Section titles, task group headers, sub-section headers → "heading"
- Items with OK/NOK/NA or Pass/Fail columns → "pass_fail"
- Items that say "measure and record", "record readings", "record voltage" → "measurement"
- Items requiring written description or observation text → "textarea"
- Default for any other checkable item → "pass_fail"

Important:
- Include ALL checklist rows in order — do not skip any
- Do NOT include document header, footer, signature blocks, title page, date fields, or table column headers
- Set itemNo exactly as shown in the document (e.g. "A", "17.1.1", "17.4.2")
- The items array must be in document order
- Return ONLY the JSON object — no markdown, no explanation`,
          },
        ],
      }],
    })

    const content = message.content[0]
    if (content.type !== 'text') { res.status(500).json({ error: 'Unexpected AI response type' }); return }

    const raw = content.text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()

    try {
      const parsed = JSON.parse(raw) as {
        wiTitle: string; wiNumber: string; revision?: string
        items: Array<{ itemNo: string; description: string; fieldType: string; acceptanceCriteria: string | null; required: boolean }>
      }
      res.json({ data: parsed })
    } catch {
      res.status(500).json({ error: 'AI returned invalid JSON — please try again', raw })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI service error'
    res.status(500).json({ error: message })
  }
})

export default router
