import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'

export interface QueueEntry {
  id:          string
  endpoint:    string                    // e.g. '/inspections/abc123/findings'
  method:      'POST' | 'PATCH' | 'PUT'
  body:        Record<string, unknown>
  enqueuedAt:  string
  label?:      string                    // human readable, shown in banner
}

const QUEUE_KEY = 'offline_api_queue'

function loadQueue(): QueueEntry[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') }
  catch { return [] }
}

function persistQueue(q: QueueEntry[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

interface OfflineCtx {
  isOnline:    boolean
  queueLength: number
  flushing:    boolean
  enqueue:     (entry: Omit<QueueEntry, 'id' | 'enqueuedAt'>) => void
}

const OfflineContext = createContext<OfflineCtx>({
  isOnline: true, queueLength: 0, flushing: false, enqueue: () => {},
})

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [isOnline,  setIsOnline]  = useState(() => navigator.onLine)
  const [queue,     setQueue]     = useState<QueueEntry[]>(loadQueue)
  const [flushing,  setFlushing]  = useState(false)
  const flushRef = useRef(false)

  useEffect(() => {
    const on  = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Flush queued requests when coming back online
  useEffect(() => {
    if (!isOnline || queue.length === 0 || flushRef.current) return
    flushRef.current = true
    setFlushing(true)

    const entries = [...queue]
    Promise.allSettled(
      entries.map(entry =>
        api.request({ method: entry.method, url: entry.endpoint, data: entry.body })
          .then(() => entry.id)
      )
    ).then(results => {
      const succeeded = new Set(
        results.flatMap((r, i) => r.status === 'fulfilled' ? [entries[i].id] : [])
      )
      setQueue(prev => {
        const next = prev.filter(e => !succeeded.has(e.id))
        persistQueue(next)
        return next
      })
    }).finally(() => {
      setFlushing(false)
      flushRef.current = false
    })
  }, [isOnline, queue])

  const enqueue = useCallback((entry: Omit<QueueEntry, 'id' | 'enqueuedAt'>) => {
    const full: QueueEntry = { ...entry, id: crypto.randomUUID(), enqueuedAt: new Date().toISOString() }
    setQueue(prev => {
      const next = [...prev, full]
      persistQueue(next)
      return next
    })
  }, [])

  return (
    <OfflineContext.Provider value={{ isOnline, queueLength: queue.length, flushing, enqueue }}>
      {children}
    </OfflineContext.Provider>
  )
}

export function useOffline() {
  return useContext(OfflineContext)
}
