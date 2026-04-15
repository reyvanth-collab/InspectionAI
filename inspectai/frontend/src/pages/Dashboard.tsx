import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { StatCard } from '@/components/ui/StatCard'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Table } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { useAuth } from '@/context/AuthContext'
import { useWorkOrders } from '@/hooks/useWorkOrders'
import { useNotifications } from '@/hooks/useNotifications'
import type { WorkOrder, WOStatus, WOPriority } from '@/types'

const STATUS_MAP: Record<WOStatus, 'open' | 'complete' | 'pending' | 'expiring'> = {
  'open': 'open', 'in-progress': 'expiring', 'complete': 'complete', 'pending': 'pending',
}
const PRIORITY_MAP: Record<WOPriority, 'high' | 'medium' | 'low'> = {
  high: 'high', medium: 'medium', low: 'low', critical: 'high',
}

const columns = [
  { key: 'id',         header: 'WO #',       render: (r: WorkOrder) => <span className="font-mono text-[12px] text-accent">{r.id}</span> },
  { key: 'asset',      header: 'Asset' },
  { key: 'location',   header: 'Location' },
  { key: 'priority',   header: 'Priority',   render: (r: WorkOrder) => <Badge variant={PRIORITY_MAP[r.priority]}>{r.priority}</Badge> },
  { key: 'status',     header: 'Status',     render: (r: WorkOrder) => <Badge variant={STATUS_MAP[r.status]}>{r.status}</Badge> },
  { key: 'assignedTo', header: 'Inspector' },
  { key: 'dueDate',    header: 'Due',        render: (r: WorkOrder) => <span className="font-mono text-[12px] text-text-2">{r.dueDate}</span> },
]

export default function Dashboard() {
  const { user }          = useAuth()
  const navigate          = useNavigate()
  const { data: wos = [], isLoading } = useWorkOrders()
  const { data: notifs = [] }         = useNotifications()

  const open       = wos.filter(w => w.status === 'open').length
  const inProgress = wos.filter(w => w.status === 'in-progress').length
  const complete   = wos.filter(w => w.status === 'complete').length
  const unread     = notifs.filter(n => !n.read).length

  // Show 5 most recent on dashboard
  const recent = wos.slice(0, 5)

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard' }]}>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px]">
          Good morning, {user?.name.split(' ')[0]} 👋
        </h1>
        <p className="text-[13px] text-text-2 mt-1">Here's your inspection overview for today.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-7">
        <StatCard label="Open Work Orders" value={isLoading ? '—' : open}       sub="Requires attention"  color="amber"  />
        <StatCard label="In Progress"      value={isLoading ? '—' : inProgress} sub="Active inspections"  color="accent" />
        <StatCard label="Completed"        value={isLoading ? '—' : complete}   sub="Inspections closed"  color="green"  />
        <StatCard label="Unread Alerts"    value={isLoading ? '—' : unread}     sub="Notifications"       color="red"    />
      </div>

      <Card>
        <CardHeader actions={
          <button onClick={() => navigate('/inspections')}
            className="text-[12px] text-accent hover:underline bg-transparent border-none cursor-pointer">
            View all →
          </button>
        }>
          Active Work Orders
        </CardHeader>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="p-6 flex flex-col gap-3">
              {[1,2,3].map(i => <div key={i} className="h-8 rounded shimmer" />)}
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
    </AppLayout>
  )
}
