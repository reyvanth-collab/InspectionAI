import { validSignature } from './signature'
export interface DraftAnswer {
  result: 'pass' | 'fail' | 'na' | null
  value: string
  notes: string
  naReason?: string
  photos: string[]
}
export function validPhoto(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2800000) return false
  if (value.startsWith('data:image/png;')) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
    if (!m) return false
    const b = Buffer.from(m[1], 'base64')
    return (
      b.length >= 67 &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      b.includes(Buffer.from('IEND'))
    )
  }
  const m = /^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!m) return false
  const b = Buffer.from(m[2], 'base64')
  return m[1] === 'jpeg'
    ? b[0] === 255 && b[1] === 216 && b[b.length - 2] === 255 && b[b.length - 1] === 217
    : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
}
export function normalizeAnswers(input: unknown, ids: Set<string>): Record<string, DraftAnswer> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Draft answers must be an object')
  const output: Record<string, DraftAnswer> = {}
  for (const [id, v] of Object.entries(input)) {
    if (!ids.has(id) || !v || typeof v !== 'object') throw new Error('Unknown question in draft')
    const a = v as DraftAnswer
    if (
      ![null, 'pass', 'fail', 'na'].includes(a.result) ||
      typeof a.value !== 'string' ||
      typeof a.notes !== 'string' ||
      a.value.length > 2800000 ||
      a.notes.length > 10000 ||
      (a.naReason !== undefined && (typeof a.naReason !== 'string' || a.naReason.length > 10000)) ||
      !Array.isArray(a.photos) ||
      a.photos.length > 10 ||
      a.photos.some((p) => !validPhoto(p))
    )
      throw new Error('Invalid response or photo for question ' + id)
    if (a.value.length > 10000 && !validSignature(a.value))
      throw new Error('Response exceeds size limit for question ' + id)
    output[id] = {
      result: a.result,
      value: a.value,
      notes: a.notes,
      naReason: a.naReason || '',
      photos: [...new Set(a.photos)],
    }
  }
  if (JSON.stringify(output).length > 25000000) throw new Error('Draft exceeds size limit')
  return output
}
