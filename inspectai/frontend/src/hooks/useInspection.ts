import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

// ── Fetch or create an inspection record for a work order ───
export function useInspectionRecord(workOrderDbId: string) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['inspection-record', workOrderDbId],
    enabled:  !!user && !!workOrderDbId,
    queryFn:  async () => {
      // Return the most recent non-complete record, or null
      const { data, error } = await supabase
        .from('inspection_records')
        .select(`
          *,
          inspection_findings (
            id, result, notes, photo_urls,
            ai_root_cause, ai_failure_class, ai_failure_code, ai_recommended_action,
            checklist_item_id
          )
        `)
        .eq('work_order_id', workOrderDbId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw new Error(error.message)
      return data
    },
  })
}

export function useStartInspection() {
  const qc = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({
      workOrderDbId, totalItems,
    }: { workOrderDbId: string; totalItems: number }) => {
      // Mark WO as in_progress
      await supabase
        .from('work_orders')
        .update({ status: 'in_progress' })
        .eq('id', workOrderDbId)

      const { data, error } = await supabase
        .from('inspection_records')
        .insert({
          work_order_id: workOrderDbId,
          inspector_id:  user!.id,
          total_items:   totalItems,
        })
        .select()
        .single()

      if (error) throw new Error(error.message)
      return data
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
      inspectionRecordId,
      checklistItemId,
      result,
      notes,
    }: {
      inspectionRecordId: string
      checklistItemId:    string
      result:             'pass' | 'fail' | 'na'
      notes?:             string
    }) => {
      // Upsert the finding
      const { data, error } = await supabase
        .from('inspection_findings')
        .upsert(
          {
            inspection_record_id: inspectionRecordId,
            checklist_item_id:    checklistItemId,
            result,
            notes,
          },
          { onConflict: 'inspection_record_id,checklist_item_id' }
        )
        .select()
        .single()

      if (error) throw new Error(error.message)

      // Recount pass/fail on the parent record
      const { data: counts } = await supabase
        .from('inspection_findings')
        .select('result')
        .eq('inspection_record_id', inspectionRecordId)

      if (counts) {
        const passed = counts.filter(c => c.result === 'pass').length
        const failed = counts.filter(c => c.result === 'fail').length
        const na     = counts.filter(c => c.result === 'na').length
        await supabase
          .from('inspection_records')
          .update({ passed_items: passed, failed_items: failed, na_items: na })
          .eq('id', inspectionRecordId)
      }

      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspection-record'] })
    },
  })
}

export function useCompleteInspection() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      inspectionRecordId, workOrderDbId, overallResult,
    }: {
      inspectionRecordId: string
      workOrderDbId:      string
      overallResult:      'pass' | 'fail'
    }) => {
      const now = new Date().toISOString()

      await supabase
        .from('inspection_records')
        .update({ overall_result: overallResult, completed_at: now })
        .eq('id', inspectionRecordId)

      await supabase
        .from('work_orders')
        .update({ status: 'complete', completed_at: now })
        .eq('id', workOrderDbId)
    },
    onSuccess: (_data, { workOrderDbId }) => {
      qc.invalidateQueries({ queryKey: ['inspection-record', workOrderDbId] })
      qc.invalidateQueries({ queryKey: ['work-orders'] })
    },
  })
}
