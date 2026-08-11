import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

export interface AuditLog {
  id:                  string
  action:              string
  table_name:          string
  entity_id:           string | null
  severity:            'info' | 'warning' | 'critical' | null
  detail:              Record<string, unknown> | null
  wi_id:               string | null
  wi_number:           string | null
  wi_title:            string | null
  wi_revision:         string | null
  wi_status:           string | null
  performed_by_name:   string | null
  created_at:          string
  // legacy compat
  users?:              { name: string } | null
  performed_by?:       string | null
}

export function useAuditLogs(limit = 5, tableFilter?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['audit-logs', limit, tableFilter],
    enabled:  !!user,
    queryFn:  async (): Promise<AuditLog[]> => {
      const params = new URLSearchParams({ limit: String(limit) })
      if (tableFilter) params.set('table', tableFilter)
      const res = await api.get<{ data: AuditLog[] }>(`/analytics/audit-logs?${params}`)
      return res.data.data
    },
  })
}
