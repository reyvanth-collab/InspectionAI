import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { StatCard } from '@/components/ui/StatCard'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Table } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { useAuth } from '@/context/AuthContext'
import { useWorkOrders } from '@/hooks/useWorkOrders'
import { useWorkInstructions } from '@/hooks/useWorkInstructions'
import { useNotifications } from '@/hooks/useNotifications'
import { useAuditLogs } from '@/hooks/useAuditLogs'
import type { WorkOrder, WOStatus, WOPriority } from '@/types'

const STATUS_MAP: Record<WOStatus, 'open' | 'complete' | 'pending' | 'expiring'> = {
  'open': 'open', 'in-progress': 'expiring', 'complete': 'complete', 'pending': 'pending',
}
const PRIORITY_MAP: Record<WOPriority, 'high' | 'medium' | 'low'> = {
  high: 'high', medium: 'medium', low: 'low', critical: 'high',
}

const columns = [
  { key: 'id',         header: 'WO #',      render: (r: WorkOrder) => <span className="font-mono text-[12px] text-accent">{r.id}</span> },
  { key: 'asset',      header: 'Asset' },
  { key: 'location',   header: 'Location' },
  { key: 'priority',   header: 'Priority',  render: (r: WorkOrder) => <Badge variant={PRIORITY_MAP[r.priority]}>{r.priority}</Badge> },
  { key: 'status',     header: 'Status',    render: (r: WorkOrder) => <Badge variant={STATUS_MAP[r.status]}>{r.status}</Badge> },
  { key: 'assignedTo', header: 'Inspector' },
  { key: 'dueDate',    header: 'Due',       render: (r: WorkOrder) => <span className="font-mono text-[12px] text-text-2">{r.dueDate}</span> },
]

// Friendly names for audit log table names
const TABLE_LABEL: Record<string, string> = {
  work_orders:        'Work Order',
  work_instructions:  'Work Instruction',
  inspection_records: 'Inspection',
  inspection_findings:'Finding',
  approval_records:   'Approval',
  users:              'User',
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  < 1)   return 'just now'
  if (mins  < 60)  return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  return `${days}d ago`
}

export default function Dashboard() {
  const { user }    = useAuth()
  const navigate    = useNavigate()

  const { data: wos   = [], isLoading: wosLoading }    = useWorkOrders()
  const { data: wis   = [], isLoading: wisLoading }    = useWorkInstructions()
  const { data: notifs = [] }                          = useNotifications()
  const { data: logs  = [], isLoading: logsLoading }   = useAuditLogs(5)

  const total      = wos.length
  const complete   = wos.filter(w => w.status === 'complete').length
  const expiring   = wis.filter(w => w.daysRemaining >= 0 && w.daysRemaining <= 30).length
  const unread     = notifs.filter(n => !n.read).length

  const recent = wos.slice(0, 5)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard' }]}>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px]">
          {greeting}, {user?.name.split(' ')[0]}
        </h1>
        <p className="text-[13px] text-text-2 mt-1">Here's your inspection overview for today.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-7">
        <StatCard
          label="Total Work Orders"
          value={wosLoading ? '—' : total}
          sub="All statuses"
          color="accent"
        />
        <StatCard
          label="Completed"
          value={wosLoading ? '—' : complete}
          sub="Inspections closed"
          color="green"
        />
        <StatCard
          label="Expiring WIs"
          value={wisLoading ? '—' : expiring}
          sub="Within 30 days"
          color="amber"
        />
        <StatCard
          label="Unread Alerts"
          value={unread}
          sub="Notifications"
          color="red"
        />
      </div>

      <div className="grid md:grid-cols-[1fr_320px] gap-5 items-start">
        {/* Work orders table */}
        <Card>
          <CardHeader actions={
            <button
              onClick={() => navigate('/inspections')}
              className="text-[12px] text-accent hover:underline bg-transparent border-none cursor-pointer"
            >
              View all →
            </button>
          }>
            Active Work Orders
          </CardHeader>
          <CardBody className="p-0">
            {wosLoading ? (
              <div className="p-6 flex flex-col gap-3">
                {[1, 2, 3].map(i => <div key={i} className="h-8 rounded shimmer" />)}
              </div>
            ) : (
              <Table
                columns={columns}
                rows={recent}
                onRowClick={row => navigate(`/inspections/${row.dbId}`)}
                emptyMessage="No work orders found"
              />
            )}
          </CardBody>
        </Card>

        {/* Audit log */}
        <Card>
          <CardHeader>Recent Activity</CardHeader>
          <CardBody className="p-0">
            {logsLoading ? (
              <div className="p-4 flex flex-col gap-3">
                {[1, 2, 3].map(i => <div key={i} className="h-10 rounded shimmer" />)}
              </div>
            ) : logs.length === 0 ? (
              <div className="px-[18px] py-4 text-[13px] text-text-3">No activity yet.</div>
            ) : (
              logs.map((log, i) => (
                <div
                  key={log.id}
                  className={`flex gap-3 px-[18px] py-3 ${i < logs.length - 1 ? 'border-b border-border' : ''}`}
                >
                  {/* Timeline dot */}
                  <div className="flex flex-col items-center pt-1 gap-1 flex-shrink-0">
                    <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-accent' : 'bg-border-2'}`} />
                    {i < logs.length - 1 && (
                      <div className="w-0.5 flex-1 bg-border min-h-[12px]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <p className="text-[12px] text-text">
                      <span className="font-medium">{log.action}</span>
                      {' '}
                      <span className="text-text-3">
                        {TABLE_LABEL[log.table_name] ?? log.table_name}
                      </span>
                    </p>
                    <p className="text-[11px] text-text-3 mt-0.5">
                      {log.users?.name ?? 'System'} · {formatRelative(log.created_at)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>
    </AppLayout>
  )
}
