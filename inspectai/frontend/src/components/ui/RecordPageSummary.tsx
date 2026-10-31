export function RecordPageSummary({
  page,
  pageSize,
  count,
  total,
  label,
}: {
  page: number
  pageSize: number
  count: number
  total: number
  label: string
}) {
  const first = count ? (page - 1) * pageSize + 1 : 0
  const last = count ? first + count - 1 : 0
  return (
    <span className="text-sm text-text-2 text-center" aria-live="polite">
      Page {page} of {Math.max(1, Math.ceil(total / pageSize))} · Showing {first}–{last} of {total}{' '}
      matching {label}
    </span>
  )
}
