import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

export function useApprovals() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['approvals'],
    enabled:  !!user,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('approval_records')
        .select(`
          *,
          work_instructions ( wi_number, title, revision ),
          submitter:users!approval_records_submitted_by_fkey ( name ),
          approval_steps (
            id, step_number, label, status, comment, completed_at,
            approver:users!approval_steps_approver_id_fkey ( name )
          )
        `)
        .order('submitted_at', { ascending: false })

      if (error) throw new Error(error.message)
      return data
    },
  })
}

export function useApproveStep() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      stepId, comment,
    }: { stepId: string; comment?: string }) => {
      const { error } = await supabase
        .from('approval_steps')
        .update({ status: 'done', comment, completed_at: new Date().toISOString() })
        .eq('id', stepId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
  })
}

export function useRejectStep() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      stepId, comment,
    }: { stepId: string; comment: string }) => {
      const { error } = await supabase
        .from('approval_steps')
        .update({ status: 'rejected', comment })
        .eq('id', stepId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
  })
}
