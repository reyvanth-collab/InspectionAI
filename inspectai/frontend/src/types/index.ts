// ── Auth ────────────────────────────────────────────────────
export type UserRole = 'admin' | 'approver' | 'inspector' | 'viewer'

export interface User {
  id: string
  tenantId: string
  name: string
  email: string
  staffId: string
  role: UserRole
  avatarInitials: string
  avatarUrl?: string
}

// ── Work Instructions ────────────────────────────────────────
export type WIStatus = 'active' | 'expiring' | 'expired' | 'draft' | 'pending_approval' | 'superseded'

export interface WorkInstruction {
  id: string        // wi_number e.g. "WI-EL-042"
  dbId: string      // uuid from DB
  title: string
  revision: string
  status: WIStatus
  owner: string
  effectiveDate: string
  expiryDate: string
  daysRemaining: number
  checklistItems: ChecklistItem[]
}

export interface ChecklistItem {
  id: string
  no: string
  description: string
  acceptanceCriteria: string
  result?: 'pass' | 'fail' | null
  notes?: string
  failureCode?: string
}

// ── Work Orders / Inspections ────────────────────────────────
export type WOStatus = 'open' | 'in-progress' | 'complete' | 'pending'
export type WOPriority = 'high' | 'medium' | 'low' | 'critical'

export interface WorkOrder {
  id: string        // wo_number e.g. "WO-2401"
  dbId: string      // uuid from DB — used for mutations
  asset: string
  location: string
  type: string
  priority: WOPriority
  status: WOStatus
  assignedTo: string
  dueDate: string
  wiRef: string
  progress?: number
}

// ── Approvals ────────────────────────────────────────────────
export type ApprovalStepStatus = 'done' | 'active' | 'wait' | 'rejected'

export interface ApprovalStep {
  id: number
  label: string
  approver: string
  status: ApprovalStepStatus
  completedAt?: string
  comment?: string
}

export interface ApprovalRecord {
  id: string
  wiTitle: string
  wiRevision: string
  submittedAt: string
  submittedBy: string
  currentStep: number
  steps: ApprovalStep[]
}

// ── Notifications ────────────────────────────────────────────
export type NotifSeverity = 'critical' | 'warning' | 'info' | 'success'

export interface Notification {
  id: string
  title: string
  message: string
  severity: NotifSeverity
  createdAt: string
  read: boolean
}

// ── Analytics ────────────────────────────────────────────────
export interface AnalyticsKPI {
  label: string
  value: number | string
  unit?: string
  trend?: 'up' | 'down' | 'flat'
  color?: 'green' | 'red' | 'amber' | 'accent'
}

export interface BarDataPoint {
  label: string
  value: number
  color?: string
}

// ── API helpers ──────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T
  error?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}
