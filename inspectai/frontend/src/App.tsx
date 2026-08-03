import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { OfflineProvider } from '@/context/OfflineContext'
import { ToastProvider } from '@/components/ui/Toast'
import type { ReactNode } from 'react'

// Pages
const Login = lazy(() => import('@/pages/Login'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Assets = lazy(() => import('@/pages/Assets'))
const Inspections = lazy(() => import('@/pages/Inspections'))
const MasterLibrary = lazy(() => import('@/pages/MasterLibrary'))
const Approvals = lazy(() => import('@/pages/Approvals'))
const Analytics = lazy(() => import('@/pages/Analytics'))
const Reports = lazy(() => import('@/pages/Reports'))
const Notifications = lazy(() => import('@/pages/Notifications'))
const Settings = lazy(() => import('@/pages/Settings'))
const InspectionExecution = lazy(() => import('@/pages/InspectionExecution'))
const WIDetail = lazy(() => import('@/pages/WIDetail'))
const WIBuilder = lazy(() => import('@/pages/WIBuilder'))
const MOMSAnalytics = lazy(() => import('@/pages/MOMSAnalytics'))
const AuditTrail = lazy(() => import('@/pages/AuditTrail'))

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
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />

      <Route path="/dashboard"     element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/assets"        element={<ProtectedRoute><Assets /></ProtectedRoute>} />
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
    </Suspense>
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
