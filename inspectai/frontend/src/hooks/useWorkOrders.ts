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
  checklist_item_count?: number | string | null
}

function toWorkOrder(row: DBWorkOrderRow): WorkOrder {
  return {
    id:         row.wo_number,
    asset:      row.asset_name,
    location:   row.location ?? '',
    type:       row.type ?? '',
    priority:   row.priority as WorkOrder['priority'],
    status:     row.status.replace('_', '-') as WorkOrder['status'],
    assignedTo: row.assigned_to_name ?? '-',
    dueDate:    row.due_date ?? '',
    wiRef:      row.wi_number ?? '-',
    checklistItemCount: Number(row.checklist_item_count ?? 0),
    dbId:       row.id,
  }
}

export interface WorkOrderPage {
  items: WorkOrder[]
  page: number
  pageSize: number
  hasMore: boolean
}

export function useWorkOrders(statusFilter?: string, page = 1) {
  const { user } = useAuth()
  return useQuery({
    queryKey:        ['work-orders', statusFilter],
    enabled:         !!user,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter.replace('-', '_'))
      params.set('page', String(page))
      params.set('pageSize', '50')
      const res = await api.get<{ data: DBWorkOrderRow[]; meta?: { page: number; pageSize: number; hasMore: boolean } }>(`/inspections?${params}`)
      return {
        items: res.data.data.map(toWorkOrder),
        page: res.data.meta?.page ?? page,
        pageSize: res.data.meta?.pageSize ?? 50,
        hasMore: res.data.meta?.hasMore ?? false,
      } satisfies WorkOrderPage
    },
  })
}

export function useWorkOrderSummary() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['work-orders-summary'],
    enabled: !!user,
    queryFn: async () => {
      const res = await api.get<{ data: Record<string, number | string> }>('/inspections/summary')
      return Object.fromEntries(Object.entries(res.data.data).map(([key, value]) => [key, Number(value ?? 0)])) as {
        total: number; open: number; in_progress: number; complete: number; pending: number
      }
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-orders'] })
      qc.invalidateQueries({ queryKey: ['work-orders-summary'] })
    },
  })
}

export function useAssignWorkInstruction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dbId, workInstructionId }: { dbId: string; workInstructionId: string }) => {
      const res = await api.patch<{ data: Record<string, unknown> }>(`/inspections/${dbId}/work-instruction`, { workInstructionId })
      return res.data.data
    },
    onSuccess: (_data, { dbId }) => {
      qc.invalidateQueries({ queryKey: ['work-orders'] })
      qc.invalidateQueries({ queryKey: ['work-order', dbId] })
      qc.invalidateQueries({ queryKey: ['inspection-record', dbId] })
    },
  })
}

export interface CreateWorkOrderInput {
  assetId:            string
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
        assetId:            input.assetId,
        priority:           input.priority,
        dueDate:            input.dueDate || null,
        assignedTo:         input.assignedTo || null,
        workInstructionId:  input.workInstructionId || null,
        notes:              input.notes || null,
      })
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-orders'] })
      qc.invalidateQueries({ queryKey: ['work-orders-summary'] })
    },
  })
}
