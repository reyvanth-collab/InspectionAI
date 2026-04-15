import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { useAuth } from '@/context/AuthContext'
import type { UserRole } from '@/types'

interface NavItem {
  path: string
  label: string
  icon: string
  roles?: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard',      label: 'Dashboard',       icon: '⬛' },
  { path: '/inspections',    label: 'Inspections',     icon: '✅' },
  { path: '/library',        label: 'Master Library',  icon: '📚' },
  { path: '/approvals',      label: 'Approvals',       icon: '🔏', roles: ['admin', 'approver'] },
  { path: '/analytics',      label: 'Analytics',       icon: '📊' },
  { path: '/reports',        label: 'Reports',         icon: '📄' },
  { path: '/notifications',  label: 'Notifications',   icon: '🔔' },
  { path: '/settings',       label: 'Settings',        icon: '⚙️',  roles: ['admin'] },
]

export function Sidebar() {
  const { user } = useAuth()

  const visibleItems = NAV_ITEMS.filter(item =>
    !item.roles || (user && item.roles.includes(user.role))
  )

  return (
    <aside className="w-[220px] bg-bg-2 border-r border-border flex flex-col flex-shrink-0 h-screen sticky top-0">
      {/* Logo */}
      <div className="h-[52px] flex items-center px-5 gap-2 border-b border-border flex-shrink-0">
        <div className="w-6 h-6 rounded-[6px] bg-accent flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M7 1L2 4v6l5 3 5-3V4L7 1z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
            <circle cx="7" cy="7" r="2" fill="white"/>
          </svg>
        </div>
        <span className="text-[15px] font-semibold tracking-[-0.3px]">
          Inspect<span className="text-accent">AI</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {visibleItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-4 py-[9px] text-[13px] transition-all duration-150 mx-2 rounded-[6px] mb-0.5',
                isActive
                  ? 'bg-accent-bg text-accent font-medium'
                  : 'text-text-2 hover:text-text hover:bg-bg-3'
              )
            }
          >
            <span className="text-base leading-none w-4 text-center">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      {user && (
        <div className="border-t border-border px-4 py-3 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-accent-2 flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0">
            {user.avatarInitials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-text truncate">{user.name}</p>
            <p className="text-[11px] text-text-3 truncate">{user.staffId}</p>
          </div>
        </div>
      )}
    </aside>
  )
}
