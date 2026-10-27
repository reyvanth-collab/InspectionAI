import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useBlocker } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SignaturePad } from '@/components/ui/SignaturePad'
import { History } from '@/components/ui/History'
import { useWorkOrder } from '@/hooks/useWorkOrders'
import {
  useInspectionRecord,
  useStartInspection,
  useCompleteInspection,
} from '@/hooks/useInspection'
import { useAuth } from '@/context/AuthContext'
import { can } from '@/lib/permissions'
import { useAssignableUsers } from '@/hooks/useUsers'
import { useWorkInstructions } from '@/hooks/useWorkInstructions'
import { api } from '@/lib/api'
type Result = 'pass' | 'fail' | 'na'
interface Item {
  id: string
  item_no: string
  description: string
  acceptance_criteria?: string
  category?: string
  field_type?: string
  required?: boolean
  options_json?: string
  conditional_json?: string
  layout_json?: string
  min_value?: number
  max_value?: number
  unit?: string
}
interface Draft {
  result?: Result
  value: string
  notes: string
  naReason: string
  photos: string[]
  photo?: string
  dirty: boolean
  saving: boolean
  error?: string
  saved?: boolean
}
const empty = (): Draft => ({
  value: '',
  notes: '',
  naReason: '',
  photos: [],
  dirty: false,
  saving: false,
})
const json = (text?: string) => {
  try {
    return JSON.parse(text || '{}')
  } catch {
    return {}
  }
}
function problem(item: Item, d: Draft) {
  const type = item.field_type || 'pass_fail',
    policy = json(item.conditional_json)
  if (!d.result) return item.required !== false ? 'Choose a result' : null
  if (d.result === 'na')
    return (item.required !== false || policy.naReasonRequired) && !d.naReason.trim()
      ? 'Explain why this item is not applicable'
      : null
  if (
    [
      'text',
      'textarea',
      'date',
      'dropdown',
      'select',
      'multiselect',
      'table',
      'signature',
      'checkbox',
      'yes_no',
    ].includes(type) &&
    item.required !== false &&
    !d.value.trim()
  )
    return 'A response is required'
  if (
    type === 'multiselect' &&
    item.required !== false &&
    (!Array.isArray(json(d.value)) || !json(d.value).length)
  )
    return 'Choose at least one response'
  if (
    type === 'table' &&
    item.required !== false &&
    !Object.values(json(d.value)).some((v) => String(v).trim())
  )
    return 'Complete the response table'
  if (['number', 'measurement'].includes(type)) {
    if (!d.value.trim() || !Number.isFinite(Number(d.value))) return 'Enter a numeric reading'
    if (
      d.result === 'pass' &&
      ((item.min_value != null && Number(d.value) < item.min_value) ||
        (item.max_value != null && Number(d.value) > item.max_value))
    )
      return 'The reading is outside the stated limits; review the result'
  }
  if (d.result === 'fail' && policy.notesOnFail && !d.notes.trim())
    return 'Describe the failed condition'
  if (
    ((d.result === 'fail' && policy.photoOnFail) ||
      (type === 'photo' && item.required !== false)) &&
    !d.photos.length &&
    !d.photo
  )
    return 'Attach photo evidence'
  return null
}
export default function InspectionExecution() {
  const { id = '' } = useParams(),
    { user } = useAuth()
  const { data: wo, isLoading, error: loadError, refetch: refreshWO } = useWorkOrder(id),
    {
      data: record,
      refetch: refreshRecord,
      isLoading: recordLoading,
      error: recordError,
    } = useInspectionRecord(id)
  const start = useStartInspection(),
    complete = useCompleteInspection()
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [message, setMessage] = useState(''),
    [review, setReview] = useState(false),
    [signing, setSigning] = useState(false),
    [itemSigning, setItemSigning] = useState<string | null>(null),
    [tab, setTab] = useState('checklist')
  const [confirmReview, setConfirmReview] = useState(false),
    [persisting, setPersisting] = useState(false),
    [saveError, setSaveError] = useState(''),
    [conflict, setConflict] = useState(false),
    [reportBusy, setReportBusy] = useState(false)
  const version = useRef(0),
    epoch = useRef(0),
    savedEpoch = useRef(0),
    initialized = useRef(''),
    draftRef = useRef(drafts),
    flight = useRef<Promise<boolean> | null>(null),
    reviewed = useRef<{ version: number; token: string } | null>(null),
    actor = useRef(user?.id)
  draftRef.current = drafts
  actor.current = user?.id
  const [assignment, setAssignment] = useState<string | null>(null),
    [replacement, setReplacement] = useState<string | null>(null),
    [managing, setManaging] = useState(false)
  const manager = can(user, 'work_order_manager')
  const { data: assignable = [] } = useAssignableUsers(
    typeof wo?.department_id === 'string' ? wo.department_id : undefined,
    manager,
  )
  const { data: forms = [] } = useWorkInstructions(undefined, manager)
  const items = (wo?.checklist_items || []) as Item[],
    questions = items.filter((i) => i.field_type !== 'heading'),
    done = !!record?.completed_at
  const mayEdit =
    !done &&
    !['complete', 'cancelled'].includes(String(wo?.status)) &&
    ((wo?.assigned_to === user?.id && can(user, 'inspector')) || can(user, 'administrator'))
  async function manage(action: 'assignment' | 'work-instruction') {
    setManaging(true)
    setMessage('')
    try {
      await api.patch(
        `/inspections/${id}/${action}`,
        action === 'assignment' ? { assignedTo: assignment } : { workInstructionId: replacement },
      )
      setAssignment(null)
      setReplacement(null)
      await refreshWO()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The change could not be saved')
    } finally {
      setManaging(false)
    }
  }
  useEffect(() => {
    const key = (user?.id || '') + ':' + id + ':' + (record?.id || '')
    if (!record || initialized.current === key) return
    initialized.current = key
    version.current = record.draft?.version || 0
    epoch.current = 0
    savedEpoch.current = 0
    reviewed.current = null
    const next: Record<string, Draft> = {}
    for (const f of record.inspection_findings || [])
      next[f.checklist_item_id] = {
        ...empty(),
        result: f.result || undefined,
        value: f.captured_value || '',
        notes: f.result === 'na' ? '' : f.notes || '',
        naReason: f.result === 'na' ? f.notes || '' : '',
        photos: f.photo_urls || [],
        saved: true,
      }
    for (const [key, a] of Object.entries(record.draft?.answers || {}))
      next[key] = {
        ...empty(),
        result: a.result || undefined,
        value: a.value,
        notes: a.notes,
        naReason: a.naReason || (a.result === 'na' ? a.notes : ''),
        photos: a.photos,
        saved: true,
      }
    setDrafts(next)
    setSaveError('')
    setConflict(false)
  }, [record, user?.id, id])
  useEffect(
    () => () => {
      draftRef.current = {}
      reviewed.current = null
    },
    [user?.id, id],
  )
  const get = (key: string) => drafts[key] || empty()
  const update = (key: string, patch: Partial<Draft>) => {
    epoch.current++
    reviewed.current = null
    setDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || empty()), ...patch, dirty: true, saved: false, error: undefined },
    }))
  }
  const setState = (key: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] || empty()), ...patch } }))
  const busy = persisting || Object.values(drafts).some((d) => d.saving),
    unsaved = Object.values(drafts).some((d) => d.dirty || d.photo || d.error)
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (unsaved) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])
  const invalid = questions
    .map((item) => ({ item, issue: problem(item, get(item.id)) }))
    .filter((x) => x.issue)
  const answered = questions.filter((i) => get(i.id).result).length,
    failed = questions.filter((i) => get(i.id).result === 'fail')
  const sections = [...new Set(questions.map((i) => i.category || 'Checklist'))]
  const jump = (key: string) => {
    setReview(false)
    document.getElementById('question-' + key)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    })
    document.getElementById('question-' + key)?.focus()
  }
  function flush(): Promise<boolean> {
    if (flight.current) return flight.current
    if (!record || conflict || done) return Promise.resolve(false)
    const account = user?.id
    const operation = (async () => {
      setPersisting(true)
      setSaveError('')
      try {
        while (savedEpoch.current !== epoch.current) {
          const at = epoch.current,
            local = draftRef.current
          const answers = Object.fromEntries(
            Object.entries(local).map(([key, d]) => [
              key,
              {
                result: d.result || null,
                value: d.value,
                notes: d.notes,
                naReason: d.naReason,
                photos: [...new Set([...d.photos, ...(d.photo ? [d.photo] : [])])],
              },
            ]),
          )
          const response = await api.put<{ data: { version: number } }>(
            '/inspections/' + id + '/draft',
            { version: version.current, answers },
          )
          if (actor.current !== account) return false
          version.current = response.data.data.version
          savedEpoch.current = at
          if (epoch.current === at)
            setDrafts((prev) =>
              Object.fromEntries(
                Object.entries(prev).map(([key, d]) => [
                  key,
                  {
                    ...d,
                    photos: answers[key].photos,
                    photo: undefined,
                    dirty: false,
                    saved: true,
                  },
                ]),
              ),
            )
        }
        return true
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Draft save failed. Retry when connected.'
        if (actor.current === account) {
          setSaveError(error)
          if (error.includes('another tab') || error.includes('Reload')) setConflict(true)
        }
        return false
      } finally {
        if (actor.current === account) setPersisting(false)
      }
    })()
    flight.current = operation
    void operation.finally(() => {
      flight.current = null
    })
    return operation
  }
  useEffect(() => {
    if (
      !mayEdit ||
      !record ||
      !unsaved ||
      saveError ||
      conflict ||
      Object.values(drafts).some((d) => d.saving)
    )
      return
    const timer = setTimeout(() => void flush(), 750)
    return () => clearTimeout(timer)
  })
  const blocker = useBlocker(unsaved && !!user && mayEdit)
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Responses are not safely saved. Leave this inspection?'))
        blocker.proceed()
      else blocker.reset()
    }
  }, [blocker])
  async function saveAndReview() {
    if (Object.values(draftRef.current).some((d) => d.saving) || conflict) return
    if (!(await flush())) return
    setPersisting(true)
    try {
      if (!invalid.length && answered) {
        const r = await api.post<{ data: { reviewToken: string; draftVersion: number } }>(
          '/inspections/' + id + '/review',
          { inspectionRecordId: record!.id, draftVersion: version.current },
        )
        reviewed.current = { version: r.data.data.draftVersion, token: r.data.data.reviewToken }
      }
      setConfirmReview(false)
      setReview(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Review could not be saved. Retry.')
    } finally {
      setPersisting(false)
    }
  }
  async function report(print: boolean) {
    setReportBusy(true)
    setMessage('')
    try {
      const r = await api.get('/inspections/' + id + '/report.pdf', { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      if (print) {
        const frame = document.createElement('iframe')
        frame.style.position = 'fixed'
        frame.style.width = '1px'
        frame.style.height = '1px'
        frame.style.opacity = '0'
        frame.src = url
        frame.title = 'Completed inspection report'
        frame.onload = () => {
          try {
            frame.contentWindow?.focus()
            frame.contentWindow?.print()
            frame.dataset.printReady = 'true'
          } catch {
            setMessage('The report is ready. Download the PDF and use its viewer to print.')
          }
        }
        document.body.appendChild(frame)
        setTimeout(() => {
          frame.remove()
          URL.revokeObjectURL(url)
        }, 120000)
      } else {
        const link = document.createElement('a')
        link.href = url
        link.download = String(wo?.wo_number || 'inspection') + '-report.pdf'
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
    } catch {
      setMessage(
        'Report could not be generated. Please retry. Legacy fields without a signed snapshot cannot be reconstructed.',
      )
    } finally {
      setReportBusy(false)
    }
  }
  async function selectPhoto(item: Item, file?: File) {
    if (!file) return
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setState(item.id, { error: 'Use a PNG, JPEG or WebP image smaller than 2 MB' })
      return
    }
    setState(item.id, { saving: true })
    try {
      const photo = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      update(item.id, { photo, saving: false })
    } catch {
      setState(item.id, { saving: false, error: 'Image could not be read. Choose it again.' })
    }
  }
  async function sign(signatureDataUrl: string) {
    if (!record || busy || unsaved || invalid.length || complete.isPending || !reviewed.current)
      return
    setMessage('')
    try {
      await complete.mutateAsync({
        workOrderDbId: id,
        inspectionRecordId: record.id,
        signatureDataUrl,
        draftVersion: reviewed.current.version,
        reviewToken: reviewed.current.token,
      })
      setSigning(false)
      setReview(false)
      await Promise.all([refreshWO(), refreshRecord()])
    } catch (e) {
      reviewed.current = null
      setSigning(false)
      setReview(false)
      setMessage(
        e instanceof Error
          ? e.message
          : 'Inspection could not be signed. Your saved responses are retained.',
      )
    }
  }
  if (isLoading || recordLoading)
    return (
      <AppLayout>
        <p>Loading inspection…</p>
      </AppLayout>
    )
  if (!wo || loadError || (recordError && !record))
    return (
      <AppLayout>
        <p role="alert">This inspection is unavailable or you do not have access.</p>
        <button onClick={() => void Promise.all([refreshWO(), refreshRecord()])}>
          Retry loading inspection
        </button>
        <Link to="/inspections">Back to inspections</Link>
      </AppLayout>
    )
  return (
    <AppLayout
      breadcrumb={[{ label: 'Inspections', path: '/inspections' }, { label: String(wo.wo_number) }]}
    >
      <div className="flex flex-wrap justify-between gap-4 mb-5">
        <div>
          <p className="text-sm font-mono text-accent">{String(wo.wo_number)}</p>
          <h1 className="text-2xl font-semibold mt-1">{String(wo.asset_name)}</h1>
          <p className="text-sm text-text-2 mt-2">
            {String(wo.asset_number_snapshot || 'Legacy asset')} ·{' '}
            {String(wo.location || 'Location not recorded')} ·{' '}
            {String(wo.department_name_snapshot || 'Department not recorded')}
          </p>
          <p className="text-sm text-text-2 mt-1">
            Form: {String(wo.wi_number)} · {String(wo.wi_title)} · {String(wo.revision)}
          </p>
        </div>
        <div className="text-sm text-text-2">
          {done ? (
            <strong className="text-success">
              Signed · {record?.overall_result?.toUpperCase()}
            </strong>
          ) : record ? (
            <span role="status">
              {busy ? 'Saving' : saveError ? 'Save failed' : unsaved ? 'Unsaved changes' : 'Saved'}
            </span>
          ) : (
            <span>Not started</span>
          )}
        </div>
      </div>
      <div className="flex gap-2 mb-5">
        <Button variant="secondary" onClick={() => setTab('checklist')}>
          Checklist
        </Button>
        <Button variant="secondary" onClick={() => setTab('history')}>
          History
        </Button>
      </div>
      {saveError && (
        <div role="alert" className="execution-card text-danger mb-4">
          <p>{saveError}</p>
          <p>
            Responses retained for questions:{' '}
            {questions
              .filter((i) => get(i.id).dirty || get(i.id).photo)
              .map((i) => i.item_no)
              .join(', ') || 'see message above'}
          </p>
          {conflict ? (
            <button
              className="text-accent"
              onClick={async () => {
                if (window.confirm('Discard local edits and load the latest saved draft?')) {
                  initialized.current = ''
                  setDrafts({})
                  setSaveError('')
                  setConflict(false)
                  await refreshRecord()
                }
              }}
            >
              Reload latest draft (discard local edits)
            </button>
          ) : (
            <button className="text-accent" onClick={() => void flush()}>
              Retry saving draft
            </button>
          )}
        </div>
      )}
      {message && (
        <p role="alert" className="text-danger p-3 mb-4 border border-danger-border rounded-lg">
          {message}
        </p>
      )}
      {manager && !record && wo.status === 'open' && (
        <section className="execution-card mb-5">
          <h2 className="font-semibold mb-4">Assignment</h2>
          <div className="grid sm:grid-cols-[1fr_auto] gap-3">
            <label className="field-label">
              Assigned inspector
              <select
                aria-label="Assigned inspector"
                className="field-input mt-2"
                value={assignment ?? String(wo.assigned_to || '')}
                onChange={(e) => setAssignment(e.target.value)}
              >
                <option value="">Unassigned</option>
                {assignable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              loading={managing}
              disabled={assignment === null}
              onClick={() => void manage('assignment')}
            >
              Save assignment
            </Button>
            <label className="field-label">
              Published inspection form
              <select
                aria-label="Published inspection form"
                className="field-input mt-2"
                value={replacement ?? String(wo.work_instruction_id || '')}
                onChange={(e) => setReplacement(e.target.value)}
              >
                <option value="">Select a published form</option>
                {forms
                  .filter(
                    (f) =>
                      f.departmentId === wo.department_id &&
                      ['active', 'expiring'].includes(f.status) &&
                      (!f.expiryDate ||
                        f.expiryDate.slice(0, 10) >= new Date().toISOString().slice(0, 10)) &&
                      (!f.effectiveDate ||
                        f.effectiveDate.slice(0, 10) <= new Date().toISOString().slice(0, 10)) &&
                      (f.checkableItemCount || 0) > 0,
                  )
                  .map((f) => (
                    <option key={f.dbId} value={f.dbId}>
                      {f.id} · {f.title} · {f.revision}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              variant="secondary"
              loading={managing}
              disabled={!replacement}
              onClick={() => void manage('work-instruction')}
            >
              Change form
            </Button>
          </div>
        </section>
      )}
      {tab === 'history' ? (
        <History workOrderId={id} />
      ) : (
        <>
          {!record && (
            <div className="execution-card">
              <p className="text-sm mb-4">
                {questions.length} questions · Complete the checklist, review your responses and
                sign.
              </p>
              {mayEdit ? (
                <Button
                  variant="primary"
                  loading={start.isPending}
                  onClick={async () => {
                    try {
                      await start.mutateAsync({ workOrderDbId: id, totalItems: questions.length })
                    } catch (e) {
                      setMessage(e instanceof Error ? e.message : 'Could not start inspection')
                    }
                  }}
                >
                  Start inspection
                </Button>
              ) : (
                <p className="text-sm text-text-2">
                  Only the assigned inspector or an administrator can complete this inspection.
                </p>
              )}
            </div>
          )}
          {record && (
            <>
              <div className="bg-bg-2 border border-border rounded-xl p-4 mb-5 sticky top-0 z-10">
                <div className="flex justify-between gap-2 text-sm mb-3">
                  <span>
                    {answered} of {questions.length} answered · {failed.length} failed
                  </span>
                  {!done && (
                    <button
                      className="text-accent font-medium"
                      onClick={() => invalid[0] && jump(invalid[0].item.id)}
                    >
                      Next required item
                    </button>
                  )}
                </div>
                <progress
                  aria-label="Checklist progress"
                  className="w-full h-2 accent-accent"
                  max={Math.max(1, questions.length)}
                  value={answered}
                />
                <div className="flex flex-wrap gap-2 mt-3">
                  {sections.map((section) => {
                    const group = questions.filter((i) => (i.category || 'Checklist') === section)
                    return (
                      <button
                        key={section}
                        className="border border-border rounded-lg px-2 py-2 text-xs text-text-2"
                        onClick={() => jump(group[0].id)}
                      >
                        {section} · {group.filter((i) => get(i.id).result).length}/{group.length}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="space-y-4">
                {items.map((item) => {
                  if (item.field_type === 'heading')
                    return (
                      <h2 key={item.id} className="text-lg font-semibold pt-5">
                        {item.description}
                      </h2>
                    )
                  const d = get(item.id),
                    ft = item.field_type || 'pass_fail',
                    policy = json(item.conditional_json),
                    options = json(item.options_json),
                    readOnly = !mayEdit || signing || review || complete.isPending
                  return (
                    <section
                      key={item.id}
                      id={'question-' + item.id}
                      tabIndex={-1}
                      className="execution-card"
                      data-invalid={!!d.error}
                      aria-label={`Question ${item.item_no}`}
                    >
                      <div className="flex gap-3">
                        <span className="text-xs font-mono text-text-2 pt-1">{item.item_no}</span>
                        <div className="flex-1 min-w-0">
                          <h2 className="text-base font-semibold">
                            {item.description}
                            {item.required !== false && (
                              <span className="text-danger" aria-label="required">
                                {' '}
                                *
                              </span>
                            )}
                          </h2>
                          {item.acceptance_criteria && (
                            <p className="text-sm text-text-2 mt-2">{item.acceptance_criteria}</p>
                          )}
                          {item.category && (
                            <p className="text-xs text-text-2 mt-1">Section: {item.category}</p>
                          )}
                        </div>
                      </div>
                      <fieldset disabled={readOnly} className="mt-4 space-y-4">
                        <legend className="sr-only">Response for {item.description}</legend>
                        {!['pass_fail', 'photo', 'signature', 'heading'].includes(ft) && (
                          <label className="field-label">
                            Response{item.unit && ` (${item.unit})`}
                            {['textarea', 'text'].includes(ft) ? (
                              <textarea
                                aria-label="Response"
                                className="field-input mt-2"
                                value={d.value}
                                onChange={(e) => update(item.id, { value: e.target.value })}
                                rows={ft === 'textarea' ? 3 : 2}
                              />
                            ) : ['dropdown', 'select'].includes(ft) ? (
                              <select
                                aria-label="Response"
                                value={d.value}
                                className="field-input mt-2"
                                onChange={(e) => update(item.id, { value: e.target.value })}
                              >
                                <option value="">Select a response</option>
                                {(Array.isArray(options) ? options : []).map((o: string) => (
                                  <option key={o}>{o}</option>
                                ))}
                              </select>
                            ) : ft === 'yes_no' ? (
                              <select
                                aria-label="Response"
                                value={d.value}
                                className="field-input mt-2"
                                onChange={(e) => update(item.id, { value: e.target.value })}
                              >
                                <option value="">Select a response</option>
                                <option>Yes</option>
                                <option>No</option>
                              </select>
                            ) : ft === 'checkbox' ? (
                              <select
                                aria-label="Response"
                                value={d.value}
                                className="field-input mt-2"
                                onChange={(e) => update(item.id, { value: e.target.value })}
                              >
                                <option value="">Select a response</option>
                                <option>Checked</option>
                                <option>Not checked</option>
                              </select>
                            ) : ft === 'multiselect' ? (
                              <div className="flex flex-wrap gap-3 mt-3">
                                {(Array.isArray(options) ? options : []).map((o: string) => (
                                  <label key={o} className="flex gap-2 items-center text-sm">
                                    <input
                                      type="checkbox"
                                      checked={
                                        Array.isArray(json(d.value)) && json(d.value).includes(o)
                                      }
                                      onChange={(e) => {
                                        const selected = Array.isArray(json(d.value))
                                          ? json(d.value)
                                          : []
                                        update(item.id, {
                                          value: JSON.stringify(
                                            e.target.checked
                                              ? [...selected, o]
                                              : selected.filter((s: string) => s !== o),
                                          ),
                                        })
                                      }}
                                    />
                                    {o}
                                  </label>
                                ))}
                              </div>
                            ) : ft === 'table' ? (
                              <TableResponse
                                item={item}
                                value={d.value}
                                onChange={(value) => update(item.id, { value })}
                              />
                            ) : (
                              <input
                                aria-label="Response"
                                className="field-input mt-2"
                                type={
                                  ['number', 'measurement'].includes(ft)
                                    ? 'number'
                                    : ft === 'date'
                                      ? 'date'
                                      : 'text'
                                }
                                step="any"
                                value={d.value}
                                onChange={(e) => update(item.id, { value: e.target.value })}
                              />
                            )}
                          </label>
                        )}
                        {ft === 'signature' && (
                          <div>
                            {d.value && (
                              <img src={d.value} className="h-14" alt="Question signature" />
                            )}
                            <Button variant="secondary" onClick={() => setItemSigning(item.id)}>
                              Capture signature
                            </Button>
                          </div>
                        )}
                        <div className="flex gap-2" aria-label="Result">
                          {(['pass', 'fail', 'na'] as Result[]).map((r) => (
                            <button
                              type="button"
                              key={r}
                              aria-pressed={d.result === r}
                              className="result-option"
                              onClick={() => update(item.id, { result: r })}
                            >
                              {r === 'pass' ? '✓ Pass' : r === 'fail' ? '× Fail' : 'N/A'}
                            </button>
                          ))}
                        </div>
                        {(d.result === 'fail' || d.result === 'na' || d.notes) && (
                          <label className="field-label">
                            {d.result === 'na'
                              ? 'N/A reason'
                              : d.result === 'fail' && policy.notesOnFail
                                ? 'Notes (required)'
                                : 'Notes'}
                            <textarea
                              aria-label={d.result === 'na' ? 'N/A reason' : 'Notes'}
                              className="field-input mt-2"
                              rows={3}
                              value={d.result === 'na' ? d.naReason : d.notes}
                              onChange={(e) =>
                                update(
                                  item.id,
                                  d.result === 'na'
                                    ? { naReason: e.target.value }
                                    : { notes: e.target.value },
                                )
                              }
                            />
                          </label>
                        )}
                        {(ft === 'photo' ||
                          d.result === 'fail' ||
                          d.photo ||
                          d.photos.length > 0) && (
                          <div>
                            <label className="field-label">
                              Photo evidence
                              {mayEdit && (
                                <input
                                  aria-label="Photo evidence"
                                  type="file"
                                  accept="image/png,image/jpeg,image/webp"
                                  className="block mt-2 text-sm w-full"
                                  onChange={(e) => void selectPhoto(item, e.target.files?.[0])}
                                />
                              )}
                            </label>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {[...d.photos, ...(d.photo ? [d.photo] : [])].map((photo, n) => (
                                <a key={n} href={photo} target="_blank" rel="noreferrer">
                                  <img
                                    src={photo}
                                    alt={`Evidence ${n + 1}`}
                                    className="h-20 w-24 rounded border border-border object-cover"
                                  />
                                </a>
                              ))}
                            </div>
                            {d.photo && (
                              <div className="flex items-center gap-3 mt-2">
                                <p className="text-sm text-warning">Photo pending save</p>
                                <button
                                  className="text-sm text-accent"
                                  onClick={() =>
                                    update(item.id, { photo: undefined, error: undefined })
                                  }
                                >
                                  Discard pending photo
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </fieldset>
                      {d.error && (
                        <p role="alert" className="text-sm text-danger mt-3">
                          {d.error}
                        </p>
                      )}
                      {!mayEdit && (
                        <p className="text-sm text-text-2 mt-3">
                          Recorded result: {d.result?.toUpperCase() || 'Unanswered'}
                          {d.value && ft !== 'signature' && ` · ${d.value}`}
                        </p>
                      )}
                    </section>
                  )
                })}
              </div>
              {mayEdit && (
                <div className="flex flex-wrap justify-between items-center gap-4 mt-6 p-4 bg-bg-2 border border-border rounded-xl">
                  <p className="text-sm text-text-2">
                    {invalid.length} required or invalid responses · {failed.length} failed items
                  </p>
                  <Button
                    variant="primary"
                    disabled={complete.isPending}
                    onClick={() => setConfirmReview(true)}
                  >
                    Review & sign
                  </Button>
                </div>
              )}
              {done && (
                <div className="execution-card mt-5">
                  <h2 className="font-semibold">Signed inspection</h2>
                  <p className="text-sm text-text-2 mt-2">
                    Recorded at{' '}
                    {new Date(record.completed_at!).toLocaleString(undefined, {
                      timeZoneName: 'short',
                    })}
                    . This inspection is locked.
                  </p>
                  {record.signature_data_url && (
                    <img
                      src={record.signature_data_url}
                      alt="Inspection signature"
                      className="h-16 mt-3"
                    />
                  )}
                  <div className="flex gap-3 mt-4">
                    <Button
                      variant="primary"
                      loading={reportBusy}
                      onClick={() => void report(false)}
                    >
                      Download report PDF
                    </Button>
                    <Button loading={reportBusy} onClick={() => void report(true)}>
                      Print report
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
      <Modal
        open={confirmReview}
        onClose={() => !busy && setConfirmReview(false)}
        title="Save your responses and continue to review?"
        footer={
          <>
            <Button disabled={busy} onClick={() => setConfirmReview(false)}>
              Keep editing
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={conflict}
              onClick={() => void saveAndReview()}
            >
              Save & review
            </Button>
          </>
        }
      >
        <p>
          Your responses and photo evidence must be saved before review. This does not sign the
          inspection.
        </p>
        {saveError && (
          <p role="alert" className="text-danger">
            {saveError}
          </p>
        )}
      </Modal>
      <Modal
        open={review}
        onClose={() => setReview(false)}
        title="Review inspection"
        footer={
          <Button
            variant="primary"
            disabled={busy || unsaved || invalid.length > 0 || answered === 0 || !reviewed.current}
            onClick={() => {
              setReview(false)
              setSigning(true)
            }}
          >
            Continue to signature
          </Button>
        }
      >
        <p className="text-sm mb-4">
          {answered}/{questions.length} answered · {failed.length} failed. Confirm your recorded
          evidence before signing as {user?.name}.
        </p>
        {questions.map((i) => (
          <div key={i.id} className="border-b border-border py-2">
            <strong>Question {i.item_no}</strong> · {i.description}
            <p>
              {get(i.id).result?.toUpperCase() || 'Unanswered'} · {get(i.id).value}
            </p>
            {get(i.id).notes && <p>Notes: {get(i.id).notes}</p>}
            {get(i.id).naReason && <p>N/A reason: {get(i.id).naReason}</p>}
            {get(i.id).photos.map((src, n) => (
              <img
                key={n}
                src={src}
                alt={'Question ' + i.item_no + ' evidence ' + (n + 1)}
                className="max-h-40"
              />
            ))}
          </div>
        ))}
        {unsaved && (
          <p role="alert" className="text-warning mb-4">
            Save all responses and photo evidence before signing.
          </p>
        )}
        {invalid.map(({ item, issue }) => (
          <button
            key={item.id}
            className="block w-full text-left text-sm text-danger py-2"
            onClick={() => jump(item.id)}
          >
            Question {item.item_no}: {issue}
          </button>
        ))}
        {failed.length > 0 && (
          <div className="mt-4">
            <h3 className="font-semibold text-danger">Failed items</h3>
            {failed.map((i) => (
              <p key={i.id} className="text-sm mt-2">
                {i.item_no} · {i.description}
                {get(i.id).notes && ` — ${get(i.id).notes}`}
              </p>
            ))}
          </div>
        )}
        {!invalid.length && !unsaved && (
          <p className="text-sm text-success mt-4">Required responses and evidence are saved.</p>
        )}
      </Modal>
      {signing && (
        <SignaturePad
          signerName={user?.name}
          error={message}
          loading={complete.isPending}
          onSave={(signature) => void sign(signature)}
          onClose={() => setSigning(false)}
        />
      )}
      {itemSigning && (
        <SignaturePad
          signerName={user?.name}
          onSave={(signature) => {
            update(itemSigning, { value: signature })
            setItemSigning(null)
          }}
          onClose={() => setItemSigning(null)}
        />
      )}
    </AppLayout>
  )
}
function TableResponse({
  item,
  value,
  onChange,
}: {
  item: Item
  value: string
  onChange: (v: string) => void
}) {
  const layout = json(item.layout_json),
    columns = Array.isArray(layout.tableColumns) ? layout.tableColumns : ['Item', 'Observation'],
    rows = Math.min(30, Math.max(1, Number(layout.tableRows) || 3)),
    data = json(value)
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {columns.map((c: string, i: number) => (
              <th key={i} className="p-2 text-left">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {columns.map((c: string, i: number) => (
                <td key={i} className="p-1">
                  <input
                    aria-label={`${c}, row ${r + 1}`}
                    className="field-input"
                    value={data[`${r}:${i}`] || ''}
                    onChange={(e) =>
                      onChange(JSON.stringify({ ...data, [`${r}:${i}`]: e.target.value }))
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
