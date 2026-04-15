import { useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface AiAnalysis {
  text:    string
  loading: boolean
  error:   string | null
}

export function useAiAnalysis() {
  const [analyses, setAnalyses] = useState<Record<string, AiAnalysis>>({})

  const analyse = useCallback(async (params: {
    itemId:             string
    itemDescription:    string
    acceptanceCriteria?: string
    assetName?:         string
    location?:          string
    inspectorNotes?:    string
  }) => {
    const { itemId, ...body } = params

    // Reset this item's analysis
    setAnalyses(prev => ({
      ...prev,
      [itemId]: { text: '', loading: true, error: null },
    }))

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? ''

      const res = await fetch('/api/ai/analyse-failure', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

        for (const line of lines) {
          const json = line.slice(6)
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
