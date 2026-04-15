import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardHeader, CardBody, CardFooter } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

const REPORT_TYPES = [
  {
    id: 'inspection-summary',
    title: 'Inspection Summary Report',
    desc: 'Full list of completed inspections with pass/fail breakdown by category and inspector.',
    badge: 'active' as const,
    lastGenerated: '2026-04-08',
  },
  {
    id: 'wi-compliance',
    title: 'WI Compliance Report',
    desc: 'Work instruction expiry status, overdue renewals, and approval pipeline health.',
    badge: 'active' as const,
    lastGenerated: '2026-04-07',
  },
  {
    id: 'defect-analysis',
    title: 'Defect Analysis Report',
    desc: 'AI-classified failure codes, root cause breakdown, and recurring defect patterns.',
    badge: 'active' as const,
    lastGenerated: '2026-04-06',
  },
  {
    id: 'audit-trail',
    title: 'Audit Trail Export',
    desc: 'Immutable action log with user, timestamp, and hash for compliance and legal purposes.',
    badge: 'active' as const,
    lastGenerated: '2026-04-09',
  },
  {
    id: 'escalation',
    title: 'Escalation Report',
    desc: 'Triggered escalations, response times, and unresolved critical items.',
    badge: 'expiring' as const,
    lastGenerated: '2026-04-05',
  },
]

function handleExport(id: string, format: 'json' | 'pdf') {
  if (format === 'json') {
    const blob = new Blob([JSON.stringify({ report: id, generatedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${id}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  } else {
    window.print()
  }
}

export default function Reports() {
  return (
    <AppLayout breadcrumb={[{ label: 'Reports' }]}>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Reports</h1>
        <p className="text-[13px] text-text-2 mt-1">Generate and export inspection reports</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {REPORT_TYPES.map(report => (
          <Card key={report.id}>
            <CardHeader
              actions={<Badge variant={report.badge}>{report.badge}</Badge>}
            >
              {report.title}
            </CardHeader>
            <CardBody>
              <p className="text-[13px] text-text-2 leading-relaxed">{report.desc}</p>
              <p className="text-[11px] text-text-3 mt-3 font-mono">
                Last generated: {report.lastGenerated}
              </p>
            </CardBody>
            <CardFooter>
              <Button variant="secondary" size="sm" onClick={() => handleExport(report.id, 'json')}>
                Export JSON
              </Button>
              <Button variant="primary" size="sm" onClick={() => handleExport(report.id, 'pdf')}>
                Export PDF
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </AppLayout>
  )
}
