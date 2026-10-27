/** Only fixed identifiers from this map can reach SQL. */
export function listOrder(
  query: Record<string, unknown>,
  columns: Record<string, string>,
  fallback: string,
  tie: string,
) {
  const column = columns[String(query.sort)] || columns[fallback]
  return `${column} ${query.direction === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, ${tie} ASC`
}
