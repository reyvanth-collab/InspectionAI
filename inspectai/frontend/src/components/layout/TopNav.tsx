import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Sun,
  Moon,
  ChevronRight,
  Bell,
  UserRound,
  KeyRound,
  UsersRound,
  Settings,
  LogOut,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/cn'
import { useNotifications } from '@/hooks/useNotifications'
import { can } from '@/lib/permissions'

const ROLE_PILL: Record<string, string> = {
  admin: 'bg-red-500/10    text-red-400    ring-1 ring-red-500/20',
  approver: 'bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20',
  inspector: 'bg-blue-500/10   text-blue-400   ring-1 ring-blue-500/20',
  viewer: 'bg-bg-3          text-text-3     ring-1 ring-border-2',
}

interface TopNavProps {
  title?: string
  breadcrumb?: Array<{ label: string; path?: string }>
}

export function TopNav({ title, breadcrumb }: TopNavProps) {
  const { user, theme, toggleTheme, logout } = useAuth()
  const { data: notifs = [] } = useNotifications()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const unread = notifs.filter((n: { read: boolean }) => !n.read).length

  useEffect(() => {
    if (!userMenuOpen) return
    const close = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [userMenuOpen])

  return (
    <header className="h-[64px] bg-bg-2/82 border-b border-border flex items-center px-6 gap-3 flex-shrink-0 sticky top-0 z-[100] backdrop-blur-xl">
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
                <span
                  className={cn(
                    'text-[13px] truncate',
                    i === breadcrumb.length - 1 ? 'text-text font-medium' : 'text-text-3',
                  )}
                >
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
          className="w-9 h-9 flex items-center justify-center rounded-[9px] text-text-3 hover:text-text hover:bg-bg-3 transition-all border border-transparent hover:border-border cursor-pointer"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* Notifications bell */}
        <Link
          to="/notifications"
          className="relative w-9 h-9 flex items-center justify-center rounded-[9px] text-text-3 hover:text-text hover:bg-bg-3 transition-all border border-transparent hover:border-border"
        >
          <Bell size={15} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-danger rounded-full text-[8px] font-bold text-white flex items-center justify-center leading-none ring-2 ring-bg-2">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Link>

        {/* Divider */}
        <div className="w-px h-5 bg-border mx-1" />

        {/* Role pill */}
        {user && (
          <span
            className={cn(
              'text-[10px] font-semibold px-2 py-[3px] rounded-full uppercase tracking-[0.07em]',
              ROLE_PILL[user.role],
              'text-accent bg-accent-bg',
            )}
          >
            {can(user, 'administrator')
              ? 'Administrator'
              : can(user, 'form_author') && can(user, 'form_approver')
                ? 'Author / reviewer'
                : can(user, 'form_author')
                  ? 'Form author'
                  : can(user, 'form_approver')
                    ? 'Form reviewer'
                    : user.role}
          </span>
        )}

        {/* Avatar + name */}
        {user && (
          <div ref={userMenuRef} className="relative pl-1">
            <button
              onClick={() => setUserMenuOpen((open) => !open)}
              className="flex items-center gap-2 rounded-[10px] border border-border bg-bg-3/45 px-2 py-1.5 text-left transition-colors hover:border-accent-bd hover:bg-accent-bg"
            >
              <div className="w-[28px] h-[28px] rounded-full bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                {user.avatarInitials}
              </div>
              <span className="text-[12px] font-medium text-text hidden md:block">{user.name}</span>
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 top-[44px] z-[120] w-[240px] overflow-hidden rounded-[12px] border border-border bg-bg-2 shadow-lg backdrop-blur-xl">
                <div className="border-b border-border bg-bg-3/45 px-3 py-3">
                  <p className="truncate text-[13px] font-medium text-text">{user.name}</p>
                  <p className="truncate text-[11px] text-text-3">{user.email}</p>
                </div>
                <MenuLink
                  to="/settings?tab=profile"
                  icon={UserRound}
                  label="Profile"
                  onClick={() => setUserMenuOpen(false)}
                />
                <MenuLink
                  to="/settings?tab=password"
                  icon={KeyRound}
                  label="Change password"
                  onClick={() => setUserMenuOpen(false)}
                />
                {can(user, 'administrator') && (
                  <MenuLink
                    to="/settings?tab=users"
                    icon={UsersRound}
                    label="Users & Access"
                    onClick={() => setUserMenuOpen(false)}
                  />
                )}
                {can(user, 'administrator') && (
                  <MenuLink
                    to="/settings"
                    icon={Settings}
                    label="Settings"
                    onClick={() => setUserMenuOpen(false)}
                  />
                )}
                <button
                  onClick={() => {
                    setUserMenuOpen(false)
                    logout()
                  }}
                  className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-[12px] text-danger transition-colors hover:bg-danger-bg"
                >
                  <LogOut size={14} /> Logout
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}

function MenuLink({
  to,
  icon: Icon,
  label,
  onClick,
}: {
  to: string
  icon: typeof UserRound
  label: string
  onClick: () => void
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-text-2 transition-colors hover:bg-bg-3 hover:text-text"
    >
      <Icon size={14} /> {label}
    </Link>
  )
}
