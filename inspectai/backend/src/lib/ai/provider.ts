import Anthropic from '@anthropic-ai/sdk'

export type AiProviderName = 'anthropic' | 'openai'

export interface AiImageInput {
  imageBase64: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  prompt: string
  maxTokens?: number
}

export interface AiPdfInput {
  pdfBase64: string
  prompt: string
  filename?: string
  maxTokens?: number
}

export interface AiProvider {
  readonly name: AiProviderName
  readonly model: string
  completeText(prompt: string, maxTokens?: number): Promise<string>
  analyzeImage(input: AiImageInput): Promise<string>
  extractPdf(input: AiPdfInput): Promise<string>
}

export class AiProviderError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'AiProviderError'
  }
}

function isConfiguredKey(value: string | undefined) {
  const key = value?.trim()
  return Boolean(key && !/^(your-|placeholder|change-me|test-)/i.test(key))
}

function requiredKey(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]
  if (!isConfiguredKey(value)) {
    throw new AiProviderError(`AI provider is not configured. Set a valid ${name} on the backend.`, 503)
  }
  return value!.trim()
}

function outputText(data: any) {
  const text = Array.isArray(data?.output)
    ? data.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
      .filter((item: any) => item?.type === 'output_text' && typeof item.text === 'string')
      .map((item: any) => item.text)
      .join('')
    : ''
  if (!text.trim()) throw new AiProviderError('AI provider returned no text output.')
  return text
}

class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async responses(input: unknown, maxTokens: number) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, max_output_tokens: maxTokens, input }),
      })
      if (response.ok) return outputText(await response.json())

      const responseBody = await response.text()
      let providerCode = ''
      try {
        providerCode = String((JSON.parse(responseBody) as { error?: { code?: string } }).error?.code ?? '')
      } catch {
        // The provider may return a non-JSON gateway error.
      }

      const quotaExhausted = providerCode === 'insufficient_quota'
      if (response.status === 429 && !quotaExhausted && attempt === 0) {
        const retryAfterSeconds = Number(response.headers.get('retry-after') ?? '')
        const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(retryAfterSeconds * 1000, 5000)
          : 750
        await new Promise(resolve => setTimeout(resolve, delayMs))
        continue
      }

      if (response.status === 429) {
        const message = quotaExhausted
          ? 'OpenAI quota is exhausted. Check your OpenAI billing, usage limits, and API project.'
          : 'OpenAI rate limit reached. Wait a moment and try again, or check your usage limits.'
        throw new AiProviderError(message, 429)
      }
      throw new AiProviderError(`AI provider request failed (HTTP ${response.status}).`)
    }
    throw new AiProviderError('AI provider request failed after retrying.')
  }

  completeText(prompt: string, maxTokens = 1200) {
    return this.responses([{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], maxTokens)
  }

  analyzeImage(input: AiImageInput) {
    return this.responses([{
      role: 'user',
      content: [
        { type: 'input_image', image_url: `data:${input.mediaType};base64,${input.imageBase64}` },
        { type: 'input_text', text: input.prompt },
      ],
    }], input.maxTokens ?? 1200)
  }

  extractPdf(input: AiPdfInput) {
    return this.responses([{
      role: 'user',
      content: [
        { type: 'input_file', filename: input.filename ?? 'work-instruction.pdf', file_data: `data:application/pdf;base64,${input.pdfBase64}` },
        { type: 'input_text', text: input.prompt },
      ],
    }], input.maxTokens ?? 8000)
  }
}

class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const
  private readonly client: Anthropic

  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey })
  }

  private async message(content: any, maxTokens: number) {
    const response = await this.client.messages.create({ model: this.model, max_tokens: maxTokens, messages: [{ role: 'user', content }] })
    const text = response.content.find((item) => item.type === 'text')
    if (!text || text.type !== 'text') throw new AiProviderError('AI provider returned no text output.')
    return text.text
  }

  completeText(prompt: string, maxTokens = 1200) {
    return this.message(prompt, maxTokens)
  }

  analyzeImage(input: AiImageInput) {
    return this.message([
      { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 } },
      { type: 'text', text: input.prompt },
    ], input.maxTokens ?? 1200)
  }

  extractPdf(input: AiPdfInput) {
    return this.message([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.pdfBase64 } },
      { type: 'text', text: input.prompt },
    ], input.maxTokens ?? 8000)
  }
}

export function resolveAiProviderName(env: NodeJS.ProcessEnv = process.env): AiProviderName {
  const value = (env.AI_PROVIDER ?? 'anthropic').trim().toLowerCase()
  if (value !== 'anthropic' && value !== 'openai') {
    throw new AiProviderError(`Unsupported AI_PROVIDER "${value}". Use "anthropic" or "openai".`, 500)
  }
  return value
}

export function createAiProvider(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): AiProvider {
  const provider = resolveAiProviderName(env)
  if (provider === 'openai') return new OpenAiProvider(requiredKey(env, 'OPENAI_API_KEY'), env.OPENAI_MODEL?.trim() || 'gpt-4o', fetchImpl)
  return new AnthropicProvider(requiredKey(env, 'ANTHROPIC_API_KEY'), env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6')
}

export { AnthropicProvider, OpenAiProvider }
