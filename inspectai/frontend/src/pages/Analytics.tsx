import { useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { StatCard } from '@/components/ui/StatCard'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'

type DateRange = '30' | '90' | '180' | '365'

const BAR_DATA: Record<DateRange, Array<{ label: string; pass: number; fail: number }>> = {
  '30':  [
    { label: 'Electrical', pass: 42, fail: 8  },
    { label: 'Mechanical', pass: 38, fail: 12 },
    { label: 'Fire Prot',  pass: 29, fail: 3  },
    { label: 'Structural', pass: 18, fail: 5  },
    { label: 'HVAC',       pass: 33, fail: 7  },
  ],
  '90':  [
    { label: 'Electrical', pass: 120, fail: 22 },
    { label: 'Mechanical', pass: 95,  fail: 30 },
    { label: 'Fire Prot',  pass: 88,  fail: 9  },
    { label: 'Structural', pass: 54,  fail: 18 },
    { label: 'HVAC',       pass: 100, fail: 24 },
  ],
  '180': [
    { label: 'Electrical', pass: 240, fail: 42 },
    { label: 'Mechanical', pass: 190, fail: 60 },
    { label: 'Fire Prot',  pass: 175, fail: 18 },
    { label: 'Structural', pass: 110, fail: 35 },
    { label: 'HVAC',       pass: 200, fail: 48 },
  ],
  '365': [
    { label: 'Electrical', pass: 480, fail: 84 },
    { label: 'Mechanical', pass: 380, fail: 120 },
    { label: 'Fire Prot',  pass: 350, fail: 36  },
    { label: 'Structural', pass: 220, fail: 70  },
    { label: 'HVAC',       pass: 400, fail: 96  },
  ],
}

export default function Analytics() {
  const [range, setRange] = useState<DateRange>('30')
  const data = BAR_DATA[range]
  const maxVal = Math.max(...data.map(d => d.pass + d.fail))

  const totalPass = data.reduce((s, d) => s + d.pass, 0)
  const totalFail = data.reduce((s, d) => s + d.fail, 0)
  const total = totalPass + totalFail
  const passRate = total > 0 ? Math.round((totalPass / total) * 100) : 0

  return (
    <AppLayout breadcrumb={[{ label: 'Analytics' }]}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Analytics</h1>
          <p className="text-[13px] text-text-2 mt-1">Inspection performance and quality metrics</p>
        </div>
        {/* Date range */}
        <div className="flex gap-1.5">
          {(['30', '90', '180', '365'] as DateRange[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-[6px] text-[12px] border transition-all duration-150 ${
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
        <StatCard label="Total Inspections" value={total}       />
        <StatCard label="Pass Rate"         value={`${passRate}%`} color="green"  />
        <StatCard label="Failures"          value={totalFail}   color="red"    />
        <StatCard label="Avg / Day"         value={(total / parseInt(range)).toFixed(1)} color="accent" />
      </div>

      {/* Bar chart */}
      <Card>
        <CardHeader>Inspection Results by Category — last {range} days</CardHeader>
        <CardBody>
          <div className="flex flex-col gap-4">
            {data.map(d => {
              const passW = (d.pass / maxVal) * 100
              const failW = (d.fail / maxVal) * 100
              const rate  = Math.round((d.pass / (d.pass + d.fail)) * 100)
              return (
                <div key={d.label}>
                  <div className="flex items-center justify-between text-[12px] mb-1.5">
                    <span className="text-text-2 w-20">{d.label}</span>
                    <span className="font-mono text-[11px] text-text-3">{rate}% pass</span>
                  </div>
                  <div className="flex gap-1 h-5">
                    <div
                      className="bg-success rounded-l-[3px] transition-all duration-500"
                      style={{ width: `${passW}%` }}
                      title={`Pass: ${d.pass}`}
                    />
                    <div
                      className="bg-danger rounded-r-[3px] transition-all duration-500"
                      style={{ width: `${failW}%` }}
                      title={`Fail: ${d.fail}`}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex gap-4 mt-5 text-[12px] text-text-2">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-success" /> Pass
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-danger" /> Fail
            </span>
          </div>
        </CardBody>
      </Card>
    </AppLayout>
  )
}
