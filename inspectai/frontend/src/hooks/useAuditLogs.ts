import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

export interface AuditLog {
  id: string
  action: string
  table_name: string
  performed_by: string | null
  created_at: string
  users: { name: string } | null
}

export function useAuditLogs(limit = 5, tableName?: string) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['audit-logs', limit, tableName],
    enabled:  !!user,
    queryFn:  async (): Promise<AuditLog[]> => {
      let query = supabase
        .from('audit_logs')
        .select('id, action, table_name, performed_by, created_at, users(name)')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (tableName) {
        query = query.eq('table_name', tableName)
      }

      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as AuditLog[]
    },
  })
}
