import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

export interface ApprovalStep {
  id:            string
  step_number:   number
  label:         string | null
  status:        string
  comment:       string | null
  completed_at:  string | null
  approver_id:   string
  approver_name: string | null
}

export interface Approval {
  id:                string
  wi_id:             string
  submitted_by:      string
  submitted_at:      string
  final_status:      string
  wi_number:         string
  wi_title:          string
  revision:          string
  submitted_by_name: string | null
  approval_steps:    ApprovalStep[]
}

export function useApprovals() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['approvals'],
    enabled:  !!user,
    queryFn: async (): Promise<Approval[]> => {
      const res = await api.get<{ data: Approval[] }>('/approvals')
      return res.data.data
    },
  })
}

export function useApproveStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ stepId, comment }: { stepId: string; comment?: string }) => {
      await api.patch(`/approvals/steps/${stepId}/approve`, { comment })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
  })
}

export function useRejectStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ stepId, comment }: { stepId: string; comment: string }) => {
      await api.patch(`/approvals/steps/${stepId}/reject`, { comment })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
  })
}
