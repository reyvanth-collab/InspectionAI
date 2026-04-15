import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardBody } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { useNotifications, useMarkAllRead } from '@/hooks/useNotifications'
import type { NotifSeverity } from '@/types'

const SEVERITY_STYLES: Record<NotifSeverity, { icon: string; bg: string; dot: string }> = {
  critical: { icon: '🔴', bg: 'bg-danger-bg',  dot: 'bg-danger'  },
  warning:  { icon: '🟡', bg: 'bg-warning-bg', dot: 'bg-warning' },
  success:  { icon: '🟢', bg: 'bg-success-bg', dot: 'bg-success' },
  info:     { icon: '🔵', bg: 'bg-accent-bg',  dot: 'bg-accent'  },
}

type FilterSeverity = NotifSeverity | 'all'
import { useState } from 'react'

export default function Notifications() {
  const [filter, setFilter]       = useState<FilterSeverity>('all')
  const { data: notifs = [], isLoading } = useNotifications()
  const markAll = useMarkAllRead()

  const filtered  = filter === 'all' ? notifs : notifs.filter(n => n.severity === filter)
  const unread    = notifs.filter(n => !n.read).length

  return (
    <AppLayout breadcrumb={[{ label: 'Notifications' }]}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Notifications</h1>
          <p className="text-[13px] text-text-2 mt-1">System alerts, expiry warnings and escalation events</p>
        </div>
        {unread > 0 && (
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="text-[12px] text-accent hover:underline bg-transparent border-none cursor-pointer disabled:opacity-50"
          >
            Mark all as read ({unread})
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Unread"   value={unread}                                                    color="accent" />
        <StatCard label="Critical" value={notifs.filter(n => n.severity === 'critical').length}      color="red"    />
        <StatCard label="Warnings" value={notifs.filter(n => n.severity === 'warning').length}       color="amber"  />
        <StatCard label="Total"    value={notifs.length} />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', 'critical', 'warning', 'info', 'success'] as FilterSeverity[]).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-[6px] text-[12px] border transition-all ${
              filter === s
                ? 'bg-accent-bg border-accent-bd text-accent'
                : 'bg-transparent border-border-2 text-text-2 hover:border-accent hover:text-accent'
            }`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <Card>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="p-4 flex flex-col gap-3">
              {[1,2,3].map(i => <div key={i} className="h-14 rounded shimmer" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-[13px] text-text-3">No notifications</div>
          ) : filtered.map(n => {
            const style = SEVERITY_STYLES[n.severity]
            return (
              <div key={n.id}
                className={`flex items-start gap-3 px-4 py-[14px] border-b border-border last:border-0 transition-colors hover:bg-bg-3 ${!n.read ? 'bg-bg-3/50' : ''}`}>
                <div className={`w-8 h-8 rounded-[8px] ${style.bg} flex items-center justify-center text-[14px] flex-shrink-0`}>
                  {style.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {!n.read && <span className={`w-1.5 h-1.5 rounded-full ${style.dot} flex-shrink-0`} />}
                    <p className="text-[13px] font-medium text-text">{n.title}</p>
                  </div>
                  <p className="text-[12px] text-text-2 mt-0.5">{n.message}</p>
                </div>
                <span className="text-[11px] text-text-3 whitespace-nowrap font-mono">{n.createdAt}</span>
              </div>
            )
          })}
        </CardBody>
      </Card>
    </AppLayout>
  )
}
