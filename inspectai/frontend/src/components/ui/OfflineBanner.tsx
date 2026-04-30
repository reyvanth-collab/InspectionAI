import { useOffline } from '@/context/OfflineContext'

export function OfflineBanner() {
  const { isOnline, queueLength, flushing } = useOffline()

  if (isOnline && queueLength === 0) return null

  if (!isOnline) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-2 bg-warning-bg border-b border-warning-border text-warning text-[12px] font-medium">
        <span className="w-2 h-2 rounded-full bg-warning flex-shrink-0 animate-pulse" />
        <span>
          You are offline — results are saved locally and will sync when reconnected.
          {queueLength > 0 && <span className="ml-1.5 opacity-70">({queueLength} pending)</span>}
        </span>
      </div>
    )
  }

  // Back online, still flushing or has pending items
  return (
    <div className="flex items-center gap-2.5 px-4 py-2 bg-success-bg border-b border-success-border text-success text-[12px] font-medium">
      {flushing
        ? <>
            <span className="w-3 h-3 border border-success border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <span>Back online — syncing {queueLength} saved result{queueLength !== 1 ? 's' : ''}…</span>
          </>
        : <>
            <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
            <span>Back online — all results synced.</span>
          </>
      }
    </div>
  )
}
