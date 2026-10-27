import type { ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Sidebar } from './Sidebar'
import { TopNav } from './TopNav'
import { OfflineBanner } from '@/components/ui/OfflineBanner'

interface AppLayoutProps {
  children: ReactNode
  title?: string
  breadcrumb?: Array<{ label: string; path?: string }>
}

export function AppLayout({ children, title, breadcrumb }: AppLayoutProps) {
  const { user } = useAuth()
  return (
    <div className="flex h-screen overflow-hidden bg-bg page-shell">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopNav title={title} breadcrumb={breadcrumb} />
        <OfflineBanner />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1240px] mx-auto w-full px-6 py-6">
            {user?.tenantName && <section aria-label="Current workspace" className="rounded-lg border border-border bg-bg-2 px-4 py-3 mb-5 text-sm">
              <p className="break-words"><span className="text-text-2">Workspace: </span><strong>{user.tenantName}</strong></p>
              <p className="text-xs text-text-2 mt-1">Records are limited to this workspace and your authorised departments.</p>
            </section>}
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
