import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TopNav } from './TopNav'
import { OfflineBanner } from '@/components/ui/OfflineBanner'

interface AppLayoutProps {
  children: ReactNode
  title?: string
  breadcrumb?: Array<{ label: string; path?: string }>
}

export function AppLayout({ children, title, breadcrumb }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopNav title={title} breadcrumb={breadcrumb} />
        <OfflineBanner />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1200px] mx-auto w-full px-6 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
