import { useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'

type SettingsTab = 'branding' | 'sso' | 'integrations' | 'users'

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'branding',     label: 'Branding' },
  { id: 'sso',          label: 'SSO & Auth' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'users',        label: 'Users & Access' },
]

const MOCK_USERS = [
  { id: '1', name: 'Admin User', email: 'admin@inspectai.io',    staffId: 'ADM001', role: 'admin'     },
  { id: '2', name: 'Sarah Lee',  email: 'sarah@inspectai.io',    staffId: 'APR001', role: 'approver'  },
  { id: '3', name: 'James Tan',  email: 'james@inspectai.io',    staffId: 'INS001', role: 'inspector' },
  { id: '4', name: 'Raj Kumar',  email: 'raj@inspectai.io',      staffId: 'INS002', role: 'inspector' },
  { id: '5', name: 'Viewer User', email: 'viewer@inspectai.io', staffId: 'VWR001', role: 'viewer'    },
]

const ROLE_PILL: Record<string, string> = {
  admin:     'bg-danger-bg text-danger border border-danger-border',
  approver:  'bg-violet-bg text-violet border border-violet-border',
  inspector: 'bg-info-bg text-info border border-info-border',
  viewer:    'bg-bg-3 text-text-2 border border-border-2',
}

const SSO_PROVIDERS = ['Azure AD', 'Okta', 'Google Workspace', 'Generic SAML 2.0']

const INTEGRATIONS = [
  { id: 'maximo', name: 'IBM Maximo', status: 'connected',     desc: 'Asset & work order sync' },
  { id: 'sap',    name: 'SAP PM',     status: 'disconnected',  desc: 'Maintenance integration'  },
  { id: 'teams',  name: 'MS Teams',   status: 'connected',     desc: 'Escalation notifications' },
  { id: 'slack',  name: 'Slack',      status: 'disconnected',  desc: 'Alert notifications'      },
  { id: 'powerbi',name: 'Power BI',   status: 'disconnected',  desc: 'Analytics dashboard'      },
]

export default function Settings() {
  const { user } = useAuth()
  const [tab, setTab] = useState<SettingsTab>('branding')
  const [appName, setAppName]     = useState('InspectAI')
  const [primaryColor, setColor]  = useState('#4f8ef7')
  const [ssoProvider, setSso]     = useState(SSO_PROVIDERS[0])

  if (user?.role !== 'admin') {
    return (
      <AppLayout breadcrumb={[{ label: 'Settings' }]}>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span className="text-5xl mb-4">🔒</span>
          <h3 className="text-[16px] font-medium mb-2">Admin access required</h3>
          <p className="text-[13px] text-text-2">Only admins can access Settings.</p>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Settings' }]}>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Settings</h1>
        <p className="text-[13px] text-text-2 mt-1">Enterprise configuration and administration</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-border pb-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-[13px] border-b-2 -mb-px transition-all duration-150 bg-transparent cursor-pointer ${
              tab === t.id
                ? 'border-accent text-accent font-medium'
                : 'border-transparent text-text-2 hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── BRANDING ── */}
      {tab === 'branding' && (
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>White-label Branding</CardHeader>
            <CardBody className="flex flex-col gap-4">
              <div>
                <label className="block text-[11px] font-medium text-text-2 uppercase tracking-[0.08em] mb-1.5">App Name</label>
                <input value={appName} onChange={e => setAppName(e.target.value)}
                  className="w-full px-[14px] py-[9px] bg-bg border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent transition-colors" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-text-2 uppercase tracking-[0.08em] mb-1.5">Primary Colour</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={primaryColor} onChange={e => setColor(e.target.value)}
                    className="w-10 h-10 rounded-[6px] border border-border-2 cursor-pointer bg-transparent p-0.5" />
                  <span className="font-mono text-[13px] text-text-2">{primaryColor}</span>
                </div>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {['#4f8ef7','#34d399','#f87171','#fbbf24','#a78bfa','#22d3ee','#f97316','#ec4899'].map(c => (
                    <button key={c} onClick={() => setColor(c)}
                      className="w-6 h-6 rounded-full border-2 cursor-pointer transition-all"
                      style={{ background: c, borderColor: c === primaryColor ? '#fff' : 'transparent' }} />
                  ))}
                </div>
              </div>
              <Button variant="primary" size="md">Save Branding</Button>
            </CardBody>
          </Card>

          {/* Preview */}
          <Card>
            <CardHeader>Live Preview</CardHeader>
            <CardBody>
              <div className="border border-border rounded-[8px] overflow-hidden">
                <div className="h-10 flex items-center px-4 gap-2" style={{ background: primaryColor }}>
                  <span className="w-5 h-5 rounded-[4px] bg-white/20 flex items-center justify-center text-[10px]">✦</span>
                  <span className="text-white font-semibold text-[13px]">{appName}</span>
                </div>
                <div className="p-4 bg-bg-3">
                  <div className="h-3 w-24 bg-border-2 rounded shimmer mb-2" />
                  <div className="h-2 w-40 bg-border rounded shimmer" />
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── SSO ── */}
      {tab === 'sso' && (
        <Card>
          <CardHeader>SSO Configuration</CardHeader>
          <CardBody className="flex flex-col gap-4">
            <div>
              <label className="block text-[11px] font-medium text-text-2 uppercase tracking-[0.08em] mb-1.5">Identity Provider</label>
              <select value={ssoProvider} onChange={e => setSso(e.target.value)}
                className="w-full max-w-sm px-[14px] py-[9px] bg-bg border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent transition-colors cursor-pointer appearance-none">
                {SSO_PROVIDERS.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-text-2 uppercase tracking-[0.08em] mb-1.5">Entity ID / Metadata URL</label>
              <input placeholder="https://your-idp.com/metadata.xml"
                className="w-full px-[14px] py-[9px] bg-bg border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent placeholder:text-text-3 transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-text-2 uppercase tracking-[0.08em] mb-1.5">ACS URL</label>
              <input defaultValue="https://app.inspectai.io/auth/saml/callback" readOnly
                className="w-full px-[14px] py-[9px] bg-bg-3 border border-border rounded-[8px] text-[13px] text-text-3 outline-none font-mono" />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="md">Test Connection</Button>
              <Button variant="primary"   size="md">Save SSO Config</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── INTEGRATIONS ── */}
      {tab === 'integrations' && (
        <div className="flex flex-col gap-3">
          {INTEGRATIONS.map(int => (
            <Card key={int.id}>
              <CardBody className="flex items-center gap-4 py-4">
                <div className="flex-1">
                  <p className="text-[14px] font-medium text-text">{int.name}</p>
                  <p className="text-[12px] text-text-2 mt-0.5">{int.desc}</p>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                  int.status === 'connected'
                    ? 'bg-success-bg text-success border border-success-border'
                    : 'bg-bg-3 text-text-3 border border-border-2'
                }`}>
                  {int.status}
                </span>
                <Button variant="secondary" size="sm">Configure</Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* ── USERS ── */}
      {tab === 'users' && (
        <Card>
          <CardHeader actions={<Button variant="primary" size="sm">+ Add User</Button>}>
            Users & Access Control
          </CardHeader>
          <CardBody className="p-0">
            {MOCK_USERS.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
                <div className="w-8 h-8 rounded-full bg-accent-2 flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0">
                  {u.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text">{u.name}</p>
                  <p className="text-[12px] text-text-2">{u.email} · <span className="font-mono">{u.staffId}</span></p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${ROLE_PILL[u.role]}`}>
                  {u.role}
                </span>
                <div className="flex gap-1.5">
                  <Button variant="secondary" size="sm">Edit</Button>
                  <Button variant="danger"    size="sm">Remove</Button>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </AppLayout>
  )
}
