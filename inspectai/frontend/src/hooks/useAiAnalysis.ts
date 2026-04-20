import { useState, useCallback } from 'react'
import { JWT_KEY } from '@/lib/api'

export interface AiAnalysis {
  text:    string
  loading: boolean
  error:   string | null
}

interface AnalyseParams {
  itemId:                  string
  itemDescription:         string
  acceptanceCriteria?:     string
  assetName?:              string
  location?:               string
  inspectorNotes?:         string
  momsHistoricalNokRate?:  number   // e.g. 23.4 (percent)
  momsHistoricalTotal?:    number   // e.g. 45 (total inspections)
}

export function useAiAnalysis() {
  const [analyses, setAnalyses] = useState<Record<string, AiAnalysis>>({})

  const analyse = useCallback(async (params: AnalyseParams) => {
    const { itemId, ...body } = params

    setAnalyses(prev => ({
      ...prev,
      [itemId]: { text: '', loading: true, error: null },
    }))

    try {
      const token = localStorage.getItem(JWT_KEY) ?? ''

      const res = await fetch('/api/ai/analyse-failure', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `HTTP ${res.status}`)
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

        for (const line of lines) {
          const json = line.slice(6).trim()
          if (json === '[DONE]') {
            setAnalyses(prev => ({
              ...prev,
              [itemId]: { ...prev[itemId], loading: false },
            }))
            break
          }
          try {
            const parsed = JSON.parse(json) as { text?: string; error?: string }
            if (parsed.error) throw new Error(parsed.error)
            if (parsed.text) {
              setAnalyses(prev => ({
                ...prev,
                [itemId]: {
                  ...prev[itemId],
                  text: (prev[itemId]?.text ?? '') + parsed.text,
                },
              }))
            }
          } catch { /* skip malformed chunk */ }
        }
      }
    } catch (err) {
      setAnalyses(prev => ({
        ...prev,
        [itemId]: {
          text:    '',
          loading: false,
          error:   err instanceof Error ? err.message : 'AI analysis failed',
        },
      }))
    } finally {
      setAnalyses(prev => ({
        ...prev,
        [itemId]: { ...prev[itemId], loading: false },
      }))
    }
  }, [])

  const clear = useCallback((itemId: string) => {
    setAnalyses(prev => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
  }, [])

  return { analyses, analyse, clear }
}
