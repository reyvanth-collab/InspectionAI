import { Router, type Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import multer from 'multer'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { z } from 'zod'
import { query } from '../lib/db'
import { auditLog } from '../lib/events'
import { createAiProvider } from '../lib/ai/provider'

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
})

const router = Router()

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

type ValidationStatus = 'aligned' | 'review_required' | 'uncertain'
type FindingResult = 'pass' | 'fail' | 'na'

interface ValidationResult {
  status: ValidationStatus
  recommendedResult: FindingResult | 'keep'
  confidence: number
  reason: string
  evidence: string[]
  riskLevel: 'low' | 'medium' | 'high'
  requiredAction: string
}

interface ValidateFindingInput {
  inspectionRecordId: string
  checklistItemId: string
  selectedResult: FindingResult
  itemDescription: string
  acceptanceCriteria?: string
  fieldType?: string
  required?: boolean
  minValue?: number | null
  maxValue?: number | null
  capturedValue?: string
  inspectorNotes?: string
  assetName?: string
  location?: string
  photoCount?: number
  momsHistoricalNokRate?: number
  momsHistoricalTotal?: number
}

function stripJsonFences(text: string) {
  return text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
}

function clampConfidence(value: unknown, fallback = 0.5) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

function deterministicValidation(input: ValidateFindingInput): ValidationResult {
  const evidence: string[] = []
  const note = `${input.inspectorNotes ?? ''} ${input.capturedValue ?? ''}`.toLowerCase()
  const value = input.capturedValue != null && input.capturedValue.trim() !== ''
    ? Number(input.capturedValue)
    : null
  const failWords = ['leak', 'leaking', 'crack', 'broken', 'damage', 'damaged', 'corrosion', 'corroded', 'burn', 'loose', 'fail', 'failed', 'nok', 'unsafe']

  if (value != null && Number.isFinite(value)) {
    if (input.minValue != null && value < input.minValue) evidence.push(`Measured value ${value} is below minimum ${input.minValue}`)
    if (input.maxValue != null && value > input.maxValue) evidence.push(`Measured value ${value} is above maximum ${input.maxValue}`)
  }

  const noteLooksBad = failWords.some(word => note.includes(word))
  if (noteLooksBad) evidence.push('Inspector notes/value contain defect language')

  if (input.selectedResult === 'pass' && evidence.length > 0) {
    return {
      status: 'review_required',
      recommendedResult: 'fail',
      confidence: 0.86,
      reason: 'The selected PASS conflicts with recorded evidence or configured limits.',
      evidence,
      riskLevel: 'high',
      requiredAction: 'Supervisor or inspector must review the result before completion.',
    }
  }

  if (input.selectedResult === 'fail' && !input.inspectorNotes && !input.capturedValue && (input.photoCount ?? 0) === 0) {
    return {
      status: 'uncertain',
      recommendedResult: 'keep',
      confidence: 0.62,
      reason: 'The FAIL result has no supporting note, measurement, or photo evidence.',
      evidence: ['Failure result lacks supporting evidence'],
      riskLevel: 'medium',
      requiredAction: 'Add evidence or confirm the failure during review.',
    }
  }

  if (input.selectedResult === 'na' && input.required !== false) {
    return {
      status: 'review_required',
      recommendedResult: 'keep',
      confidence: 0.78,
      reason: 'A required checklist item was marked N/A.',
      evidence: ['Required item marked N/A'],
      riskLevel: 'medium',
      requiredAction: 'Confirm why the required item is not applicable.',
    }
  }

  return {
    status: 'aligned',
    recommendedResult: 'keep',
    confidence: evidence.length > 0 ? 0.72 : 0.82,
    reason: 'The selected result is consistent with the available structured evidence.',
    evidence,
    riskLevel: 'low',
    requiredAction: 'No additional action required beyond normal review.',
  }
}

// ── POST /api/ai/analyse-failure ─────────────────────────────────
// Streams Claude's failure analysis as SSE, enriched with MOMS history.
const AnalyseSchema = z.object({
  itemDescription:        z.string().min(1),
  acceptanceCriteria:     z.string().optional(),
  fieldType:              z.string().optional(),
  selectedResult:         z.enum(['pass', 'fail', 'na']).optional(),
  capturedValue:          z.string().optional(),
  assetName:              z.string().optional(),
  location:               z.string().optional(),
  inspectorNotes:         z.string().optional(),
  momsHistoricalNokRate:  z.number().optional(),  // e.g. 23.4
  momsHistoricalTotal:    z.number().optional(),  // e.g. 45
})

router.post('/analyse-failure', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = AnalyseSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { itemDescription, acceptanceCriteria, fieldType, selectedResult, capturedValue, assetName, location,
          inspectorNotes, momsHistoricalNokRate, momsHistoricalTotal } = parsed.data

  const historicalContext = (momsHistoricalNokRate !== undefined && momsHistoricalTotal !== undefined)
    ? `\n- Historical MOMS Data: This step has failed in ${momsHistoricalNokRate.toFixed(1)}% of ${momsHistoricalTotal} past inspections — treat as a known recurring failure point.`
    : ''

  const prompt = `You are an expert maintenance engineer AI embedded in an inspection management system.

A checklist item has been marked FAILED. Give a checklist-specific initial suggestion first, then ask only for extra evidence that would materially improve accuracy.

## Inspection Context
- Asset: ${assetName ?? 'Not specified'}
- Location: ${location ?? 'Not specified'}
- Failed Item: ${itemDescription}
- Acceptance Criteria: ${acceptanceCriteria ?? 'Not specified'}${historicalContext}
- Field Type: ${fieldType ?? 'pass_fail'}
- Selected Result: ${selectedResult ?? 'fail'}
- Captured Value: ${capturedValue ?? 'None'}
${inspectorNotes ? `- Inspector Notes: ${inspectorNotes}` : ''}

Accuracy rules:
- Anchor every recommendation to the failed item and acceptance criteria.
- If notes, photos, or measurements are missing, do not invent details; state the most likely issue from the checklist context and list the exact evidence needed next.
- Treat "No" on a yes/no checklist as the failed condition unless the acceptance criteria says otherwise.
- Keep the response useful before asking for more detail.

## Respond EXACTLY in this format (use these exact bold headings, no extra text):

**Root Cause**
One concise sentence identifying the most likely root cause from the checklist context.

**Failure Class**
One of: Wear & Tear | Corrosion | Electrical Fault | Mechanical Failure | Calibration Error | Human Error | Environmental | Manufacturing Defect

**Failure Code**
Short alphanumeric code (e.g. EL-OC-001 for electrical open circuit).

**Recommended Action**
2–3 specific, numbered steps to rectify this failure.

**Need More Detail**
One sentence naming the most valuable note, measurement, or photo to capture next.

**Urgency**
One of: Immediate shutdown required | Within 24 hours | Within 7 days | Schedule at next maintenance window`

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('your-')) {
    const fallback = [
      '**Root Cause**',
      `The failed condition is most likely related to the checklist requirement: ${acceptanceCriteria ?? itemDescription}.`,
      '',
      '**Failure Class**',
      'Mechanical Failure',
      '',
      '**Failure Code**',
      'CHK-FAIL-001',
      '',
      '**Recommended Action**',
      '1. Re-check the item against the acceptance criteria.',
      '2. Isolate or tag the asset if the failed condition creates an operational or safety risk.',
      '3. Record the corrective action and supervisor review outcome.',
      '',
      '**Need More Detail**',
      'Capture a short defect note, one close-up photo, or the exact measurement that proves why this checklist item failed.',
      '',
      '**Urgency**',
      'Within 24 hours',
    ].join('\n')
    res.write(`data: ${JSON.stringify({ text: fallback })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  try {
    if ((process.env.AI_PROVIDER ?? 'anthropic').toLowerCase() === 'openai') {
      const provider = createAiProvider()
      const text = await provider.completeText(prompt, 600)
      res.write(`data: ${JSON.stringify({ text })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
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
  imageBase64:         z.string().min(1).max(28_000_000, 'Image is too large; maximum supported size is 20 MB'),
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
    const provider = createAiProvider()
    if (provider.name === 'openai') {
      const text = await provider.analyzeImage({
        imageBase64,
        mediaType,
        maxTokens: 800,
        prompt: `You are an expert maintenance engineer. Analyse this inspection photo for the checklist item "${itemDescription}". Acceptance criteria: ${acceptanceCriteria ?? 'Not specified'}. Asset: ${assetName ?? 'Not specified'}. Location: ${location ?? 'Not specified'}. Describe visible defects, severity (Critical, Major, or Minor), likely cause, and 2-3 recommended actions. Do not invent details not visible in the image.`,
      })
      res.write(`data: ${JSON.stringify({ text })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
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

// POST /api/ai/validate-finding
// Checks whether the selected inspection result agrees with evidence and criteria.
const ValidateFindingSchema = z.object({
  inspectionRecordId: z.string().uuid(),
  checklistItemId:   z.string().uuid(),
  selectedResult:    z.enum(['pass', 'fail', 'na']),
  itemDescription:   z.string().min(1),
  acceptanceCriteria:z.string().optional(),
  fieldType:         z.string().optional(),
  required:          z.boolean().optional(),
  minValue:          z.number().nullable().optional(),
  maxValue:          z.number().nullable().optional(),
  capturedValue:     z.string().optional(),
  inspectorNotes:    z.string().optional(),
  assetName:         z.string().optional(),
  location:          z.string().optional(),
  photoCount:        z.number().int().min(0).optional(),
  momsHistoricalNokRate: z.number().optional(),
  momsHistoricalTotal:   z.number().optional(),
})

router.post('/validate-finding', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = ValidateFindingSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const input = parsed.data
  let validation = deterministicValidation(input)
  const model = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase() === 'openai'
    ? process.env.OPENAI_MODEL ?? 'gpt-4o'
    : 'claude-haiku-4-5-20251001'

  if ((process.env.AI_PROVIDER ?? 'anthropic').toLowerCase() === 'openai') {
    try {
      const provider = createAiProvider()
      const raw = stripJsonFences(await provider.completeText(`Validate this industrial inspection result. Return only JSON with status (aligned, review_required, or uncertain), recommendedResult (pass, fail, na, or keep), confidence from 0 to 1, reason, evidence array, riskLevel (low, medium, or high), and requiredAction.
Checklist item: ${input.itemDescription}
Acceptance criteria: ${input.acceptanceCriteria ?? 'Not specified'}
Selected result: ${input.selectedResult}; captured value: ${input.capturedValue ?? 'None'}; notes: ${input.inspectorNotes ?? 'None'}
Deterministic pre-check: ${JSON.stringify(validation)}`, 900))
      const ai = JSON.parse(raw) as Partial<ValidationResult>
      validation = {
        status: ['aligned', 'review_required', 'uncertain'].includes(String(ai.status)) ? ai.status as ValidationStatus : validation.status,
        recommendedResult: ['pass', 'fail', 'na', 'keep'].includes(String(ai.recommendedResult)) ? ai.recommendedResult as FindingResult | 'keep' : validation.recommendedResult,
        confidence: clampConfidence(ai.confidence, validation.confidence),
        reason: typeof ai.reason === 'string' && ai.reason.trim() ? ai.reason : validation.reason,
        evidence: Array.isArray(ai.evidence) ? ai.evidence.map(String).slice(0, 8) : validation.evidence,
        riskLevel: ['low', 'medium', 'high'].includes(String(ai.riskLevel)) ? ai.riskLevel as 'low' | 'medium' | 'high' : validation.riskLevel,
        requiredAction: typeof ai.requiredAction === 'string' && ai.requiredAction.trim() ? ai.requiredAction : validation.requiredAction,
      }
    } catch {
      // Keep deterministic result when the selected provider is unavailable or returns malformed JSON.
    }
  } else if (process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('your-')) {
    try {
      const message = await client.messages.create({
        model,
        max_tokens: 900,
        messages: [{
          role: 'user',
          content: `You are an industrial inspection quality-control AI. Validate whether the inspector's selected result is consistent with the checklist criteria and evidence.

Return ONLY a JSON object with this exact shape:
{
  "status": "aligned|review_required|uncertain",
  "recommendedResult": "pass|fail|na|keep",
  "confidence": 0.0,
  "reason": "short explanation",
  "evidence": ["specific evidence strings"],
  "riskLevel": "low|medium|high",
  "requiredAction": "what the human reviewer should do"
}

Rules:
- Never silently override the inspector. Flag review only.
- If PASS conflicts with notes, value limits, or defect language, use review_required.
- If FAIL has weak evidence, use uncertain unless evidence clearly supports fail.
- If N/A is used on a required item, use review_required.
- If evidence is insufficient, be conservative and use uncertain.

Context:
- Asset: ${input.assetName ?? 'Not specified'}
- Location: ${input.location ?? 'Not specified'}
- Checklist item: ${input.itemDescription}
- Acceptance criteria: ${input.acceptanceCriteria ?? 'Not specified'}
- Field type: ${input.fieldType ?? 'pass_fail'}
- Required: ${input.required !== false}
- Selected result: ${input.selectedResult}
- Captured value: ${input.capturedValue ?? 'None'}
- Min value: ${input.minValue ?? 'None'}
- Max value: ${input.maxValue ?? 'None'}
- Inspector notes: ${input.inspectorNotes ?? 'None'}
- Photo count: ${input.photoCount ?? 0}
- Historical NOK rate: ${input.momsHistoricalNokRate ?? 'Unknown'}
- Historical sample size: ${input.momsHistoricalTotal ?? 'Unknown'}

Deterministic pre-check:
${JSON.stringify(validation)}`,
        }],
      })
      const content = message.content[0]
      if (content.type === 'text') {
        const raw = stripJsonFences(content.text)
        const ai = JSON.parse(raw) as Partial<ValidationResult>
        validation = {
          status: ['aligned', 'review_required', 'uncertain'].includes(String(ai.status))
            ? ai.status as ValidationStatus
            : validation.status,
          recommendedResult: ['pass', 'fail', 'na', 'keep'].includes(String(ai.recommendedResult))
            ? ai.recommendedResult as FindingResult | 'keep'
            : validation.recommendedResult,
          confidence: clampConfidence(ai.confidence, validation.confidence),
          reason: typeof ai.reason === 'string' && ai.reason.trim() ? ai.reason : validation.reason,
          evidence: Array.isArray(ai.evidence) ? ai.evidence.map(String).slice(0, 8) : validation.evidence,
          riskLevel: ['low', 'medium', 'high'].includes(String(ai.riskLevel))
            ? ai.riskLevel as 'low' | 'medium' | 'high'
            : validation.riskLevel,
          requiredAction: typeof ai.requiredAction === 'string' && ai.requiredAction.trim()
            ? ai.requiredAction
            : validation.requiredAction,
        }
      }
    } catch {
      // Keep deterministic result when the AI service is unavailable or returns malformed JSON.
    }
  }

  const updateRes = await query(
    `UPDATE public.inspection_findings f
     SET ai_validation_status = $1,
         ai_validation_confidence = $2,
         ai_validation_reason = $3,
         ai_validation_recommended_result = $4,
         ai_validation_evidence = $5::jsonb,
         updated_at = NOW()
     FROM public.inspection_records ir
     WHERE f.inspection_record_id = ir.id
       AND f.inspection_record_id = $6
       AND f.checklist_item_id = $7
       AND f.tenant_id = $8
       AND ir.tenant_id = $8
     RETURNING f.id`,
    [
      validation.status,
      validation.confidence,
      validation.reason,
      validation.recommendedResult,
      JSON.stringify({
        evidence: validation.evidence,
        riskLevel: validation.riskLevel,
        requiredAction: validation.requiredAction,
        model,
        promptVersion: 'finding-validation-v1',
      }),
      input.inspectionRecordId,
      input.checklistItemId,
      req.user!.tenantId,
    ]
  )

  if (updateRes.rows.length > 0) {
    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'ai.finding.validated',
      entityType: 'inspection_findings',
      entityId: updateRes.rows[0].id,
      severity: validation.status === 'review_required' ? 'warning' : 'info',
      detail: {
        status: validation.status,
        recommended_result: validation.recommendedResult,
        confidence: validation.confidence,
        prompt_version: 'finding-validation-v1',
        model,
      },
    })
  }

  res.json({ data: validation })
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
    if ((process.env.AI_PROVIDER ?? 'anthropic').toLowerCase() === 'openai') {
      const provider = createAiProvider()
      const json = (await provider.completeText(prompt, 1500)).replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
      try {
        res.json({ data: JSON.parse(json) })
      } catch {
        res.json({ data: json, raw: true })
      }
      return
    }
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
    const provider = createAiProvider()
    if (provider.name === 'openai') {
      const raw = await provider.extractPdf({
        pdfBase64,
        filename: file.originalname,
        maxTokens: 8000,
        prompt: `Extract every checklist row from this work-instruction PDF. Return only JSON with wiTitle, wiNumber, revision, and items. Each item must include itemNo, description, fieldType, acceptanceCriteria, required, sourcePage, sourceText, confidence, and warnings. Preserve document order. Exclude headers, footers, signatures, and column headings. Use fieldType heading, pass_fail, text, measurement, or textarea. Do not add markdown.`,
      })
      try {
        res.json({ data: JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()) })
      } catch {
        res.status(500).json({ error: 'AI returned invalid JSON — please try again', raw })
      }
      return
    }
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
      "required": true,
      "sourcePage": 1,
      "sourceText": "short verbatim source snippet from the PDF row",
      "confidence": 0.0,
      "warnings": ["short warning strings if extraction is unclear, else empty array"]
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
- For each item include the PDF page number and a short sourceText snippet used to extract it
- Use confidence 0.0 to 1.0; below 0.75 means a human must review the row carefully
- Add warnings for unclear row merges, missing criteria, ambiguous field type, duplicate item numbers, or partial text
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
        items: Array<{
          itemNo: string
          description: string
          fieldType: string
          acceptanceCriteria: string | null
          required: boolean
          sourcePage?: number | null
          sourceText?: string | null
          confidence?: number | null
          warnings?: string[]
        }>
      }
      await auditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: 'ai.wi_pdf.extracted',
        entityType: 'work_instructions',
        severity: parsed.items.some(item => (item.confidence ?? 1) < 0.75 || (item.warnings?.length ?? 0) > 0) ? 'warning' : 'info',
        detail: {
          file_name: file.originalname,
          wi_number: parsed.wiNumber,
          item_count: parsed.items.length,
          low_confidence_count: parsed.items.filter(item => (item.confidence ?? 1) < 0.75).length,
          warning_count: parsed.items.reduce((sum, item) => sum + (item.warnings?.length ?? 0), 0),
          model: provider.model,
          prompt_version: 'wi-pdf-extraction-v2',
        },
      })
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
