import { NavLink } from 'react-router-dom'
import { ClipboardCheck, BookOpen, Boxes, BarChart3, Settings, LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { can } from '@/lib/permissions'
import { cn } from '@/lib/cn'
export function Sidebar() {
  const { user, logout } = useAuth()
  const links = [
    {
      path: '/inspections',
      label: can(user, 'inspector') && !can(user, 'viewer') ? 'My inspections' : 'Inspections',
      Icon: ClipboardCheck,
    },
    { path: '/library', label: 'Inspection Forms', Icon: BookOpen },
    { path: '/assets', label: 'Assets', Icon: Boxes },
    { path: '/reports', label: 'Reports', Icon: BarChart3 },
    ...(can(user, 'administrator')
      ? [{ path: '/settings', label: 'Settings', Icon: Settings }]
      : []),
  ]
  return (
    <aside className="app-sidebar bg-bg-2 border-border">
      <NavLink to="/inspections" className="sidebar-brand text-xl font-semibold tracking-tight">
        Inspection<span className="text-accent">AI</span>
      </NavLink>
      <nav aria-label="Main navigation" className="sidebar-links">
        {links.map(({ path, label, Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              cn(
                'nav-item',
                isActive ? 'bg-accent-bg text-accent font-semibold' : 'text-text-2 hover:bg-bg-3',
              )
            }
          >
            <Icon size={19} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-account border-t border-border">
        <p className="text-sm font-semibold truncate">{user?.name}</p>
        <p className="text-xs text-text-2 mt-1 truncate">{user?.email}</p>
        <button onClick={logout} className="flex items-center gap-2 text-sm text-text-2 mt-5">
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
