import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { Notification } from '@/types'

interface DBNotification {
  id: string; title: string; message: string; severity: string; read: boolean; created_at: string
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
    queryKey:        ['notifications'],
    enabled:         !!user,
    refetchInterval: 2 * 60 * 1000,
    queryFn: async () => {
      const res = await api.get<{ data: DBNotification[] }>('/notifications')
      return res.data.data.map(toNotification)
    },
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => { await api.patch('/notifications/read-all') },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['notifications'] })
      const prev = qc.getQueryData<Notification[]>(['notifications'])
      qc.setQueryData<Notification[]>(['notifications'], old => old?.map(n => ({ ...n, read: true })) ?? [])
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['notifications'], ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => { await api.patch(`/notifications/${id}/read`) },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['notifications'] })
      const prev = qc.getQueryData<Notification[]>(['notifications'])
      qc.setQueryData<Notification[]>(['notifications'], old => old?.map(n => n.id === id ? { ...n, read: true } : n) ?? [])
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['notifications'], ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
