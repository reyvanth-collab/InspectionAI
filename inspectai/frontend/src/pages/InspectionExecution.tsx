import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SignaturePad } from '@/components/ui/SignaturePad'
import { History } from '@/components/ui/History'
import { useWorkOrder } from '@/hooks/useWorkOrders'
import {
  useInspectionRecord,
  useStartInspection,
  useRecordFinding,
  useAttachFindingPhoto,
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
  photos: string[]
  photo?: string
  dirty: boolean
  saving: boolean
  error?: string
  saved?: boolean
}
const empty = (): Draft => ({ value: '', notes: '', photos: [], dirty: false, saving: false })
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
    return (item.required !== false || policy.naReasonRequired) && !d.notes.trim()
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
    { data: record, refetch: refreshRecord } = useInspectionRecord(id)
  const start = useStartInspection(),
    saveFinding = useRecordFinding(),
    attach = useAttachFindingPhoto(),
    complete = useCompleteInspection()
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [message, setMessage] = useState(''),
    [review, setReview] = useState(false),
    [signing, setSigning] = useState(false),
    [itemSigning, setItemSigning] = useState<string | null>(null),
    [tab, setTab] = useState('checklist')
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
    if (!record) return
    setDrafts((prev) => {
      const next = { ...prev }
      for (const f of record.inspection_findings || []) {
        if (!next[f.checklist_item_id] || !next[f.checklist_item_id].dirty) {
          next[f.checklist_item_id] = {
            ...empty(),
            result: f.result || undefined,
            value: f.captured_value || '',
            notes: f.notes || '',
            photos: f.photo_urls || [],
            saved: true,
          }
        }
      }
      return next
    })
  }, [record])
  const get = (key: string) => drafts[key] || empty()
  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || empty()), ...patch, dirty: true, saved: false, error: undefined },
    }))
  const setState = (key: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] || empty()), ...patch } }))
  const busy = Object.values(drafts).some((d) => d.saving),
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
    document
      .getElementById('question-' + key)
      ?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
    document.getElementById('question-' + key)?.focus()
  }
  async function save(item: Item) {
    const d = get(item.id),
      issue = problem(item, d)
    if (issue) {
      setState(item.id, { error: issue })
      return
    }
    if (!record || !d.result) return
    setState(item.id, { saving: true, error: undefined })
    try {
      let photos = d.photos
      if (d.photo) {
        const f = await attach.mutateAsync({
          workOrderDbId: id,
          inspectionRecordId: record.id,
          checklistItemId: item.id,
          imageDataUrl: d.photo,
        })
        photos = f.photo_urls || []
        setState(item.id, { photo: undefined, photos })
      }
      await saveFinding.mutateAsync({
        workOrderDbId: id,
        inspectionRecordId: record.id,
        checklistItemId: item.id,
        result: d.result,
        notes: d.notes,
        capturedValue: d.value,
      })
      setState(item.id, { saving: false, dirty: false, saved: true, error: undefined, photos })
    } catch (e) {
      setState(item.id, {
        saving: false,
        error: e instanceof Error ? e.message : 'Save failed. Try again.',
      })
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
    if (!record || busy || unsaved || invalid.length || complete.isPending) return
    setMessage('')
    try {
      await complete.mutateAsync({
        workOrderDbId: id,
        inspectionRecordId: record.id,
        signatureDataUrl,
      })
      setSigning(false)
      setReview(false)
      await Promise.all([refreshWO(), refreshRecord()])
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : 'Inspection could not be signed. Your saved responses are retained.',
      )
    }
  }
  if (isLoading)
    return (
      <AppLayout>
        <p>Loading inspection…</p>
      </AppLayout>
    )
  if (!wo || loadError)
    return (
      <AppLayout>
        <p role="alert">This inspection is unavailable or you do not have access.</p>
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
              {busy ? 'Saving…' : unsaved ? 'Unsaved changes' : 'All changes saved'}
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
                    readOnly = !mayEdit || d.saving
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
                              value={d.notes}
                              onChange={(e) => update(item.id, { notes: e.target.value })}
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
                                    setState(item.id, { photo: undefined, error: undefined })
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
                      {mayEdit && (
                        <div className="flex items-center justify-between gap-3 mt-4">
                          <span role="status" className="text-xs text-text-2">
                            {d.saving
                              ? 'Saving…'
                              : d.error
                                ? 'Save failed — your response is retained'
                                : d.dirty
                                  ? 'Unsaved changes'
                                  : d.saved
                                    ? 'Saved'
                                    : 'Not answered'}
                          </span>
                          <Button
                            variant="secondary"
                            loading={d.saving}
                            disabled={!d.result || (!d.dirty && !d.error)}
                            onClick={() => void save(item)}
                          >
                            {d.error ? 'Retry save' : 'Save response'}
                          </Button>
                        </div>
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
                    disabled={busy || complete.isPending}
                    onClick={() => setReview(true)}
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
                  <Button variant="secondary" className="mt-4" onClick={() => window.print()}>
                    Print / save PDF
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
      <Modal
        open={review}
        onClose={() => setReview(false)}
        title="Review inspection"
        footer={
          <Button
            variant="primary"
            disabled={busy || unsaved || invalid.length > 0 || answered === 0}
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
