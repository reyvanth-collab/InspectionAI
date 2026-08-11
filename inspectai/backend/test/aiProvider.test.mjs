import assert from 'node:assert/strict'
import { createAiProvider, resolveAiProviderName, AiProviderError } from '../dist/lib/ai/provider.js'

assert.equal(resolveAiProviderName({ AI_PROVIDER: 'openai' }), 'openai')
assert.equal(resolveAiProviderName({ AI_PROVIDER: 'anthropic' }), 'anthropic')
assert.equal(resolveAiProviderName({}), 'anthropic')
assert.throws(() => resolveAiProviderName({ AI_PROVIDER: 'gemini' }), /Unsupported AI_PROVIDER/)
assert.throws(() => createAiProvider({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'your-openai-api-key' }), (error) => {
  assert.ok(error instanceof AiProviderError)
  assert.equal(error.statusCode, 503)
  return /OPENAI_API_KEY/.test(error.message)
})

let request
const fakeFetch = async (url, options) => {
  request = { url, options }
  return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'provider response' }] }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const provider = createAiProvider({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'test-model' }, fakeFetch)
assert.equal(provider.name, 'openai')
assert.equal(provider.model, 'test-model')
assert.equal(await provider.completeText('hello', 55), 'provider response')
assert.equal(request.url, 'https://api.openai.com/v1/responses')
const body = JSON.parse(request.options.body)
assert.equal(body.model, 'test-model')
assert.equal(body.max_output_tokens, 55)
assert.equal(body.input[0].content[0].type, 'input_text')
assert.equal(request.options.headers.Authorization, 'Bearer sk-test')

await provider.analyzeImage({ imageBase64: 'abc', mediaType: 'image/png', prompt: 'inspect', maxTokens: 10 })
const imageBody = JSON.parse(request.options.body)
assert.equal(imageBody.input[0].content[0].type, 'input_image')
assert.match(imageBody.input[0].content[0].image_url, /^data:image\/png;base64,abc$/)

await provider.extractPdf({ pdfBase64: 'pdf', prompt: 'extract', maxTokens: 20 })
const pdfBody = JSON.parse(request.options.body)
assert.equal(pdfBody.input[0].content[0].type, 'input_file')
assert.match(pdfBody.input[0].content[0].file_data, /^data:application\/pdf;base64,pdf$/)

const failingProvider = createAiProvider({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }, async () => new Response('{}', { status: 401 }))
await assert.rejects(() => failingProvider.completeText('hello'), /HTTP 401/)

let rateLimitCalls = 0
const quotaProvider = createAiProvider({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }, async () => {
  rateLimitCalls += 1
  return new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 })
})
await assert.rejects(() => quotaProvider.completeText('hello'), /quota is exhausted/)
assert.equal(rateLimitCalls, 1)

console.log('AI provider tests passed')
