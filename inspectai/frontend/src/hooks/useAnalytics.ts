import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

export type DateRange = '30' | '90' | '180' | '365'

export interface CategoryStat {
  label: string
  pass: number
  fail: number
}

export interface AnalyticsSummary {
  byCategory:       CategoryStat[]
  totalPass:        number
  totalFail:        number
  totalInspections: number
}

export function useAnalytics(range: DateRange) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['analytics', range],
    enabled:  !!user,
    queryFn:  async (): Promise<AnalyticsSummary> => {
      const [summaryRes, categoryRes] = await Promise.all([
        api.get<{ data: { pass: number; fail: number; totalInspections: number } }>(`/analytics/summary?days=${range}`),
        api.get<{ data: { category: string; pass: string; fail: string }[] }>(`/analytics/by-category?days=${range}`),
      ])

      const { pass, fail, totalInspections } = summaryRes.data.data

      const byCategory: CategoryStat[] = categoryRes.data.data.map(row => ({
        label: row.category,
        pass:  parseInt(String(row.pass)),
        fail:  parseInt(String(row.fail)),
      }))

      return { byCategory, totalPass: pass, totalFail: fail, totalInspections }
    },
  })
}
