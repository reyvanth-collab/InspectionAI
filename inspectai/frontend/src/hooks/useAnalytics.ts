import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

export type DateRange = '30' | '90' | '180' | '365'

export interface CategoryStat {
  label: string
  pass: number
  fail: number
}

export interface AnalyticsSummary {
  byCategory: CategoryStat[]
  totalPass: number
  totalFail: number
  totalInspections: number  // unique inspection records
}

export function useAnalytics(range: DateRange) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['analytics', range],
    enabled:  !!user,
    queryFn:  async (): Promise<AnalyticsSummary> => {
      const since = new Date()
      since.setDate(since.getDate() - parseInt(range))
      const sinceISO = since.toISOString()

      // Pull findings joined through inspection_records (for date filter)
      // and wi_checklist_items (for category)
      const { data, error } = await supabase
        .from('inspection_findings')
        .select(`
          result,
          wi_checklist_items ( category ),
          inspection_records!inner ( started_at )
        `)
        .gte('inspection_records.started_at', sinceISO)
        .in('result', ['pass', 'fail'])

      if (error) throw new Error(error.message)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data ?? []) as any[]

      // Aggregate by category
      const map = new Map<string, { pass: number; fail: number }>()
      let totalPass = 0
      let totalFail = 0

      for (const row of rows) {
        const category: string = row.wi_checklist_items?.category ?? 'General'
        const result: string   = row.result

        if (!map.has(category)) map.set(category, { pass: 0, fail: 0 })
        const entry = map.get(category)!

        if (result === 'pass') { entry.pass++; totalPass++ }
        else if (result === 'fail') { entry.fail++; totalFail++ }
      }

      const byCategory: CategoryStat[] = Array.from(map.entries())
        .map(([label, counts]) => ({ label, ...counts }))
        .sort((a, b) => (b.pass + b.fail) - (a.pass + a.fail))

      // Count distinct inspection records in range
      const { count } = await supabase
        .from('inspection_records')
        .select('id', { count: 'exact', head: true })
        .gte('started_at', sinceISO)

      return {
        byCategory,
        totalPass,
        totalFail,
        totalInspections: count ?? 0,
      }
    },
  })
}
