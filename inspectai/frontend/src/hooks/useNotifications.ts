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
  created_at: string
}

function toNotification(row: DBNotification): Notification {
  return {
    id:        row.id,
    title:     row.title,
    message:   row.message,
    severity:  row.severity as Notification['severity'],
    createdAt: new Date(row.created_at).toLocaleString('en-SG', { hour12: false }).slice(0, 16),
    read:      row.read,
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
        .select('id, title, message, severity, read, created_at')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw new Error(error.message)
      return (data as DBNotification[]).map(toNotification)
    },
    refetchInterval: 2 * 60 * 1000,   // poll every 2 min, not 30s
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
    onMutate: async () => {
      // Optimistic update — mark all read in cache instantly
      await qc.cancelQueries({ queryKey: ['notifications'] })
      const prev = qc.getQueryData<Notification[]>(['notifications'])
      qc.setQueryData<Notification[]>(['notifications'],
        old => old?.map(n => ({ ...n, read: true })) ?? []
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notifications'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['notifications'] })
      const prev = qc.getQueryData<Notification[]>(['notifications'])
      qc.setQueryData<Notification[]>(['notifications'],
        old => old?.map(n => n.id === id ? { ...n, read: true } : n) ?? []
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notifications'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
