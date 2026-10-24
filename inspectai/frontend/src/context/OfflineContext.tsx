import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
interface OfflineState { isOnline: boolean; queueLength: number; flushing: boolean; enqueue: (entry: unknown) => void }
const OfflineContext = createContext<OfflineState>({ isOnline: true, queueLength: 0, flushing: false, enqueue: () => { throw new Error('Offline submission is unavailable') } })
export function OfflineProvider({ children }: { children: ReactNode }) {
  const [isOnline, setOnline] = useState(() => navigator.onLine)
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) } }, [])
  // Legacy queue remains untouched for manual recovery; it is never replayed under another identity.
  return <OfflineContext.Provider value={{ isOnline, queueLength: 0, flushing: false, enqueue: () => { throw new Error('Reconnect before saving. Offline submission is disabled in this release.') } }}>{children}</OfflineContext.Provider>
}
export const useOffline = () => useContext(OfflineContext)
