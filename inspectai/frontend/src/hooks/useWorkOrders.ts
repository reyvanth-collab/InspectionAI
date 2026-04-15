import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { WorkOrder } from '@/types'

// ── Types matching the DB schema ────────────────────────────
interface DBWorkOrder {
  id: string
  wo_number: string
  work_instruction_id: string | null
  asset_name: string
  asset_id: string | null
  location: string | null
  type: string | null
  priority: string
  status: string
  assigned_to: string | null
  due_date: string | null
  completed_at: string | null
  notes: string | null
  created_at: string
  users: { name: string } | null
  work_instructions: { wi_number: string; title: string } | null
}

function toWorkOrder(row: DBWorkOrder): WorkOrder {
  return {
    id:          row.wo_number,
    asset:       row.asset_name,
    location:    row.location ?? '',
    type:        row.type ?? '',
    priority:    row.priority as WorkOrder['priority'],
    status:      row.status.replace('_', '-') as WorkOrder['status'],
    assignedTo:  row.users?.name ?? '—',
    dueDate:     row.due_date ?? '',
    wiRef:       row.work_instructions?.wi_number ?? '—',
    dbId:        row.id,
  }
}

export function useWorkOrders(statusFilter?: string) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['work-orders', statusFilter],
    enabled:  !!user,
    queryFn:  async () => {
      let query = supabase
        .from('work_orders')
        .select(`
          *,
          users ( name ),
          work_instructions ( wi_number, title )
        `)
        .order('due_date', { ascending: true })

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter.replace('-', '_'))
      }

      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data as DBWorkOrder[]).map(toWorkOrder)
    },
  })
}

export function useWorkOrder(dbId: string) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['work-order', dbId],
    enabled:  !!user && !!dbId,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select(`
          *,
          users ( name, email, staff_id ),
          work_instructions (
            id, wi_number, title, revision, category,
            wi_checklist_items ( id, item_no, description, acceptance_criteria, sort_order )
          )
        `)
        .eq('id', dbId)
        .single()

      if (error) throw new Error(error.message)
      return data
    },
  })
}

export function useUpdateWorkOrderStatus() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ dbId, status }: { dbId: string; status: string }) => {
      const { error } = await supabase
        .from('work_orders')
        .update({ status, ...(status === 'complete' ? { completed_at: new Date().toISOString() } : {}) })
        .eq('id', dbId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-orders'] }),
  })
}
