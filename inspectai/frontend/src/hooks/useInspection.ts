import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

export interface InspectionFinding {
  id: string
  result: 'pass' | 'fail' | 'na' | null
  notes: string | null
  photo_urls: string[] | null
  ai_root_cause: string | null
  ai_failure_class: string | null
  ai_failure_code: string | null
  ai_recommended_action: string | null
  ai_validation_status: 'aligned' | 'review_required' | 'uncertain' | null
  ai_validation_confidence: string | number | null
  ai_validation_reason: string | null
  ai_validation_recommended_result: 'pass' | 'fail' | 'na' | 'keep' | null
  ai_validation_evidence: {
    evidence?: string[]
    riskLevel?: 'low' | 'medium' | 'high'
    requiredAction?: string
    model?: string
    promptVersion?: string
  } | null
  checklist_item_id: string
}

export interface InspectionRecord {
  id: string
  work_order_id: string
  inspector_id: string
  started_at: string
  completed_at: string | null
  total_items: number
  passed_items: number
  failed_items: number
  na_items: number
  overall_result: 'pass' | 'fail' | 'na' | null
  signature_data_url?: string | null
  signature_hash?: string | null
  inspection_findings: InspectionFinding[]
}

export function useInspectionRecord(workOrderDbId: string) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['inspection-record', workOrderDbId],
    enabled:  !!user && !!workOrderDbId,
    queryFn:  async () => {
      const res = await api.get<{ data: InspectionRecord | null }>(`/inspections/${workOrderDbId}/record`)
      return res.data.data
    },
  })
}

export function useStartInspection() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workOrderDbId, totalItems,
    }: { workOrderDbId: string; totalItems: number }) => {
      const res = await api.post<{ data: InspectionRecord }>(`/inspections/${workOrderDbId}/start`, { totalItems })
      return res.data.data
    },
    onSuccess: (_data, { workOrderDbId }) => {
      qc.invalidateQueries({ queryKey: ['inspection-record', workOrderDbId] })
      qc.invalidateQueries({ queryKey: ['work-orders'] })
    },
  })
}

export function useRecordFinding() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workOrderDbId,
      inspectionRecordId,
      checklistItemId,
      result,
      notes,
    }: {
      workOrderDbId: string
      inspectionRecordId: string
      checklistItemId:    string
      result:             'pass' | 'fail' | 'na'
      notes?:             string
    }) => {
      const res = await api.post<{ data: InspectionFinding }>(`/inspections/${workOrderDbId}/findings`, {
        inspectionRecordId,
        checklistItemId,
        result,
        notes,
      })
      return res.data.data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['inspection-record', vars.workOrderDbId] })
    },
  })
}

export function useAttachFindingPhoto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workOrderDbId,
      inspectionRecordId,
      checklistItemId,
      imageDataUrl,
    }: {
      workOrderDbId: string
      inspectionRecordId: string
      checklistItemId: string
      imageDataUrl: string
    }) => {
      const res = await api.post<{ data: InspectionFinding }>(`/inspections/${workOrderDbId}/findings/photo`, {
        inspectionRecordId,
        checklistItemId,
        imageDataUrl,
      })
      return res.data.data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['inspection-record', vars.workOrderDbId] })
    },
  })
}

export function useCompleteInspection() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      inspectionRecordId, workOrderDbId, signatureDataUrl,
    }: {
      inspectionRecordId: string
      workOrderDbId:      string
      signatureDataUrl:   string
    }) => {
      const res = await api.post<{
        data: {
          success: boolean
          overallResult: 'pass' | 'fail'
          passed: number
          failed: number
          na: number
          signatureHash: string
        }
      }>(`/inspections/${workOrderDbId}/complete`, { inspectionRecordId, signatureDataUrl })
      return res.data.data
    },
    onSuccess: (_data, { workOrderDbId }) => {
      qc.invalidateQueries({ queryKey: ['inspection-record', workOrderDbId] })
      qc.invalidateQueries({ queryKey: ['work-orders'] })
    },
  })
}
