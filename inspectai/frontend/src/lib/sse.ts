export async function readSse(response: Response, onText: (text: string) => void) {
  if (!response.ok || !response.body) throw new Error(`AI request failed (${response.status})`)
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = ''
  try {
    let finished = false
    while (!finished) {
      const { done, value } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let end: number
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).trimEnd(); pending = pending.slice(end + 1)
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') return
        const data = JSON.parse(payload) as { text?: string; error?: string }
        if (data.error) throw new Error(data.error)
        if (typeof data.text === 'string') onText(data.text)
      }
      finished = done
      if (done) { if (pending.trim()) throw new Error('Incomplete AI response'); break }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
