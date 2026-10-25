// Measure the same read-only workflow against local and staging deployments.
// Provide BENCH_BASE_URL, BENCH_EMAIL and BENCH_PASSWORD as environment variables.
const baseUrl = (process.env.BENCH_BASE_URL || '').replace(/\/$/, '')
const email = process.env.BENCH_EMAIL
const password = process.env.BENCH_PASSWORD
const samples = Number(process.env.BENCH_SAMPLES || 20)

if (!/^https?:\/\//.test(baseUrl) || !email || !password || !Number.isInteger(samples) || samples < 3 || samples > 100) {
  console.error('Set BENCH_BASE_URL, BENCH_EMAIL and BENCH_PASSWORD; BENCH_SAMPLES must be 3–100 (default 20).')
  process.exit(2)
}

async function request(path, options = {}) {
  const started = performance.now()
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: { ...options.headers, 'cache-control': 'no-cache' },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 120)}`)
  return { ms: performance.now() - started, body }
}

const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
const token = JSON.parse(login.body).token
if (!token) throw new Error('Login did not return an application token')
const auth = { authorization: `Bearer ${token}` }

const paths = [
  '/api/ready',
  '/api/auth/me',
  '/api/analytics/summary',
  '/api/inspections?limit=25',
  '/api/work-instructions?limit=25',
  '/api/reports/inspection-summary?days=30',
]

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1])
}

const results = []
for (const path of paths) {
  // Warm the connection and query plan before recording steady-state latency.
  await request(path, { headers: auth })
  const durations = []
  for (let i = 0; i < samples; i++) {
    durations.push((await request(path, { headers: auth })).ms)
  }
  results.push({ path, samples, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95), maxMs: Math.round(Math.max(...durations)) })
}

console.log(JSON.stringify({ baseUrl, loginMs: Math.round(login.ms), results }, null, 2))
