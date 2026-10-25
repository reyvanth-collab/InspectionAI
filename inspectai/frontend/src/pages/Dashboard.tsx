import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAuth } from '@/context/AuthContext'
import { useWorkOrders, useWorkOrderSummary } from '@/hooks/useWorkOrders'
import { useWorkInstructions } from '@/hooks/useWorkInstructions'
import { useNotifications } from '@/hooks/useNotifications'
import { useAuditLogs } from '@/hooks/useAuditLogs'
import { SkeletonCard, SkeletonTable, Skeleton } from '@/components/ui/Skeleton'
import { Bell, ClipboardCheck, FileWarning, Gauge, ShieldCheck } from 'lucide-react'
import type { WorkOrder, WOStatus, WOPriority } from '@/types'

const STATUS_BADGE: Record<WOStatus, 'open' | 'complete' | 'pending' | 'expiring'> = {
  'open': 'open', 'in-progress': 'expiring', 'complete': 'complete', 'cancelled': 'pending',
}
const PRIORITY_BADGE: Record<WOPriority, 'high' | 'medium' | 'low'> = {
  high: 'high', medium: 'medium', low: 'low', critical: 'high',
}

const TABLE_LABEL: Record<string, string> = {
  work_orders: 'Work Order', work_instructions: 'Work Instruction',
  inspection_records: 'Inspection', inspection_findings: 'Finding',
  approval_records: 'Approval', users: 'User',
}

function formatRelative(iso: string) {
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  < 1)  return 'just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

export default function Dashboard() {
  const { user }   = useAuth()
  const navigate   = useNavigate()

  const { data: woPage, isLoading: wosLoading }  = useWorkOrders()
  const { data: woSummary } = useWorkOrderSummary()
  const wos = woPage?.items ?? []
  const { data: wis   = [], isLoading: wisLoading }  = useWorkInstructions()
  const { data: notifs = [] }                        = useNotifications()
  const { data: logs  = [], isLoading: logsLoading } = useAuditLogs(5)

  const total    = woSummary?.total ?? 0
  const complete = woSummary?.complete ?? 0
  const expiring = wis.filter(w => w.daysRemaining >= 0 && w.daysRemaining <= 30).length
  const unread   = notifs.filter(n => !n.read).length
  const recent   = wos.slice(0, 5)

  const hour     = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard' }]}>
      <div className="premium-ring relative mb-6 overflow-hidden rounded-[16px] border border-border bg-[linear-gradient(135deg,rgba(104,167,255,0.18),rgba(64,224,208,0.08)_42%,rgba(255,209,102,0.06))] p-6 shadow-lg">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent-bd bg-accent-bg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
              <ShieldCheck size={13} />
              Live Inspection Command Center
            </div>
            <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.8px]">
              {greeting}, {user?.name.split(' ')[0]}
            </h1>
            <p className="mt-2 max-w-[680px] text-[14px] leading-6 text-text-2">
              Monitor work orders, controlled work instructions, exceptions, and approval readiness from one operational cockpit.
            </p>
          </div>
          <div className="grid min-w-[280px] grid-cols-2 gap-2">
            <div className="rounded-[12px] border border-border bg-bg-2/70 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.1em] text-text-3">Completion</p>
              <p className="mt-1 font-mono text-[22px] font-semibold text-success">{total ? Math.round((complete / total) * 100) : 0}%</p>
            </div>
            <div className="rounded-[12px] border border-border bg-bg-2/70 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.1em] text-text-3">Attention</p>
              <p className="mt-1 font-mono text-[22px] font-semibold text-warning">{expiring + unread}</p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-7">
        {wosLoading || wisLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard label="Total Work Orders" value={total}    sub="All statuses"     color="accent" Icon={ClipboardCheck} />
            <KpiCard label="Completed"         value={complete} sub="Inspections done" color="green"  Icon={ShieldCheck} />
            <KpiCard label="Expiring WIs"      value={expiring} sub="Within 30 days"   color="amber"  Icon={FileWarning} />
            <KpiCard label="Unread Alerts"     value={unread}   sub="Notifications"    color="red"    Icon={Bell} />
          </>
        )}
      </div>

      <div className="grid md:grid-cols-[1fr_300px] gap-5 items-start">
        {/* Work orders table */}
        <Card>
          <CardHeader actions={
            <button onClick={() => navigate('/inspections')}
              className="text-[12px] text-accent hover:underline bg-transparent border-none cursor-pointer">
              View all →
            </button>
          }>
            Recent Work Orders
          </CardHeader>
          {wosLoading ? (
            <SkeletonTable rows={5} />
          ) : recent.length === 0 ? (
            <CardBody><p className="text-[13px] text-text-3">No work orders yet.</p></CardBody>
          ) : (
            recent.map((wo: WorkOrder) => (
              <div key={wo.dbId}
                onClick={() => navigate(`/inspections/${wo.dbId}`)}
                className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-bg-3 cursor-pointer transition-colors">
                <span className="font-mono text-[12px] text-accent w-20 flex-shrink-0">{wo.id}</span>
                <span className="text-[13px] text-text flex-1 truncate">{wo.asset}</span>
                <span className="text-[11px] text-text-3 hidden md:block w-24 truncate">{wo.location}</span>
                <Badge variant={PRIORITY_BADGE[wo.priority]}>{wo.priority}</Badge>
                <Badge variant={STATUS_BADGE[wo.status]}>{wo.status}</Badge>
              </div>
            ))
          )}
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>Recent Activity</CardHeader>
          {logsLoading ? (
            <CardBody className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-2">
                  <Skeleton className="w-2 h-2 rounded-full mt-1 flex-shrink-0" />
                  <div className="flex-1 flex flex-col gap-1">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-2 w-24" />
                  </div>
                </div>
              ))}
            </CardBody>
          ) : logs.length === 0 ? (
            <CardBody><p className="text-[13px] text-text-3">No activity yet.</p></CardBody>
          ) : (
            <CardBody className="p-0">
              {logs.map((log, i) => (
                <div key={log.id}
                  className={`flex gap-3 px-4 py-3 ${i < logs.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="flex flex-col items-center pt-1 gap-1 flex-shrink-0">
                    <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-accent' : 'bg-border-2'}`} />
                    {i < logs.length - 1 && <div className="w-0.5 flex-1 bg-border min-h-[12px]" />}
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <p className="text-[12px] text-text">
                      <span className="font-medium">{log.action}</span>{' '}
                      <span className="text-text-3">{TABLE_LABEL[log.table_name] ?? log.table_name}</span>
                    </p>
                    <p className="text-[11px] text-text-3 mt-0.5">
                      {log.performed_by_name ?? 'System'} · {formatRelative(log.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </CardBody>
          )}
        </Card>
      </div>
    </AppLayout>
  )
}

// ── Mini KPI card inline component ──────────────────────────
const COLOR_MAP = {
  accent: { value: 'text-accent',  bg: 'bg-accent-bg'  },
  green:  { value: 'text-success', bg: 'bg-success-bg' },
  amber:  { value: 'text-warning', bg: 'bg-warning-bg' },
  red:    { value: 'text-danger',  bg: 'bg-danger-bg'  },
}

function KpiCard({ label, value, sub, color = 'accent', Icon = Gauge }: {
  label: string; value: number; sub: string; color?: keyof typeof COLOR_MAP; Icon?: typeof Gauge
}) {
  const c = COLOR_MAP[color]
  return (
    <div className="surface-panel premium-ring rounded-[14px] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold text-text-2 uppercase tracking-[0.09em]">{label}</p>
        <span className={`grid h-8 w-8 place-items-center rounded-[10px] ${c.bg} ${c.value}`}>
          <Icon size={16} />
        </span>
      </div>
      <p className={`font-mono text-[30px] font-bold leading-none tracking-[-1px] ${c.value}`}>{value}</p>
      <p className="mt-2 text-[11px] text-text-3">{sub}</p>
    </div>
  )
}
