import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/cn'

const ROLE_PILL: Record<string, string> = {
  admin:     'bg-danger-bg text-danger border border-danger-border',
  approver:  'bg-violet-bg text-violet border border-violet-border',
  inspector: 'bg-info-bg text-info border border-info-border',
  viewer:    'bg-bg-3 text-text-2 border border-border-2',
}

interface TopNavProps {
  title?: string
  breadcrumb?: Array<{ label: string; path?: string }>
}

export function TopNav({ title, breadcrumb }: TopNavProps) {
  const { user, theme, toggleTheme, logout } = useAuth()

  return (
    <header className="h-[52px] bg-bg-2 border-b border-border flex items-center px-5 gap-3 flex-shrink-0 sticky top-0 z-[100]">
      {/* Breadcrumb / title */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {breadcrumb ? (
          breadcrumb.map((crumb, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span className="text-text-3">/</span>}
              <span className={cn(
                'text-[13px]',
                i === breadcrumb.length - 1 ? 'text-text font-medium' : 'text-text-2'
              )}>
                {crumb.label}
              </span>
            </span>
          ))
        ) : (
          <span className="text-[13px] font-medium text-text">{title}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="px-[14px] py-[6px] bg-transparent border border-border-2 rounded-[6px] text-text-2 text-[12px] cursor-pointer hover:border-accent hover:text-accent transition-all duration-150"
        >
          {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
        </button>

        {/* Role pill */}
        {user && (
          <span className={cn('text-[10px] font-medium px-2 py-[2px] rounded-full', ROLE_PILL[user.role])}>
            {user.role}
          </span>
        )}

        {/* Avatar */}
        {user && (
          <div className="w-7 h-7 rounded-full bg-accent-2 flex items-center justify-center text-[11px] font-semibold text-white">
            {user.avatarInitials}
          </div>
        )}

        {/* Logout */}
        <button
          onClick={logout}
          className="px-[14px] py-[6px] bg-transparent border border-border-2 rounded-[6px] text-text-2 text-[12px] cursor-pointer hover:border-danger hover:text-danger transition-all duration-150"
        >
          Logout
        </button>
      </div>
    </header>
  )
}
