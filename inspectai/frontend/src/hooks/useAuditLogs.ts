import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

export interface AuditLog {
  id: string
  action: string
  table_name: string
  record_id: string | null
  performed_by: string | null
  created_at: string
  users: { name: string } | null
}

export function useAuditLogs(limit = 5) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['audit-logs', limit],
    enabled:  !!user,
    queryFn:  async (): Promise<AuditLog[]> => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, action, table_name, record_id, performed_by, created_at, users ( name )')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as AuditLog[]
    },
  })
}
