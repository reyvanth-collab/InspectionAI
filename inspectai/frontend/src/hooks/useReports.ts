import { fetchPages } from '@/lib/pages'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'

export type ReportDays = '7' | '30' | '90' | '180' | '365'

export interface InspectionSummaryRow {
  work_order_id: string
  wo_number:       string
  asset_name:      string
  location:        string | null
  completed_at:    string | null
  inspector_name:  string | null
  wi_number:       string | null
  wi_title:        string | null
  overall_result:  string | null
  total_findings:  string
  pass_count:      string
  fail_count:      string
}

export interface WIComplianceRow {
  id: string
  wi_number:      string
  title:          string
  revision:       string
  status:         string
  effective_date: string | null
  expiry_date:    string | null
  owner_name:     string | null
  days_remaining: string | null
}

export interface DefectAnalysisRow {
  item_description: string
  category:         string
  fail_count:       string
  sample_notes:     string | null
}

export function useInspectionSummary(days: ReportDays) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['report-inspection-summary', user?.tenantId, user?.id, days],
    enabled:  !!user,
    queryFn:  async (): Promise<InspectionSummaryRow[]> => {
      return fetchPages<InspectionSummaryRow>(`/reports/inspection-summary?days=${days}`)
    },
  })
}

export function useWICompliance() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['report-wi-compliance', user?.tenantId, user?.id],
    enabled:  !!user,
    queryFn:  async (): Promise<WIComplianceRow[]> => {
      return fetchPages<WIComplianceRow>('/reports/wi-compliance')
    },
  })
}

export function useDefectAnalysis(days: ReportDays) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['report-defect-analysis', user?.tenantId, user?.id, days],
    enabled:  !!user,
    queryFn:  async (): Promise<DefectAnalysisRow[]> => {
      return fetchPages<DefectAnalysisRow>(`/reports/defect-analysis?days=${days}`)
    },
  })
}
