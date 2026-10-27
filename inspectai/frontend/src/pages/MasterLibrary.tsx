import { RecordTable } from '@/components/ui/RecordTable'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'
import { useDepartments } from '@/hooks/useDepartments'
import { can, formStatus } from '@/lib/permissions'
import { api } from '@/lib/api'
interface FormRow {
  id: string
  wi_number: string
  title: string
  revision: string
  status: string
  owner_name: string
  department_id: string
  checkable_item_count: number
  checklist_item_count: number
}
const tabs = [
  ['active', 'Published'],
  ['draft', 'Drafts'],
  ['pending_approval', 'Awaiting approval'],
  ['superseded', 'Previous versions'],
  ['all', 'All forms'],
]
export default function MasterLibrary() {
  const { user } = useAuth(),
    [params, setParams] = useSearchParams(),
    { data: departments = [] } = useDepartments()
  const [sort, setSort] = useState('reference'),
    [direction, setDirection] = useState('asc'),
    [search, setSearch] = useState(''),
    [department, setDepartment] = useState(''),
    [mine, setMine] = useState(false),
    [page, setPage] = useState(1)
  const status = params.get('status') || 'active',
    needsApproval = params.get('needsApproval') === 'true'
  const query = new URLSearchParams({
    search,
    sort,
    direction,
    page: String(page),
    ...(status !== 'all' && !needsApproval ? { status } : {}),
    ...(department ? { departmentId: department } : {}),
    ...(mine ? { mine: 'true' } : {}),
    ...(needsApproval ? { needsApproval: 'true' } : {}),
  })
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['work-instructions', query.toString()],
    queryFn: async () =>
      (
        await api.get<{ data: FormRow[]; meta: { hasMore: boolean; total: number } }>(
          `/work-instructions?${query}`,
        )
      ).data,
  })
  return (
    <AppLayout breadcrumb={[{ label: 'Inspection Forms' }]}>
      <div className="page-heading flex flex-wrap gap-4 justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Inspection Forms</h1>
          <p className="text-sm text-text-2 mt-2">
            Create, review and publish versioned inspection checklists.
          </p>
        </div>
        {can(user, 'form_author') && (
          <Link to="/library/new">
            <Button variant="primary">
              <Plus size={16} />
              Create form
            </Button>
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mb-5" aria-label="Form lifecycle">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            className={`px-3 py-2 rounded-lg border text-sm ${status === value && !needsApproval ? 'bg-accent-bg border-accent text-accent' : 'border-border text-text-2'}`}
            onClick={() => {
              setParams({ status: value })
              setPage(1)
            }}
          >
            {label}
          </button>
        ))}
        {can(user, 'form_approver') && (
          <button
            onClick={() => {
              setParams({ needsApproval: 'true' })
              setPage(1)
            }}
            className={`px-3 py-2 rounded-lg border text-sm ${needsApproval ? 'border-accent text-accent bg-accent-bg' : 'border-border'}`}
          >
            Needs my approval
          </button>
        )}
      </div>
      <div className="grid sm:grid-cols-[1fr_240px_auto] gap-3 mb-5">
        <label className="relative">
          <Search size={16} className="absolute left-3 top-3.5 text-text-2" />
          <input
            aria-label="Search inspection forms"
            className="field-input pl-10"
            placeholder="Search reference or title"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <select
          aria-label="Department"
          className="field-input"
          value={department}
          onChange={(e) => {
            setDepartment(e.target.value)
            setPage(1)
          }}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => {
              setMine(e.target.checked)
              setPage(1)
            }}
          />
          Created by me
        </label>
      </div>
      {isLoading && <p className="text-sm">Loading forms…</p>}
      {error && (
        <p className="text-danger" role="alert">
          Forms could not be loaded. <button onClick={() => void refetch()}>Retry</button>
        </p>
      )}
      {data?.data.length === 0 && (
        <div className="p-10 bg-bg-2 border border-border rounded-xl text-center text-text-2">
          No forms match these filters.
        </div>
      )}
      <RecordTable
        label="Inspection Forms"
        rows={data?.data || []}
        rowKey={(f) => f.wi_number + ' ' + f.revision}
        sort={sort}
        direction={direction}
        onSort={(key) => {
          setDirection(sort === key && direction === 'asc' ? 'desc' : 'asc')
          setSort(key)
          setPage(1)
        }}
        columns={[
          {
            key: 'reference',
            label: 'Form reference',
            essential: true,
            render: (f) => (
              <Link className="font-mono" to={'/library/' + f.id}>
                {f.wi_number}
              </Link>
            ),
          },
          { key: 'title', label: 'Title', essential: true, render: (f) => f.title },
          {
            key: 'department',
            label: 'Department',
            render: (f) =>
              departments.find((d) => d.id === f.department_id)?.name || 'Not recorded',
          },
          { key: 'revision', label: 'Revision', render: (f) => f.revision },
          { key: 'questions', label: 'Questions', render: (f) => f.checkable_item_count },
          { key: 'status', label: 'Lifecycle', render: (f) => formStatus(f.status) },
          { key: 'author', label: 'Author', render: (f) => f.owner_name || 'Not recorded' },
        ]}
      />
      <div className="flex justify-between items-center mt-5">
        <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span className="text-sm text-text-2">
          Page {page} ? {data?.meta.total || 0} matching forms
        </span>
        <Button
          variant="secondary"
          disabled={!data?.meta.hasMore}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </AppLayout>
  )
}
