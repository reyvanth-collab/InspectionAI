import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { OfflineProvider } from '@/context/OfflineContext'
import { ToastProvider } from '@/components/ui/Toast'
import type { ReactNode } from 'react'

// Pages
import Login         from '@/pages/Login'
import Dashboard     from '@/pages/Dashboard'
import Inspections   from '@/pages/Inspections'
import MasterLibrary from '@/pages/MasterLibrary'
import Approvals     from '@/pages/Approvals'
import Analytics     from '@/pages/Analytics'
import Reports       from '@/pages/Reports'
import Notifications      from '@/pages/Notifications'
import Settings           from '@/pages/Settings'
import InspectionExecution from '@/pages/InspectionExecution'
import WIDetail            from '@/pages/WIDetail'
import WIBuilder           from '@/pages/WIBuilder'
import MOMSAnalytics       from '@/pages/MOMSAnalytics'
import AuditTrail          from '@/pages/AuditTrail'

// Shows nothing while Supabase restores the session — prevents redirect flicker.
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return <FullScreenSpinner />
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return <FullScreenSpinner />
  return !isAuthenticated ? <>{children}</> : <Navigate to="/dashboard" replace />
}

function FullScreenSpinner() {
  return (
    <div className="fixed inset-0 bg-bg flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-[13px] text-text-2">Loading…</p>
      </div>
    </div>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />

      <Route path="/dashboard"     element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/inspections"    element={<ProtectedRoute><Inspections /></ProtectedRoute>} />
      <Route path="/inspections/:id" element={<ProtectedRoute><InspectionExecution /></ProtectedRoute>} />
      <Route path="/library"            element={<ProtectedRoute><MasterLibrary /></ProtectedRoute>} />
      <Route path="/library/new"        element={<ProtectedRoute><WIBuilder /></ProtectedRoute>} />
      <Route path="/library/:id/edit"   element={<ProtectedRoute><WIBuilder /></ProtectedRoute>} />
      <Route path="/library/:id"        element={<ProtectedRoute><WIDetail /></ProtectedRoute>} />
      <Route path="/approvals"     element={<ProtectedRoute><Approvals /></ProtectedRoute>} />
      <Route path="/analytics"     element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
      <Route path="/moms"          element={<ProtectedRoute><MOMSAnalytics /></ProtectedRoute>} />
      <Route path="/reports"       element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      <Route path="/audit-trail"   element={<ProtectedRoute><AuditTrail /></ProtectedRoute>} />
      <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
      <Route path="/settings"      element={<ProtectedRoute><Settings /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <OfflineProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </OfflineProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
