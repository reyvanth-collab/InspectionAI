const baseUrl = process.env.LOAD_TEST_URL ?? 'http://localhost:4000/api/health'
const token = process.env.LOAD_TEST_TOKEN
const concurrency = Math.min(100, Math.max(1, Number(process.env.LOAD_TEST_CONCURRENCY ?? 20)))
const requests = Math.min(10_000, Math.max(concurrency, Number(process.env.LOAD_TEST_REQUESTS ?? 500)))

const headers = token ? { Authorization: `Bearer ${token}` } : {}
let completed = 0
let failed = 0
let nextRequest = 0
const startedAt = performance.now()

async function worker() {
  while (true) {
    const requestNumber = nextRequest++
    if (requestNumber >= requests) return
    if (token) headers.Authorization = `Bearer ${token}`
    try {
      const response = await fetch(baseUrl, { headers })
      if (!response.ok) failed += 1
      else completed += 1
    } catch {
      failed += 1
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker))
const durationSeconds = (performance.now() - startedAt) / 1000
console.log(JSON.stringify({ baseUrl, requests, concurrency, completed, failed, durationSeconds, requestsPerSecond: requests / durationSeconds }, null, 2))
if (failed > 0) process.exitCode = 1
