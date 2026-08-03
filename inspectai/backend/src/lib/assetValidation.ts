export const ASSET_STATUSES = new Set(['active', 'maintenance', 'retired'])
export const CRITICALITIES = new Set(['low', 'medium', 'high', 'critical'])

export function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateAssetDates(installDate: string, nextPmDate: string) {
  if (installDate && !isValidDate(installDate)) return 'Install date must be a valid date'
  if (nextPmDate && !isValidDate(nextPmDate)) return 'Next PM date must be a valid date'
  if (installDate && nextPmDate && nextPmDate < installDate) return 'Next PM date cannot be before install date'
  return null
}
