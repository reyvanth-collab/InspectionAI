import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

export interface MomsTopStep {
  section:   string
  step_no:   string | null
  step_desc: string | null
  total:     string
  nok_count: string
  nok_rate:  string
}

export interface MomsWiSummary {
  nokRate:          number   // overall NOK % for this WI
  totalInspections: number   // distinct work orders
  totalSteps:       number   // filled step count
  nokCount:         number
  topNokSteps:      MomsTopStep[]
}

/**
 * Fetches historical MOMS data for a given WI number.
 * Returns null when no MOMS data exists for this WI — callers should
 * treat null as "no historical data" rather than an error.
 */
export function useMomsWiSummary(wiNumber: string | null | undefined) {
  const { user } = useAuth()

  return useQuery<MomsWiSummary | null>({
    queryKey: ['moms-wi-summary', wiNumber],
    enabled:  !!user && !!wiNumber,
    staleTime: 1000 * 60 * 10,
    queryFn:  async (): Promise<MomsWiSummary | null> => {
      try {
        const r = await api.get<{ data: MomsWiSummary }>(`/moms/wi-summary/${encodeURIComponent(wiNumber!)}`)
        const d = r.data.data
        if (d.totalInspections === 0) return null
        return d
      } catch {
        return null
      }
    },
  })
}
