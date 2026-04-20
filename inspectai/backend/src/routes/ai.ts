import { Router, type Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { z } from 'zod'

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

export default router
