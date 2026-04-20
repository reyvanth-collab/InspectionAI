import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { WorkOrder } from '@/types'

interface DBWorkOrder {
  id: string
  wo_number: string
  asset_name: string
  location: string | null
  type: string | null
  priority: string
  status: string
  due_date: string | null
  users: { name: string } | null
  work_instructions: { wi_number: string; title: string } | null
}

function toWorkOrder(row: DBWorkOrder): WorkOrder {
  return {
    id:         row.wo_number,
    asset:      row.asset_name,
    location:   row.location ?? '',
    type:       row.type ?? '',
    priority:   row.priority as WorkOrder['priority'],
    status:     row.status.replace('_', '-') as WorkOrder['status'],
    assignedTo: row.users?.name ?? '—',
    dueDate:    row.due_date ?? '',
    wiRef:      row.work_instructions?.wi_number ?? '—',
    dbId:       row.id,
  }
}

export function useWorkOrders(statusFilter?: string) {
  const { user } = useAuth()

  return useQuery({
    queryKey:        ['work-orders', statusFilter],
    enabled:         !!user,
    placeholderData: keepPreviousData,   // keeps old rows visible while new filter loads
    queryFn: async () => {
      let query = supabase
        .from('work_orders')
        .select('id, wo_number, asset_name, location, type, priority, status, due_date, users(name), work_instructions(wi_number, title)')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(100)

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter.replace('-', '_'))
      }

      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data as unknown as DBWorkOrder[]).map(toWorkOrder)
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
          id, wo_number, asset_name, location, type, priority, status, due_date, notes,
          users ( name, email, staff_id ),
          work_instructions (
            id, wi_number, title, revision, category,
            wi_checklist_items ( id, item_no, description, acceptance_criteria, sort_order, field_type, required, placeholder, options_json, unit, min_value, max_value, conditional_json )
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

export interface CreateWorkOrderInput {
  assetName:          string
  location:           string
  priority:           string
  dueDate:            string
  assignedTo:         string
  workInstructionId?: string
  notes?:             string
}

export function useCreateWorkOrder() {
  const qc       = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (input: CreateWorkOrderInput) => {
      const [{ count }, ] = await Promise.all([
        supabase.from('work_orders').select('id', { count: 'exact', head: true }),
      ])
      const woNumber = `WO-${String((count ?? 0) + 1).padStart(4, '0')}`

      const { data, error } = await supabase
        .from('work_orders')
        .insert({
          wo_number:           woNumber,
          tenant_id:           user?.tenantId || undefined,
          asset_name:          input.assetName,
          location:            input.location,
          priority:            input.priority,
          due_date:            input.dueDate || null,
          assigned_to:         input.assignedTo || null,
          work_instruction_id: input.workInstructionId || null,
          notes:               input.notes || null,
          status:              'open',
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-orders'] }),
  })
}
