import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { Notification } from '@/types'

interface DBNotification {
  id: string
  title: string
  message: string
  severity: string
  read: boolean
  entity_type: string | null
  entity_id: string | null
  created_at: string
}

function toNotification(row: DBNotification): Notification {
  return {
    id:         row.id,
    title:      row.title,
    message:    row.message,
    severity:   row.severity as Notification['severity'],
    createdAt:  new Date(row.created_at).toLocaleString('en-SG', { hour12: false }).slice(0, 16),
    read:       row.read,
  }
}

export function useNotifications() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['notifications'],
    enabled:  !!user,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw new Error(error.message)
      return (data as DBNotification[]).map(toNotification)
    },
    // Refetch every 30s for near-real-time feel
    refetchInterval: 30_000,
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('read', false)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useMarkRead() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
