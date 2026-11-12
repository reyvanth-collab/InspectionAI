import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

export interface ApprovalStep {
  decided_by?: string | null
  decision_by_name?: string | null
  id: string
  step_number: number
  label: string | null
  status: string
  skipped: boolean
  group_rule: 'any' | 'all'
  stage_size: number
  eligible: boolean
  reassignments: Array<{ from: string; to: string; reason: string; at: string; by: string }>
  comment: string | null
  completed_at: string | null
  approver_id: string
  approver_name: string | null
}

export interface Approval {
  id: string
  wi_id: string
  submitted_by: string
  submitted_at: string
  final_status: string
  current_step: number
  stage_blocked: boolean
  submitted_snapshot?: { form: { title: string; revision: string } } | null
  workflow_version_id: string | null
  route_snapshot: { name?: string; workflowCode?: string; versionNumber?: number; route?: Array<{ type: string; stageName?: string; label?: string; reviewerName?: string; groupRule?: string; members?: Array<{ id: string; name: string }> }> } | null
  wi_number: string
  wi_title: string
  revision: string
  submitted_by_name: string | null
  approval_steps: ApprovalStep[]
}

export function useApprovals() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['approvals'],
    enabled: !!user,
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
