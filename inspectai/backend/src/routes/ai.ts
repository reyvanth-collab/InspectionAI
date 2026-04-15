import { Router, type Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { z } from 'zod'

const router = Router()

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const AnalyseSchema = z.object({
  itemDescription:     z.string().min(1),
  acceptanceCriteria:  z.string().optional(),
  assetName:           z.string().optional(),
  location:            z.string().optional(),
  inspectorNotes:      z.string().optional(),
})

// POST /api/ai/analyse-failure
// Streams Claude's failure analysis as SSE.
router.post('/analyse-failure', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = AnalyseSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }

  const { itemDescription, acceptanceCriteria, assetName, location, inspectorNotes } = parsed.data

  const prompt = `You are an expert maintenance engineer AI for an inspection management system.

A checklist item has been marked as FAILED during an inspection. Analyse the failure and provide structured recommendations.

## Inspection Context
- Asset: ${assetName ?? 'Not specified'}
- Location: ${location ?? 'Not specified'}
- Failed Item: ${itemDescription}
- Acceptance Criteria: ${acceptanceCriteria ?? 'Not specified'}
${inspectorNotes ? `- Inspector Notes: ${inspectorNotes}` : ''}

## Your response must follow EXACTLY this structure (use these exact headings):

**Root Cause**
[One concise sentence identifying the most likely root cause]

**Failure Class**
[One of: Wear & Tear | Corrosion | Electrical Fault | Mechanical Failure | Calibration Error | Human Error | Environmental | Manufacturing Defect]

**Failure Code**
[A short alphanumeric code, e.g. EL-OC-001 for electrical open circuit]

**Recommended Action**
[2-3 specific, actionable steps to rectify the failure]

**Urgency**
[One of: Immediate | Within 24 hours | Within 7 days | Scheduled Maintenance]

Be concise and specific. Do not add any text outside these five sections.`

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const stream = client.messages.stream({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }],
    })

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`)
    })

    stream.on('message', () => {
      res.write('data: [DONE]\n\n')
      res.end()
    })

    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
      res.end()
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI service error'
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
    res.end()
  }
})

export default router
