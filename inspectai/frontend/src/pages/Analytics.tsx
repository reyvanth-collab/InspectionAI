import { useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { StatCard } from '@/components/ui/StatCard'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { useAnalytics, type DateRange } from '@/hooks/useAnalytics'

export default function Analytics() {
  const [range, setRange] = useState<DateRange>('30')
  const { data, isLoading } = useAnalytics(range)

  const byCategory      = data?.byCategory ?? []
  const totalPass       = data?.totalPass ?? 0
  const totalFail       = data?.totalFail ?? 0
  const totalInspections = data?.totalInspections ?? 0
  const total           = totalPass + totalFail
  const passRate        = total > 0 ? Math.round((totalPass / total) * 100) : 0
  const maxVal          = byCategory.length > 0
    ? Math.max(...byCategory.map(d => d.pass + d.fail), 1)
    : 1

  return (
    <AppLayout breadcrumb={[{ label: 'Analytics' }]}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Analytics</h1>
          <p className="text-[13px] text-text-2 mt-1">Inspection performance and quality metrics</p>
        </div>
        {/* Date range selector */}
        <div className="flex gap-1.5">
          {(['30', '90', '180', '365'] as DateRange[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-[6px] text-[12px] border transition-all duration-150 cursor-pointer ${
                range === r
                  ? 'bg-accent-bg border-accent-bd text-accent'
                  : 'bg-transparent border-border-2 text-text-2 hover:border-accent hover:text-accent'
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Inspection Records"  value={isLoading ? '—' : totalInspections} />
        <StatCard label="Pass Rate"           value={isLoading ? '—' : `${passRate}%`}   color="green"  />
        <StatCard label="Total Failures"      value={isLoading ? '—' : totalFail}         color="red"    />
        <StatCard label="Avg / Day"
          value={isLoading ? '—' : (totalInspections / parseInt(range)).toFixed(1)}
          color="accent"
        />
      </div>

      {/* Bar chart */}
      <Card>
        <CardHeader>Inspection Results by Category — last {range} days</CardHeader>
        <CardBody>
          {isLoading ? (
            <div className="flex flex-col gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="h-3 w-32 rounded shimmer" />
                  <div className="h-5 w-full rounded shimmer" />
                </div>
              ))}
            </div>
          ) : byCategory.length === 0 ? (
            <p className="text-[13px] text-text-3 text-center py-8">
              No inspection data for this period.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-4">
                {byCategory.map(d => {
                  const passW = (d.pass / maxVal) * 100
                  const failW = (d.fail / maxVal) * 100
                  const rate  = d.pass + d.fail > 0
                    ? Math.round((d.pass / (d.pass + d.fail)) * 100)
                    : 0
                  return (
                    <div key={d.label}>
                      <div className="flex items-center justify-between text-[12px] mb-1.5">
                        <span className="text-text-2 w-24 truncate">{d.label}</span>
                        <span className="font-mono text-[11px] text-text-3">
                          {d.pass + d.fail} total · {rate}% pass
                        </span>
                      </div>
                      <div className="flex gap-0.5 h-5 rounded-[3px] overflow-hidden">
                        {d.pass > 0 && (
                          <div
                            className="bg-success transition-all duration-500"
                            style={{ width: `${passW}%` }}
                            title={`Pass: ${d.pass}`}
                          />
                        )}
                        {d.fail > 0 && (
                          <div
                            className="bg-danger transition-all duration-500"
                            style={{ width: `${failW}%` }}
                            title={`Fail: ${d.fail}`}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Legend */}
              <div className="flex gap-4 mt-5 text-[12px] text-text-2">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-success inline-block" /> Pass
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-danger inline-block" /> Fail
                </span>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </AppLayout>
  )
}
