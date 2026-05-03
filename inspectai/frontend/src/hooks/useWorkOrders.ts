import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { WorkOrder } from '@/types'

interface DBWorkOrderRow {
  id:               string
  wo_number:        string
  asset_name:       string
  location:         string | null
  type:             string | null
  priority:         string
  status:           string
  due_date:         string | null
  assigned_to_name: string | null
  wi_number:        string | null
  wi_title:         string | null
}

function toWorkOrder(row: DBWorkOrderRow): WorkOrder {
  return {
    id:         row.wo_number,
    asset:      row.asset_name,
    location:   row.location ?? '',
    type:       row.type ?? '',
    priority:   row.priority as WorkOrder['priority'],
    status:     row.status.replace('_', '-') as WorkOrder['status'],
    assignedTo: row.assigned_to_name ?? '—',
    dueDate:    row.due_date ?? '',
    wiRef:      row.wi_number ?? '—',
    dbId:       row.id,
  }
}

export function useWorkOrders(statusFilter?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey:        ['work-orders', statusFilter],
    enabled:         !!user,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = statusFilter && statusFilter !== 'all'
        ? `?status=${encodeURIComponent(statusFilter.replace('-', '_'))}`
        : ''
      const res = await api.get<{ data: DBWorkOrderRow[] }>(`/inspections${params}`)
      return res.data.data.map(toWorkOrder)
    },
  })
}

export function useWorkOrder(dbId: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['work-order', dbId],
    enabled:  !!user && !!dbId,
    queryFn:  async () => {
      const res = await api.get<{ data: Record<string, unknown> }>(`/inspections/${dbId}`)
      const d = res.data.data
      return {
        ...d,
        work_instructions: d.wi_number ? {
          wi_number:        d.wi_number,
          title:            d.wi_title,
          revision:         d.revision,
          wi_checklist_items: d.checklist_items ?? [],
        } : null,
      }
    },
  })
}

export function useUpdateWorkOrderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dbId, status }: { dbId: string; status: string }) => {
      await api.patch(`/inspections/${dbId}/status`, { status })
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateWorkOrderInput) => {
      const res = await api.post<{ data: Record<string, unknown> }>('/inspections', {
        assetName:          input.assetName,
        location:           input.location,
        priority:           input.priority,
        dueDate:            input.dueDate || null,
        assignedTo:         input.assignedTo || null,
        workInstructionId:  input.workInstructionId || null,
        notes:              input.notes || null,
      })
      return res.data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-orders'] }),
  })
}
