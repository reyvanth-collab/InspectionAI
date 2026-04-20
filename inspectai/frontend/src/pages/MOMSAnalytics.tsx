import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { type LucideIcon, Search, Upload, TrendingDown, AlertTriangle, CheckCircle, Activity } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'

// ── Types ────────────────────────────────────────────────────────
interface WIOption { wi_number: string; wi_title: string | null; work_orders: number; earliest: string | null; latest: string | null }

interface Overview {
  total: string; ok_count: string; nok_count: string; na_count: string
  work_orders: string; stations: string; earliest: string | null; latest: string | null
}
interface StepRow    { section: string; step_no: string; step_desc: string; total: string; nok_count: string; nok_rate: string }
interface StationRow { station: string; total: string; nok_count: string; nok_rate: string }
interface TrendRow   { month: string; work_orders: string; nok_count: string; total: string }
interface Analytics  { overview: Overview; byStep: StepRow[]; byStation: StationRow[]; trend: TrendRow[] }

// ── Helpers ──────────────────────────────────────────────────────
function pct(n: number, d: number) { return d === 0 ? 0 : (n / d) * 100 }

function NokBadge({ rate }: { rate: number }) {
  const cls = rate >= 20 ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
            : rate >= 10  ? 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20'
            :               'bg-green-500/10 text-green-400 ring-1 ring-green-500/20'
  return <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full ${cls}`}>{rate.toFixed(1)}%</span>
}

function NokBar({ rate }: { rate: number }) {
  const color = rate >= 20 ? 'bg-red-500' : rate >= 10 ? 'bg-amber-500' : 'bg-green-500'
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full bg-bg-3 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className="text-[11px] font-mono w-9 text-right text-text-2 flex-shrink-0">{rate.toFixed(1)}%</span>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: LucideIcon
  label: string; value: string | number; sub?: string
  color?: 'green' | 'red' | 'amber' | 'blue' | 'default'
}) {
  const iconColor = color === 'red' ? 'text-red-400' : color === 'amber' ? 'text-amber-400'
    : color === 'green' ? 'text-green-400' : color === 'blue' ? 'text-blue-400' : 'text-text-3'
  const valColor = color === 'red' ? 'text-red-400' : color === 'amber' ? 'text-amber-400'
    : color === 'green' ? 'text-green-400' : 'text-text'
  return (
    <div className="bg-bg-2 border border-border rounded-[10px] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-text-3 font-medium uppercase tracking-[0.08em]">{label}</p>
        <Icon size={14} className={iconColor} />
      </div>
      <p className={`text-[26px] font-semibold font-mono leading-none ${valColor}`}>{value}</p>
      {sub && <p className="text-[11px] text-text-3 mt-1.5">{sub}</p>}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────
export default function MOMSAnalytics() {
  const qc      = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  // Search state
  const [wiNumber,  setWiNumber]  = useState('')
  const [fromDate,  setFromDate]  = useState('')
  const [toDate,    setToDate]    = useState('')
  const [searched,  setSearched]  = useState(false)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [dragging,  setDragging]  = useState(false)
  const [showImport, setShowImport] = useState(false)

  // WI number options from DB
  const { data: wiOptions = [], isLoading: wiLoading } = useQuery<WIOption[]>({
    queryKey: ['moms-wi-numbers'],
    queryFn: async () => {
      const r = await api.get<{ data: WIOption[] }>('/moms/wi-numbers')
      return r.data.data
    },
    staleTime: 1000 * 60 * 5,
  })

  // Analytics query — only runs when user has clicked Search
  const analyticsKey = ['moms-analytics', wiNumber, fromDate, toDate]
  const { data: analytics, isLoading: analyticsLoading, isFetching } = useQuery<Analytics>({
    queryKey: analyticsKey,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (fromDate) params.set('from_date', fromDate)
      if (toDate)   params.set('to_date',   toDate)
      const r = await api.get<{ data: Analytics }>(
        `/moms/analytics/${encodeURIComponent(wiNumber)}${params.toString() ? '?' + params : ''}`
      )
      return r.data.data
    },
    enabled: searched && !!wiNumber,
    staleTime: 1000 * 60 * 5,
  })

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api.post<{
        message: string
        data: { inserted: number; sheet: string; wiNumbers: string[]; workOrders: string[]; nokCount: number }
      }>('/moms/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      return r.data
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['moms-wi-numbers'] })
      const d = result.data
      setImportMsg({
        ok:   true,
        text: `Imported ${d.inserted.toLocaleString()} rows from sheet "${d.sheet}" · ${d.wiNumbers.length} WI(s) · ${d.workOrders.length} work orders · ${d.nokCount.toLocaleString()} NOK`,
      })
      if (d.wiNumbers.length === 1) setWiNumber(d.wiNumbers[0])
    },
    onError: (err: Error) => setImportMsg({ ok: false, text: err.message }),
  })

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.xlsx')) { setImportMsg({ ok: false, text: 'Please upload an .xlsx file' }); return }
    setImportMsg(null)
    importMutation.mutate(file)
  }, [importMutation])

  const handleSearch = () => {
    if (!wiNumber) return
    setSearched(true)
    qc.invalidateQueries({ queryKey: analyticsKey })
  }

  const ov = analytics?.overview
  const nokTotal   = parseInt(ov?.nok_count  || '0')
  const stepTotal  = parseInt(ov?.total      || '0')
  const okTotal    = parseInt(ov?.ok_count   || '0')
  const naTotal    = parseInt(ov?.na_count   || '0')
  const nokRate    = pct(nokTotal, stepTotal)
  const selectedWi = wiOptions.find(w => w.wi_number === wiNumber)

  const hasData = wiOptions.length > 0

  return (
    <AppLayout breadcrumb={[{ label: 'MOMS Analytics' }]}>

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.4px] text-text">MOMS Analytics</h1>
        <p className="text-[13px] text-text-3 mt-1">
          Query historical checklist data by work instruction and date range
        </p>
      </div>

      {/* ── Search panel ─────────────────────────────────────── */}
      <div className="bg-bg-2 border border-border rounded-[12px] p-5 mb-5">
        <div className="flex items-end gap-3 flex-wrap">
          {/* WI Number */}
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[11px] font-semibold text-text-3 uppercase tracking-[0.08em] mb-1.5">
              Work Instruction Number
            </label>
            {hasData ? (
              <select
                value={wiNumber}
                onChange={e => { setWiNumber(e.target.value); setSearched(false) }}
                className="w-full px-3 py-2 bg-bg border border-border-2 rounded-[7px] text-[13px] text-text outline-none focus:border-accent appearance-none cursor-pointer transition-colors"
              >
                <option value="">— Select a WI number —</option>
                {wiOptions.map(w => (
                  <option key={w.wi_number} value={w.wi_number}>
                    {w.wi_number} · {w.work_orders} WO{w.work_orders !== 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={wiNumber}
                onChange={e => { setWiNumber(e.target.value); setSearched(false) }}
                placeholder="e.g. SIG/WI/PMW/0007 REV 14"
                className="w-full px-3 py-2 bg-bg border border-border-2 rounded-[7px] text-[13px] text-text outline-none focus:border-accent placeholder:text-text-3 transition-colors"
              />
            )}
          </div>

          {/* From date */}
          <div className="w-40">
            <label className="block text-[11px] font-semibold text-text-3 uppercase tracking-[0.08em] mb-1.5">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setSearched(false) }}
              className="w-full px-3 py-2 bg-bg border border-border-2 rounded-[7px] text-[13px] text-text outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* To date */}
          <div className="w-40">
            <label className="block text-[11px] font-semibold text-text-3 uppercase tracking-[0.08em] mb-1.5">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setSearched(false) }}
              className="w-full px-3 py-2 bg-bg border border-border-2 rounded-[7px] text-[13px] text-text outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Search button */}
          <Button
            variant="primary"
            onClick={handleSearch}
            loading={analyticsLoading || isFetching}
            disabled={!wiNumber}
          >
            <Search size={14} className="mr-1.5" />
            Search
          </Button>

          {/* Import toggle */}
          <button
            onClick={() => setShowImport(p => !p)}
            className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-text-3 hover:text-text border border-border-2 rounded-[7px] bg-transparent cursor-pointer transition-colors"
          >
            <Upload size={13} />
            {hasData ? 'Import more' : 'Import Excel'}
          </button>
        </div>

        {/* Import drawer */}
        {showImport && (
          <div className="mt-4 pt-4 border-t border-border">
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-[10px] p-8 text-center cursor-pointer transition-all ${
                dragging ? 'border-accent bg-accent-bg' : 'border-border hover:border-accent/50 hover:bg-bg-3/20'
              }`}
            >
              <Upload size={24} className="mx-auto text-text-3 mb-3" />
              <p className="text-[13px] font-medium text-text">
                {importMutation.isPending ? 'Importing…' : 'Drop MOMS Excel export here or click to browse'}
              </p>
              <p className="text-[11px] text-text-3 mt-1">
                Generated by <span className="font-mono">extract.py</span> · requires <span className="font-mono">All_Years</span> or <span className="font-mono">Checklist_Steps</span> sheet
              </p>
              {importMsg && (
                <div className={`mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-[7px] text-[12px] font-medium ${
                  importMsg.ok ? 'bg-green-500/10 text-green-400 ring-1 ring-green-500/20'
                               : 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                }`}>
                  {importMsg.ok ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
                  {importMsg.text}
                </div>
              )}
            </div>
          </div>
        )}

        {/* No data hint */}
        {!hasData && !wiLoading && !showImport && (
          <p className="mt-3 text-[12px] text-text-3">
            No MOMS data imported yet.{' '}
            <button onClick={() => setShowImport(true)} className="text-accent hover:underline bg-transparent border-none cursor-pointer p-0 text-[12px]">
              Import an Excel file →
            </button>
          </p>
        )}
      </div>

      {/* ── Analytics results ─────────────────────────────────── */}
      {searched && !analytics && (analyticsLoading || isFetching) && (
        <div className="flex items-center justify-center gap-3 py-16 text-text-3">
          <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-[13px]">Loading analytics…</span>
        </div>
      )}

      {searched && analytics && ov && (
        <div className="flex flex-col gap-5">

          {/* WI title + date range */}
          {selectedWi && (
            <div className="bg-accent/5 border border-accent/20 rounded-[10px] px-5 py-3.5 flex items-center gap-4 flex-wrap">
              <div>
                <p className="text-[11px] text-text-3 uppercase tracking-[0.08em] mb-0.5">Work Instruction</p>
                <p className="text-[14px] font-semibold text-text leading-snug font-mono">{wiNumber}</p>
                {selectedWi.wi_title && (
                  <p className="text-[12px] text-text-2 mt-0.5">{selectedWi.wi_title.replace(/\n/g, ' ')}</p>
                )}
              </div>
              {ov.earliest && (
                <div className="ml-auto text-right flex-shrink-0">
                  <p className="text-[11px] text-text-3 uppercase tracking-[0.08em] mb-0.5">Date Range</p>
                  <p className="text-[12px] font-mono text-text-2">
                    {new Date(ov.earliest).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {' – '}
                    {new Date(ov.latest!).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon={Activity}      label="Steps Inspected" value={stepTotal.toLocaleString()}       color="default" />
            <KpiCard icon={CheckCircle}   label="OK"              value={okTotal.toLocaleString()}          color="green"   sub={`${pct(okTotal, stepTotal).toFixed(1)}% of total`} />
            <KpiCard icon={AlertTriangle} label="NOK"             value={nokTotal.toLocaleString()}         color={nokRate >= 20 ? 'red' : nokRate >= 10 ? 'amber' : 'green'} sub={`${nokRate.toFixed(1)}% failure rate`} />
            <KpiCard icon={TrendingDown}  label="Work Orders"     value={parseInt(ov.work_orders || '0')}   color="blue"    sub={`${parseInt(ov.stations || '0')} station(s)`} />
          </div>

          {/* Overall health bar */}
          <div className="bg-bg-2 border border-border rounded-[10px] px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[12px] font-semibold text-text">Overall Result Distribution</p>
              <p className="text-[11px] text-text-3">{stepTotal.toLocaleString()} checklist steps</p>
            </div>
            <div className="flex rounded-full h-3 overflow-hidden gap-0.5">
              {okTotal  > 0 && <div className="bg-green-500 transition-all duration-700" style={{ flex: okTotal  }} title={`OK: ${okTotal}`}  />}
              {nokTotal > 0 && <div className="bg-red-500   transition-all duration-700" style={{ flex: nokTotal }} title={`NOK: ${nokTotal}`} />}
              {naTotal  > 0 && <div className="bg-amber-500 transition-all duration-700" style={{ flex: naTotal  }} title={`NA: ${naTotal}`}  />}
            </div>
            <div className="flex gap-4 mt-2">
              {[
                { label: 'OK',  count: okTotal,  cls: 'text-green-400' },
                { label: 'NOK', count: nokTotal, cls: 'text-red-400'   },
                { label: 'N/A', count: naTotal,  cls: 'text-amber-400' },
              ].map(({ label, count, cls }) => (
                <div key={label} className="flex items-center gap-1.5 text-[11px]">
                  <span className={`font-semibold ${cls}`}>{count.toLocaleString()}</span>
                  <span className="text-text-3">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Station breakdown */}
          {analytics.byStation.length > 0 && (
            <Card>
              <CardHeader actions={<span className="text-[11px] text-text-3">{analytics.byStation.length} stations</span>}>
                NOK Rate by Station
              </CardHeader>
              <div>
                {analytics.byStation.map(s => {
                  const rate = parseFloat(s.nok_rate || '0')
                  return (
                    <div key={s.station} className="flex items-center gap-4 px-[18px] py-3 border-b border-border last:border-0 hover:bg-bg-3/20 transition-colors">
                      <span className="text-[13px] text-text w-44 truncate flex-shrink-0">{s.station}</span>
                      <div className="flex-1"><NokBar rate={rate} /></div>
                      <span className="text-[11px] text-text-3 font-mono w-20 text-right flex-shrink-0">{s.nok_count}/{s.total}</span>
                      <NokBadge rate={rate} />
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Monthly trend */}
          {analytics.trend.length > 0 && (
            <Card>
              <CardHeader>Monthly Trend</CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-bg-3/30">
                      {['Month', 'Work Orders', 'Steps', 'NOK', 'NOK %'].map((h, i) => (
                        <th key={h} className={`px-5 py-2.5 text-[10px] font-semibold text-text-3 uppercase tracking-[0.08em] ${i > 0 ? 'text-right' : 'text-left'}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.trend.map(t => {
                      const rate = pct(parseInt(t.nok_count), parseInt(t.total))
                      return (
                        <tr key={t.month} className="border-b border-border last:border-0 hover:bg-bg-3/30 transition-colors">
                          <td className="px-5 py-3 text-text font-medium">
                            {new Date(t.month).toLocaleDateString('en-SG', { month: 'short', year: 'numeric' })}
                          </td>
                          <td className="px-5 py-3 text-right text-text-2 font-mono">{t.work_orders}</td>
                          <td className="px-5 py-3 text-right text-text-2 font-mono">{t.total}</td>
                          <td className="px-5 py-3 text-right font-mono text-red-400 font-medium">{t.nok_count}</td>
                          <td className="px-5 py-3 text-right"><NokBadge rate={rate} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Top NOK steps */}
          {analytics.byStep.length > 0 && (
            <Card>
              <CardHeader actions={<span className="text-[11px] text-text-3">ranked by failure count · top 50</span>}>
                Highest-Failure Steps
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-bg-3/30">
                      {['#', 'Section', 'Step', 'Description', 'Inspected', 'NOK', 'Rate'].map((h, i) => (
                        <th key={h} className={`px-4 py-2.5 text-[10px] font-semibold text-text-3 uppercase tracking-[0.08em] ${i >= 4 ? 'text-right' : 'text-left'}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.byStep.map((s, i) => {
                      const rate = parseFloat(s.nok_rate || '0')
                      return (
                        <tr key={i} className={`border-b border-border last:border-0 transition-colors ${
                          rate >= 20 ? 'bg-red-500/5 hover:bg-red-500/10'
                          : rate >= 10 ? 'bg-amber-500/5 hover:bg-amber-500/10'
                          : 'hover:bg-bg-3/30'
                        }`}>
                          <td className="px-4 py-3 text-[11px] text-text-3 font-mono">{i + 1}</td>
                          <td className="px-4 py-3 text-[11px] text-text-3 max-w-[100px] truncate">{s.section}</td>
                          <td className="px-4 py-3 text-[11px] font-mono text-text-2 whitespace-nowrap">{s.step_no}</td>
                          <td className="px-4 py-3 text-[12px] text-text max-w-[260px]">
                            <span className="line-clamp-2">{s.step_desc}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-text-2 text-[12px]">{s.total}</td>
                          <td className="px-4 py-3 text-right font-mono text-red-400 font-semibold text-[12px]">{s.nok_count}</td>
                          <td className="px-4 py-3 w-28"><NokBar rate={rate} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Empty results */}
          {stepTotal === 0 && (
            <div className="bg-bg-2 border border-border rounded-[10px] p-12 text-center">
              <p className="text-[14px] font-medium text-text">No result-type steps found</p>
              <p className="text-[12px] text-text-3 mt-1.5">
                Try adjusting the date range or check that the correct WI number is imported.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Landing state — no search yet */}
      {!searched && (
        <div className="bg-bg-2 border border-border rounded-[12px] p-14 text-center">
          <Search size={36} className="mx-auto text-text-3 mb-4" />
          <p className="text-[15px] font-semibold text-text">Select a WI number and run search</p>
          <p className="text-[13px] text-text-3 mt-1.5 max-w-sm mx-auto">
            {hasData
              ? 'Choose a work instruction above and optionally filter by date range to view NOK analytics.'
              : 'Import a MOMS Excel file first, then search by WI number and date to view analytics.'}
          </p>
        </div>
      )}
    </AppLayout>
  )
}
