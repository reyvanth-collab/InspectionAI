import { api } from './api'
export async function fetchPages<T>(url: string): Promise<T[]> {
 const rows: T[] = []
 for (let page = 1; page <= 100; page++) {
  const response = await api.get<{ data: T[]; meta: { hasMore: boolean } }>(`${url}${url.includes('?') ? '&' : '?'}page=${page}`)
  rows.push(...response.data.data)
  if (!response.data.meta?.hasMore) return rows
 }
 throw new Error('Result exceeds 20,000 rows. Narrow the search or date range.')
}
