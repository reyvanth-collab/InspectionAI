export function validSignature(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500_000) return false
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[1].length % 4 !== 0) return false
  const bytes = Buffer.from(match[1], 'base64')
  return bytes.length >= 67 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.includes(Buffer.from('IHDR')) && bytes.includes(Buffer.from('IEND'))
}

/** Stable bytes survive PostgreSQL JSONB key ordering. */
export function canonicalJson(value: unknown): string {
 if (value === null || typeof value !== 'object') return JSON.stringify(value)
 if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
 const object = value as Record<string, unknown>
 return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(object[key])).join(',') + '}'
}
