import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

export type ReportDays = '7' | '30' | '90' | '180' | '365'

export interface InspectionSummaryRow {
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
    queryKey: ['report-inspection-summary', days],
    enabled:  !!user,
    queryFn:  async (): Promise<InspectionSummaryRow[]> => {
      const res = await api.get<{ data: InspectionSummaryRow[] }>(`/reports/inspection-summary?days=${days}`)
      return res.data.data
    },
  })
}

export function useWICompliance() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['report-wi-compliance'],
    enabled:  !!user,
    queryFn:  async (): Promise<WIComplianceRow[]> => {
      const res = await api.get<{ data: WIComplianceRow[] }>('/reports/wi-compliance')
      return res.data.data
    },
  })
}

export function useDefectAnalysis(days: ReportDays) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['report-defect-analysis', days],
    enabled:  !!user,
    queryFn:  async (): Promise<DefectAnalysisRow[]> => {
      const res = await api.get<{ data: DefectAnalysisRow[] }>(`/reports/defect-analysis?days=${days}`)
      return res.data.data
    },
  })
}
