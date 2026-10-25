import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, ClipboardCheck, BookOpen, CheckSquare,
  BarChart2, TrendingUp, FileText, Shield, BookMarked, LogOut, Boxes,
  LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAuth } from '@/context/AuthContext'
import type { UserRole } from '@/types'

const ROLE_BADGE: Record<UserRole, { label: string; cls: string }> = {
  admin:     { label: 'Admin',     cls: 'bg-red-500/10    text-red-400    ring-1 ring-red-500/20'    },
  approver:  { label: 'Approver',  cls: 'bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20' },
  inspector: { label: 'Inspector', cls: 'bg-blue-500/10   text-blue-400   ring-1 ring-blue-500/20'   },
  viewer:    { label: 'Viewer',    cls: 'bg-bg-3          text-text-3     ring-1 ring-border-2'       },
}

interface NavItem {
  path:  string
  label: string
  Icon:  LucideIcon
  roles?: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard',     label: 'Dashboard',      Icon: LayoutDashboard },
  { path: '/assets',        label: 'Assets',         Icon: Boxes           },
  { path: '/inspections',   label: 'Inspections',    Icon: ClipboardCheck  },
  { path: '/library',       label: 'Master Library', Icon: BookOpen        },
  { path: '/approvals',     label: 'Approvals',      Icon: CheckSquare,    roles: ['admin', 'approver'] },
  { path: '/analytics',     label: 'Analytics',      Icon: BarChart2       },
  { path: '/moms',          label: 'MOMS Analytics', Icon: TrendingUp,     roles: ['admin', 'approver'] },
  { path: '/reports',       label: 'Reports',        Icon: FileText        },
  { path: '/audit-trail',   label: 'Audit Trail',    Icon: BookMarked,     roles: ['admin'] },
  { path: '/settings',      label: 'Settings',       Icon: Shield,         roles: ['admin'] },
]

export function Sidebar() {
  const { user, logout } = useAuth()

  const visibleItems = NAV_ITEMS.filter(item =>
    !item.roles || (user && item.roles.includes(user.role))
  )

  return (
    <aside className="w-sidebar flex flex-col flex-shrink-0 h-screen sticky top-0 border-r border-border bg-[linear-gradient(180deg,rgba(12,16,24,0.96),rgba(9,12,18,0.92))] shadow-lg backdrop-blur-xl">

      {/* Logo */}
      <div className="h-[64px] flex items-center px-5 gap-3 border-b border-border flex-shrink-0">
        <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center flex-shrink-0 shadow-[0_12px_26px_rgba(45,125,255,0.28)]">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1L2 4v6l5 3 5-3V4L7 1z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
            <circle cx="7" cy="7" r="1.8" fill="white"/>
          </svg>
        </div>
        <span className="text-[16px] font-semibold tracking-[-0.3px] text-text">
          Inspect<span className="text-accent">AI</span>
        </span>
        <span className="ml-auto text-[9px] font-mono text-text-3 bg-bg-3/80 border border-border px-1.5 py-0.5 rounded">
          v1.0
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        {/* Group label */}
        <p className="px-2 pt-2 pb-2 text-[9px] font-semibold text-text-3 uppercase tracking-[0.14em]">
          Workspace
        </p>

        {visibleItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-2.5 px-3 py-[9px] rounded-[9px] mb-1 text-[13px] transition-all duration-150',
                isActive
                  ? 'bg-gradient-to-r from-accent to-accent-2 text-white font-medium shadow-[0_12px_28px_rgba(45,125,255,0.24)]'
                  : 'text-text-3 hover:text-text hover:bg-white/[0.045]'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.Icon size={16} className={cn('flex-shrink-0', isActive ? 'text-white' : 'text-text-3 group-hover:text-text-2')} />
                <span className="leading-none">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      {user && (
        <div className="border-t border-border px-3 py-3 flex-shrink-0 bg-bg-2/35">
          <div className="flex items-center gap-2.5 mb-3 rounded-[10px] border border-border bg-bg-3/45 p-2">
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
              {user.avatarInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-text truncate leading-tight">{user.name}</p>
              <p className="text-[10px] text-text-3 font-mono truncate">{user.staffId || user.email}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={cn(
              'text-[9px] font-semibold px-2 py-[3px] rounded-full uppercase tracking-[0.08em]',
              ROLE_BADGE[user.role].cls
            )}>
              {ROLE_BADGE[user.role].label}
            </span>
            <button
              onClick={logout}
              className="flex items-center gap-1 text-[11px] text-text-3 hover:text-danger transition-colors bg-transparent border-none cursor-pointer p-0"
            >
              <LogOut size={11} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
