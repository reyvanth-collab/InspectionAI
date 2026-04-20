import { Link } from 'react-router-dom'
import { Sun, Moon, ChevronRight, Bell } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/cn'
import { useNotifications } from '@/hooks/useNotifications'

const ROLE_PILL: Record<string, string> = {
  admin:     'bg-red-500/10    text-red-400    ring-1 ring-red-500/20',
  approver:  'bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20',
  inspector: 'bg-blue-500/10   text-blue-400   ring-1 ring-blue-500/20',
  viewer:    'bg-bg-3          text-text-3     ring-1 ring-border-2',
}

interface TopNavProps {
  title?: string
  breadcrumb?: Array<{ label: string; path?: string }>
}

export function TopNav({ title, breadcrumb }: TopNavProps) {
  const { user, theme, toggleTheme } = useAuth()
  const { data: notifs = [] } = useNotifications()
  const unread = notifs.filter((n: { read: boolean }) => !n.read).length

  return (
    <header className="h-[52px] bg-bg border-b border-border flex items-center px-5 gap-3 flex-shrink-0 sticky top-0 z-[100]">

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {breadcrumb ? (
          breadcrumb.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <ChevronRight size={12} className="text-text-3 flex-shrink-0" />}
              {crumb.path && i < breadcrumb.length - 1 ? (
                <Link
                  to={crumb.path}
                  className="text-[13px] text-text-3 hover:text-text transition-colors truncate"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className={cn(
                  'text-[13px] truncate',
                  i === breadcrumb.length - 1 ? 'text-text font-medium' : 'text-text-3'
                )}>
                  {crumb.label}
                </span>
              )}
            </span>
          ))
        ) : (
          <span className="text-[13px] font-medium text-text">{title}</span>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 flex-shrink-0">

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-8 h-8 flex items-center justify-center rounded-[6px] text-text-3 hover:text-text hover:bg-bg-2 transition-all border-none bg-transparent cursor-pointer"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* Notifications bell */}
        <Link
          to="/notifications"
          className="relative w-8 h-8 flex items-center justify-center rounded-[6px] text-text-3 hover:text-text hover:bg-bg-2 transition-all"
        >
          <Bell size={15} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-danger rounded-full text-[8px] font-bold text-white flex items-center justify-center leading-none">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Link>

        {/* Divider */}
        <div className="w-px h-5 bg-border mx-1" />

        {/* Role pill */}
        {user && (
          <span className={cn(
            'text-[10px] font-semibold px-2 py-[3px] rounded-full uppercase tracking-[0.07em]',
            ROLE_PILL[user.role]
          )}>
            {user.role}
          </span>
        )}

        {/* Avatar + name */}
        {user && (
          <div className="flex items-center gap-2 pl-1">
            <div className="w-[26px] h-[26px] rounded-full bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
              {user.avatarInitials}
            </div>
            <span className="text-[12px] font-medium text-text hidden md:block">{user.name}</span>
          </div>
        )}
      </div>
    </header>
  )
}
