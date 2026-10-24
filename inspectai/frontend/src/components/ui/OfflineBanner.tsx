import { useOffline } from '@/context/OfflineContext'
export function OfflineBanner() {
 const { isOnline } = useOffline()
 return isOnline ? null : <div role="alert" className="fixed inset-0 z-[200] flex items-center justify-center bg-bg/95 p-8 text-center"><p>Connection lost. Reconnect to continue. Changes are not submitted while offline. Do not close this page until pending saves are confirmed.</p></div>
}
