import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { type LucideIcon, GripVertical, Trash2, Copy, Eye, ArrowLeft, X,
         CheckSquare, Type, Hash, ChevronDown, ToggleLeft, Calendar,
         Ruler, Camera, AlignLeft, PenLine, AlignJustify,
         CheckCheck, AlertCircle, Zap, Settings2, ChevronRight } from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopNav } from '@/components/layout/TopNav'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useSaveWIWithItems, useWIBuilderData } from '@/hooks/useWorkInstructions'
import { cn } from '@/lib/cn'

// ── Field types ──────────────────────────────────────────────────
export type FieldType =
  | 'pass_fail' | 'text' | 'number' | 'dropdown' | 'yes_no'
  | 'multiselect' | 'date' | 'measurement' | 'photo' | 'textarea'
  | 'signature' | 'heading'

export interface WIField {
  id:                 string
  type:               FieldType
  label:              string
  acceptanceCriteria: string
  required:           boolean
  placeholder:        string
  optionsText:        string   // newline-separated, for dropdown/multiselect
  unit:               string
  minValue:           string
  maxValue:           string
  conditional: { fieldId: string; operator: 'equals' | 'not_equals' | 'contains'; value: string } | null
}

interface WIMeta {
  wiNumber:      string
  title:         string
  category:      string
  revision:      string
  effectiveDate: string
  expiryDate:    string
}

// ── Field palette definition ─────────────────────────────────────
const PALETTE: { type: FieldType; label: string; desc: string; Icon: LucideIcon }[] = [
  { type: 'pass_fail',   label: 'Pass / Fail / NA', desc: 'Inspector marks result',    Icon: CheckSquare  },
  { type: 'text',        label: 'Text input',        desc: 'Free text answer',          Icon: Type         },
  { type: 'number',      label: 'Number',            desc: 'Numeric with min/max',      Icon: Hash         },
  { type: 'dropdown',    label: 'Dropdown',          desc: 'Select from options',       Icon: ChevronDown  },
  { type: 'yes_no',      label: 'Yes / No',          desc: 'Boolean toggle',            Icon: ToggleLeft   },
  { type: 'multiselect', label: 'Multi-select',      desc: 'Multiple choices',          Icon: CheckCheck   },
  { type: 'date',        label: 'Date / Time',        desc: 'Date picker',               Icon: Calendar     },
  { type: 'measurement', label: 'Measurement',        desc: 'Value + unit',              Icon: Ruler        },
  { type: 'photo',       label: 'Photo capture',      desc: 'Camera capture',            Icon: Camera       },
  { type: 'textarea',    label: 'Long text',          desc: 'Multi-line notes',          Icon: AlignLeft    },
  { type: 'signature',   label: 'Signature',          desc: 'Sign pad',                  Icon: PenLine      },
  { type: 'heading',     label: 'Section heading',    desc: 'Visual divider / grouper',  Icon: AlignJustify },
]

const TYPE_LABEL: Record<FieldType, string> = {
  pass_fail: 'pass/fail', text: 'text', number: 'number', dropdown: 'dropdown',
  yes_no: 'yes/no', multiselect: 'multi', date: 'date', measurement: 'measure',
  photo: 'photo', textarea: 'long text', signature: 'signature', heading: 'heading',
}

const UNITS = ['mm','cm','m','kg','kN','A','V','Ω','bar','PSI','°C','°F','%','rpm','Hz']

function makeField(type: FieldType, sortOrder: number): WIField {
  const defaultLabel: Record<FieldType, string> = {
    pass_fail:   'Inspection item', text: 'Enter text',
    number:      'Enter value', dropdown: 'Select option',
    yes_no:      'Yes or No', multiselect: 'Select all that apply',
    date:        'Enter date', measurement: 'Measurement',
    photo:       'Attach photo', textarea: 'Additional notes',
    signature:   'Inspector signature', heading: 'Section',
  }
  return {
    id:                 crypto.randomUUID(),
    type,
    label:              defaultLabel[type],
    acceptanceCriteria: '',
    required:           type !== 'heading',
    placeholder:        '',
    optionsText:        '',
    unit:               type === 'measurement' ? 'mm' : '',
    minValue:           '',
    maxValue:           '',
    conditional:        null,
    // sortOrder is stored externally in the array index
  }
  void sortOrder  // used externally
}

// ── Main component ───────────────────────────────────────────────
export default function WIBuilder() {
  const navigate      = useNavigate()
  const { id: editId } = useParams<{ id?: string }>()
  const { toast }     = useToast()
  const isEdit        = !!editId

  const [meta, setMeta] = useState<WIMeta>({
    wiNumber: '', title: 'New Work Instruction', category: '',
    revision: 'Rev 1', effectiveDate: '', expiryDate: '',
  })
  const [fields,     setFields]     = useState<WIField[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showPreview,setShowPreview]= useState(false)
  const [editingTitle, setEditingTitle] = useState(false)

  // Drag state
  const dragTypeRef    = useRef<FieldType | null>(null)   // dragging from palette
  const dragFieldIdRef = useRef<string | null>(null)       // reordering canvas
  const [dragOverIdx,  setDragOverIdx] = useState<number | null>(null)

  // Load existing WI when editing
  const { data: existingData, isLoading: loadingExisting } = useWIBuilderData(editId)
  const saveWI = useSaveWIWithItems()

  useEffect(() => {
    if (!existingData) return
    setMeta({
      wiNumber:      String(existingData.wi_number      ?? ''),
      title:         String(existingData.title          ?? ''),
      category:      String(existingData.category       ?? ''),
      revision:      String(existingData.revision       ?? 'Rev 1'),
      effectiveDate: String(existingData.effective_date ?? ''),
      expiryDate:    String(existingData.expiry_date    ?? ''),
    })
    const existingItems = existingData.wi_checklist_items as Record<string, unknown>[] | undefined
    if (existingItems?.length) {
      setFields(existingItems.map((item: Record<string, unknown>) => ({
        id:                 item.id as string,
        type:               (item.field_type as FieldType) ?? 'pass_fail',
        label:              (item.description as string) ?? '',
        acceptanceCriteria: (item.acceptance_criteria as string) ?? '',
        required:           item.required !== false,
        placeholder:        (item.placeholder as string) ?? '',
        optionsText:        item.options_json ? (JSON.parse(item.options_json as string) as string[]).join('\n') : '',
        unit:               (item.unit as string) ?? '',
        minValue:           item.min_value != null ? String(item.min_value) : '',
        maxValue:           item.max_value != null ? String(item.max_value) : '',
        conditional:        item.conditional_json ? JSON.parse(item.conditional_json as string) as WIField['conditional'] : null,
      })))
    }
  }, [existingData])

  // ── Field operations ──────────────────────────────────────────
  const addField = useCallback((type: FieldType, atIndex?: number) => {
    const f = makeField(type, 0)
    setFields(prev => {
      const next = [...prev]
      const idx  = atIndex != null ? atIndex : next.length
      next.splice(idx, 0, f)
      return next
    })
    setSelectedId(f.id)
  }, [])

  const updateField = useCallback((id: string, updates: Partial<WIField>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))
  }, [])

  const deleteField = useCallback((id: string) => {
    setFields(prev => prev.filter(f => f.id !== id))
    setSelectedId(s => s === id ? null : s)
  }, [])

  const duplicateField = useCallback((id: string) => {
    setFields(prev => {
      const idx = prev.findIndex(f => f.id === id)
      if (idx < 0) return prev
      const clone: WIField = { ...prev[idx], id: crypto.randomUUID() }
      const next = [...prev]
      next.splice(idx + 1, 0, clone)
      return next
    })
  }, [])

  // ── Drag handlers ─────────────────────────────────────────────
  const handleCanvasDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    setDragOverIdx(idx)
  }

  const handleCanvasDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault()
    setDragOverIdx(null)

    const fromType = dragTypeRef.current
    if (fromType) {
      dragTypeRef.current = null
      addField(fromType, dropIdx)
      return
    }

    const fromId = dragFieldIdRef.current
    if (fromId) {
      dragFieldIdRef.current = null
      setFields(prev => {
        const fromIdx = prev.findIndex(f => f.id === fromId)
        if (fromIdx < 0 || fromIdx === dropIdx) return prev
        const next = [...prev]
        const [moved] = next.splice(fromIdx, 1)
        const insertAt = dropIdx > fromIdx ? dropIdx - 1 : dropIdx
        next.splice(insertAt, 0, moved)
        return next
      })
    }
  }

  // ── Save ──────────────────────────────────────────────────────
  const handleSave = async (publish: boolean) => {
    if (!meta.wiNumber.trim()) { toast('WI number is required', 'error'); return }
    if (!meta.title.trim())    { toast('Title is required', 'error'); return }

    const checklistItems = fields.map((f, i) => ({
      itemNo:              String(i + 1),
      description:         f.label,
      acceptanceCriteria:  f.acceptanceCriteria || undefined,
      fieldType:           f.type,
      required:            f.required,
      placeholder:         f.placeholder || undefined,
      optionsJson:         f.optionsText ? JSON.stringify(f.optionsText.split('\n').map(s => s.trim()).filter(Boolean)) : undefined,
      unit:                f.unit || undefined,
      minValue:            f.minValue !== '' ? Number(f.minValue) : undefined,
      maxValue:            f.maxValue !== '' ? Number(f.maxValue) : undefined,
      conditionalJson:     f.conditional ? JSON.stringify(f.conditional) : undefined,
      sortOrder:           i * 10,
    }))

    try {
      await saveWI.mutateAsync({
        dbId:          editId,
        wiNumber:      meta.wiNumber,
        title:         meta.title,
        category:      meta.category,
        revision:      meta.revision,
        effectiveDate: meta.effectiveDate,
        expiryDate:    meta.expiryDate,
        status:        publish ? 'active' : 'draft',
        checklistItems,
      })
      toast(publish ? 'Published!' : 'Saved as draft', 'success')
      navigate('/library')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error')
    }
  }

  const selectedField = fields.find(f => f.id === selectedId) ?? null
  const requiredCount = fields.filter(f => f.required && f.type !== 'heading').length

  if (loadingExisting) {
    return (
      <div className="flex h-screen overflow-hidden bg-bg">
        <Sidebar />
        <div className="flex flex-col flex-1 items-center justify-center">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopNav breadcrumb={[
          { label: 'Master Library', path: '/library' },
          { label: isEdit ? 'Edit WI' : 'New WI' },
        ]} />

        {/* ── Builder top bar ───────────────────────────────────── */}
        <div className="h-14 flex items-center gap-3 px-4 border-b border-border bg-bg-2 flex-shrink-0">
          <button onClick={() => navigate('/library')}
            className="flex items-center gap-1.5 text-[12px] text-text-3 hover:text-text transition-colors bg-transparent border-none cursor-pointer p-0 flex-shrink-0">
            <ArrowLeft size={14} /> Library
          </button>
          <div className="w-px h-4 bg-border flex-shrink-0" />

          {/* Editable title */}
          {editingTitle ? (
            <input
              autoFocus
              value={meta.title}
              onChange={e => setMeta(p => ({ ...p, title: e.target.value }))}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={e => e.key === 'Enter' && setEditingTitle(false)}
              className="flex-1 min-w-0 bg-transparent border-b border-accent text-[14px] font-semibold text-text outline-none py-0.5"
            />
          ) : (
            <button onClick={() => setEditingTitle(true)}
              className="flex-1 min-w-0 text-left text-[14px] font-semibold text-text hover:text-accent transition-colors bg-transparent border-none cursor-pointer truncate p-0">
              {meta.title}
            </button>
          )}

          {/* WI number */}
          <input
            value={meta.wiNumber}
            onChange={e => setMeta(p => ({ ...p, wiNumber: e.target.value }))}
            placeholder="WI-XX-000"
            className="w-28 px-2 py-1 bg-bg border border-border-2 rounded-[6px] text-[12px] font-mono text-accent outline-none focus:border-accent placeholder:text-text-3 flex-shrink-0"
          />

          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setShowPreview(true)}>
              <Eye size={14} className="mr-1" /> Preview
            </Button>
            <Button variant="secondary" size="sm" loading={saveWI.isPending} onClick={() => handleSave(false)}>
              Save draft
            </Button>
            <Button variant="primary" size="sm" loading={saveWI.isPending} onClick={() => handleSave(true)}>
              Save &amp; publish
            </Button>
          </div>
        </div>

        {/* ── 3-panel layout ────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* LEFT — Palette */}
          <div className="w-[220px] flex-shrink-0 border-r border-border bg-bg-2 overflow-y-auto">
            <div className="px-3 pt-3 pb-1">
              <p className="text-[9px] font-semibold text-text-3 uppercase tracking-[0.12em]">Field types</p>
            </div>
            {PALETTE.map(({ type, label, desc, Icon }) => (
              <div key={type}
                draggable
                onDragStart={() => { dragTypeRef.current = type }}
                onDragEnd={() => { dragTypeRef.current = null }}
                onClick={() => addField(type)}
                className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border cursor-grab hover:bg-bg-3 active:bg-bg-3 transition-colors select-none last:border-0">
                <Icon size={14} className="text-accent flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-text leading-tight truncate">{label}</p>
                  <p className="text-[10px] text-text-3 leading-tight truncate">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* CENTER — Canvas */}
          <div className="flex-1 flex flex-col overflow-hidden bg-bg">
            {/* Canvas header */}
            <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
              <span className="text-[12px] font-semibold text-text">Checklist canvas</span>
              <span className="text-[11px] text-text-3">
                {fields.length} field{fields.length !== 1 ? 's' : ''}
                {requiredCount > 0 && ` · ${requiredCount} required`}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Meta row */}
              <div className="flex gap-3 px-5 py-3 border-b border-border bg-bg-2 flex-wrap">
                {[
                  { key: 'category',      label: 'Category',       placeholder: 'e.g. Electrical',  width: 'flex-1 min-w-[120px]' },
                  { key: 'revision',      label: 'Revision',       placeholder: 'Rev 1',             width: 'w-28' },
                  { key: 'effectiveDate', label: 'Effective',      placeholder: '',                  width: 'w-36', type: 'date' },
                  { key: 'expiryDate',    label: 'Expires',        placeholder: '',                  width: 'w-36', type: 'date' },
                ].map(f => (
                  <div key={f.key} className={f.width}>
                    <label className="block text-[9px] text-text-3 uppercase tracking-[0.09em] mb-0.5 font-semibold">{f.label}</label>
                    <input
                      type={(f as { type?: string }).type ?? 'text'}
                      value={meta[f.key as keyof WIMeta]}
                      onChange={e => setMeta(p => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full px-2 py-1 bg-bg border border-border rounded-[6px] text-[12px] text-text outline-none focus:border-accent placeholder:text-text-3"
                    />
                  </div>
                ))}
              </div>

              {/* Drop zone + field list */}
              <div
                className="min-h-[200px] p-4"
                onDragOver={e => { e.preventDefault(); if (dragOverIdx === null) setDragOverIdx(fields.length) }}
                onDrop={e => handleCanvasDrop(e, fields.length)}
                onDragLeave={() => setDragOverIdx(null)}>

                {fields.length === 0 && dragOverIdx === null && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-20 h-20 rounded-[16px] border-2 border-dashed border-border-2 flex items-center justify-center mb-4 text-text-3">
                      <Settings2 size={28} />
                    </div>
                    <p className="text-[13px] font-medium text-text-2">Drag fields here to build your checklist</p>
                    <p className="text-[12px] text-text-3 mt-1">or click any field type on the left</p>
                  </div>
                )}

                {fields.map((field, idx) => (
                  <div key={field.id}>
                    {/* Drop indicator above */}
                    {dragOverIdx === idx && (
                      <div className="h-0.5 bg-accent rounded-full mx-2 my-1 transition-all" />
                    )}

                    <CanvasFieldRow
                      field={field}
                      isSelected={selectedId === field.id}
                      onSelect={() => setSelectedId(field.id)}
                      onDuplicate={() => duplicateField(field.id)}
                      onDelete={() => deleteField(field.id)}
                      onDragStart={() => { dragFieldIdRef.current = field.id }}
                      onDragEnd={() => { dragFieldIdRef.current = null; setDragOverIdx(null) }}
                      onDragOver={e => handleCanvasDragOver(e, idx)}
                      onDrop={e => handleCanvasDrop(e, idx)}
                    />
                  </div>
                ))}

                {/* Drop indicator at end */}
                {dragOverIdx === fields.length && fields.length > 0 && (
                  <div className="h-0.5 bg-accent rounded-full mx-2 mt-1 transition-all" />
                )}
              </div>
            </div>
          </div>

          {/* RIGHT — Properties */}
          <div className="w-[280px] flex-shrink-0 border-l border-border bg-bg-2 overflow-y-auto">
            {selectedField
              ? <PropertiesPanel field={selectedField} allFields={fields} onChange={updateField} onDelete={deleteField} />
              : (
                <div className="flex flex-col items-center justify-center h-full py-16 text-center px-4">
                  <ChevronRight size={24} className="text-border-2 mb-3 rotate-180" />
                  <p className="text-[12px] text-text-3">Select a field to configure it</p>
                </div>
              )
            }
          </div>
        </div>
      </div>

      {/* Preview modal */}
      {showPreview && (
        <PreviewModal meta={meta} fields={fields} onClose={() => setShowPreview(false)} />
      )}
    </div>
  )
}

// ── Canvas field row ─────────────────────────────────────────────
function CanvasFieldRow({
  field, isSelected,
  onSelect, onDuplicate, onDelete,
  onDragStart, onDragEnd, onDragOver, onDrop,
}: {
  field: WIField; isSelected: boolean
  onSelect: () => void; onDuplicate: () => void; onDelete: () => void
  onDragStart: () => void; onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void
}) {
  const palette = PALETTE.find(p => p.type === field.type)
  const Icon = palette?.Icon ?? CheckSquare

  if (field.type === 'heading') {
    return (
      <div
        draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
        onDragOver={onDragOver} onDrop={onDrop}
        onClick={onSelect}
        className={cn(
          'flex items-center gap-2 px-3 py-2 mb-1 rounded-[8px] border cursor-pointer transition-all group',
          isSelected ? 'border-accent bg-accent/10 border-l-2' : 'border-transparent hover:border-border bg-bg-3'
        )}>
        <GripVertical size={14} className="text-border-2 cursor-grab flex-shrink-0" />
        <AlignJustify size={13} className="text-text-2 flex-shrink-0" />
        <span className="flex-1 text-[12px] font-bold text-text uppercase tracking-[0.06em]">{field.label}</span>
        <span className="text-[9px] font-semibold text-text-3 bg-bg-2 rounded px-1.5 py-0.5 uppercase">heading</span>
        <div className="hidden group-hover:flex items-center gap-0.5">
          <button onClick={e => { e.stopPropagation(); onDuplicate() }}
            className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-text hover:bg-border/30 bg-transparent border-none cursor-pointer">
            <Copy size={12} />
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-danger hover:bg-danger/10 bg-transparent border-none cursor-pointer">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      onDragOver={onDragOver} onDrop={onDrop}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2.5 px-3 py-3 mb-1 rounded-[8px] border cursor-pointer transition-all group',
        isSelected
          ? 'border-accent border-l-[3px] bg-accent/5'
          : 'border-border hover:border-border-2 bg-bg hover:bg-bg-2'
      )}>
      <GripVertical size={14} className="text-border-2 cursor-grab flex-shrink-0" />
      <Icon size={14} className={cn('flex-shrink-0', isSelected ? 'text-accent' : 'text-text-3')} />
      <span className="flex-1 text-[13px] text-text truncate">{field.label}</span>
      <span className="text-[9px] font-semibold text-text-3 bg-bg-3 rounded px-1.5 py-0.5 uppercase flex-shrink-0">
        {TYPE_LABEL[field.type]}
      </span>
      {field.required && (
        <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" title="Required" />
      )}
      {field.conditional && (
        <span className="text-[9px] font-semibold text-violet-400 bg-violet-500/10 ring-1 ring-violet-500/20 rounded px-1.5 py-0.5 flex-shrink-0">
          cond
        </span>
      )}
      <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
        <button onClick={e => { e.stopPropagation(); onDuplicate() }}
          className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-text hover:bg-border/30 bg-transparent border-none cursor-pointer">
          <Copy size={12} />
        </button>
        <button onClick={e => { e.stopPropagation(); onDelete() }}
          className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-danger hover:bg-danger/10 bg-transparent border-none cursor-pointer">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Properties panel ─────────────────────────────────────────────
function PropertiesPanel({
  field, allFields, onChange, onDelete,
}: {
  field: WIField; allFields: WIField[]
  onChange: (id: string, updates: Partial<WIField>) => void
  onDelete: (id: string) => void
}) {
  const upd = (updates: Partial<WIField>) => onChange(field.id, updates)
  const otherFields = allFields.filter(f => f.id !== field.id && f.type !== 'heading')

  const SECTION = 'px-4 py-3 border-b border-border'
  const LABEL   = 'block text-[10px] font-semibold text-text-3 uppercase tracking-[0.09em] mb-1'
  const INPUT   = 'w-full px-2.5 py-1.5 bg-bg border border-border rounded-[6px] text-[12px] text-text outline-none focus:border-accent placeholder:text-text-3 transition-colors'

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <p className="text-[11px] font-semibold text-text">
          {PALETTE.find(p => p.type === field.type)?.label ?? field.type}
        </p>
        <p className="text-[10px] text-text-3 mt-0.5">Field configuration</p>
      </div>

      {/* Label */}
      <div className={SECTION}>
        <label className={LABEL}>Label</label>
        <input
          autoFocus
          value={field.label}
          onChange={e => upd({ label: e.target.value })}
          className={INPUT}
          placeholder="Field label…"
        />
        <p className="text-[10px] text-text-3 mt-1">Shown to inspector during inspection</p>
      </div>

      {/* Acceptance criteria (not for heading, photo, signature) */}
      {!['heading', 'photo', 'signature'].includes(field.type) && (
        <div className={SECTION}>
          <label className={LABEL}>Acceptance criteria</label>
          <textarea
            value={field.acceptanceCriteria}
            onChange={e => upd({ acceptanceCriteria: e.target.value })}
            rows={2}
            placeholder="What constitutes a pass? e.g. Gap &lt; 6mm"
            className={INPUT + ' resize-none'}
          />
        </div>
      )}

      {/* Required toggle */}
      {field.type !== 'heading' && (
        <div className={SECTION}>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <div
              onClick={() => upd({ required: !field.required })}
              className={cn(
                'w-8 h-4 rounded-full transition-colors cursor-pointer flex-shrink-0 relative',
                field.required ? 'bg-accent' : 'bg-border-2'
              )}>
              <div className={cn(
                'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform',
                field.required ? 'translate-x-4' : 'translate-x-0.5'
              )} />
            </div>
            <span className="text-[12px] text-text">Required</span>
          </label>
          <p className="text-[10px] text-text-3 mt-1">Inspector cannot skip this field</p>
        </div>
      )}

      {/* Type-specific settings */}
      {['text', 'textarea'].includes(field.type) && (
        <div className={SECTION}>
          <label className={LABEL}>Placeholder text</label>
          <input value={field.placeholder} onChange={e => upd({ placeholder: e.target.value })}
            className={INPUT} placeholder="Hint shown inside the field…" />
        </div>
      )}

      {field.type === 'number' && (
        <div className={SECTION}>
          <label className={LABEL}>Range</label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-text-3 mb-0.5">Min</p>
              <input type="number" value={field.minValue} onChange={e => upd({ minValue: e.target.value })}
                className={INPUT} placeholder="0" />
            </div>
            <div>
              <p className="text-[10px] text-text-3 mb-0.5">Max</p>
              <input type="number" value={field.maxValue} onChange={e => upd({ maxValue: e.target.value })}
                className={INPUT} placeholder="100" />
            </div>
          </div>
        </div>
      )}

      {field.type === 'measurement' && (
        <div className={SECTION}>
          <label className={LABEL}>Unit</label>
          <select value={field.unit} onChange={e => upd({ unit: e.target.value })}
            className={INPUT}>
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <p className="text-[10px] text-text-3 mb-0.5">Min value</p>
              <input type="number" value={field.minValue} onChange={e => upd({ minValue: e.target.value })}
                className={INPUT} placeholder="0" />
            </div>
            <div>
              <p className="text-[10px] text-text-3 mb-0.5">Max value</p>
              <input type="number" value={field.maxValue} onChange={e => upd({ maxValue: e.target.value })}
                className={INPUT} placeholder="100" />
            </div>
          </div>
        </div>
      )}

      {['dropdown', 'multiselect'].includes(field.type) && (
        <div className={SECTION}>
          <label className={LABEL}>Options (one per line)</label>
          <textarea
            value={field.optionsText}
            onChange={e => upd({ optionsText: e.target.value })}
            rows={4}
            placeholder={"Option A\nOption B\nOption C"}
            className={INPUT + ' resize-none font-mono text-[11px]'}
          />
        </div>
      )}

      {/* Conditional logic */}
      {field.type !== 'heading' && otherFields.length > 0 && (
        <div className={SECTION}>
          <label className={LABEL}>
            <Zap size={10} className="inline mr-1 text-violet-400" />
            Conditional logic
          </label>
          <select
            value={field.conditional?.fieldId ?? ''}
            onChange={e => {
              const fieldId = e.target.value
              upd({ conditional: fieldId ? { fieldId, operator: 'equals', value: '' } : null })
            }}
            className={INPUT}>
            <option value="">Always visible</option>
            {otherFields.map(f => (
              <option key={f.id} value={f.id}>{f.label.slice(0, 40)}</option>
            ))}
          </select>
          {field.conditional && (
            <div className="mt-2 flex gap-1.5">
              <select
                value={field.conditional.operator}
                onChange={e => upd({ conditional: { ...field.conditional!, operator: e.target.value as 'equals' | 'not_equals' | 'contains' } })}
                className={INPUT + ' flex-1'}>
                <option value="equals">equals</option>
                <option value="not_equals">does not equal</option>
                <option value="contains">contains</option>
              </select>
              <input
                value={field.conditional.value}
                onChange={e => upd({ conditional: { ...field.conditional!, value: e.target.value } })}
                className={INPUT + ' flex-1'} placeholder="value" />
            </div>
          )}
        </div>
      )}

      {/* Delete */}
      {field.type !== 'heading' && (
        <div className="px-4 py-3">
          <button
            onClick={() => onDelete(field.id)}
            className="w-full px-3 py-1.5 text-[12px] text-danger border border-danger/30 rounded-[6px] hover:bg-danger/10 bg-transparent cursor-pointer transition-colors">
            Delete field
          </button>
        </div>
      )}
    </div>
  )
}

// ── Preview modal ─────────────────────────────────────────────────
function PreviewModal({ meta, fields, onClose }: { meta: WIMeta; fields: WIField[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-bg border border-border rounded-[16px] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <p className="text-[14px] font-semibold text-text">Inspector preview</p>
            <p className="text-[11px] text-text-3 mt-0.5">Exactly what the inspector sees</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[6px] text-text-3 hover:text-text hover:bg-bg-2 bg-transparent border-none cursor-pointer transition-all">
            <X size={16} />
          </button>
        </div>

        {/* WO info mock */}
        <div className="px-6 pt-4 pb-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-accent bg-accent/10 px-2 py-0.5 rounded">{meta.wiNumber || 'WI-XXX'}</span>
            <span className="text-[13px] font-semibold text-text">{meta.title}</span>
            <span className="text-[11px] text-text-3">{meta.revision}</span>
          </div>
        </div>

        {/* Fields preview */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {fields.length === 0 && (
            <p className="text-[13px] text-text-3 text-center py-8">No fields added yet</p>
          )}

          {fields.map((field, idx) => (
            <PreviewField key={field.id} field={field} index={idx} />
          ))}
        </div>
      </div>
    </div>
  )
}

function PreviewField({ field, index }: { field: WIField; index: number }) {
  if (field.type === 'heading') {
    return (
      <div className="flex items-center gap-3 mt-2">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[11px] font-bold text-text uppercase tracking-[0.08em] whitespace-nowrap">{field.label}</span>
        <div className="flex-1 h-px bg-border" />
      </div>
    )
  }

  const INPUT_CLS = 'w-full px-3 py-2 bg-bg-2 border border-border rounded-[8px] text-[13px] text-text outline-none placeholder:text-text-3'

  return (
    <div className="bg-bg-2 border border-border rounded-[10px] p-4">
      <div className="flex items-start gap-2 mb-3">
        <span className="font-mono text-[10px] text-text-3 pt-0.5 w-5 flex-shrink-0">{index + 1}</span>
        <div className="flex-1">
          <p className="text-[13px] font-medium text-text">{field.label}</p>
          {field.acceptanceCriteria && (
            <p className="text-[11px] text-text-3 italic mt-0.5">{field.acceptanceCriteria}</p>
          )}
          {field.conditional && (
            <span className="inline-block mt-1 text-[9px] font-semibold text-violet-400 bg-violet-500/10 ring-1 ring-violet-500/20 rounded px-1.5 py-0.5">
              conditional
            </span>
          )}
        </div>
        {field.required && <AlertCircle size={12} className="text-danger flex-shrink-0 mt-0.5" />}
      </div>

      {field.type === 'pass_fail' && (
        <div className="flex gap-2">
          {[
            { label: 'PASS', cls: 'border-success/40 text-success hover:bg-success/10' },
            { label: 'FAIL', cls: 'border-danger/40 text-danger hover:bg-danger/10' },
            { label: 'N/A',  cls: 'border-border-2 text-text-3 hover:bg-bg-3' },
          ].map(b => (
            <button key={b.label}
              className={`flex-1 h-11 rounded-[8px] border text-[12px] font-semibold bg-transparent cursor-pointer transition-colors ${b.cls}`}>
              {b.label}
            </button>
          ))}
        </div>
      )}

      {field.type === 'yes_no' && (
        <div className="flex gap-2">
          {[{ label: 'Yes', cls: 'border-success/40 text-success hover:bg-success/10' },
            { label: 'No',  cls: 'border-danger/40 text-danger hover:bg-danger/10' }].map(b => (
            <button key={b.label}
              className={`flex-1 h-11 rounded-[8px] border text-[12px] font-semibold bg-transparent cursor-pointer transition-colors ${b.cls}`}>
              {b.label}
            </button>
          ))}
        </div>
      )}

      {field.type === 'text' && (
        <input className={INPUT_CLS} placeholder={field.placeholder || 'Enter text…'} readOnly />
      )}

      {field.type === 'textarea' && (
        <textarea className={INPUT_CLS + ' resize-none'} rows={3}
          placeholder={field.placeholder || 'Enter notes…'} readOnly />
      )}

      {field.type === 'number' && (
        <div className="flex items-center gap-2">
          <input type="number" className={INPUT_CLS} placeholder="0" readOnly />
          {(field.minValue || field.maxValue) && (
            <span className="text-[11px] text-text-3 whitespace-nowrap">
              {field.minValue && `min ${field.minValue}`}
              {field.minValue && field.maxValue && ' – '}
              {field.maxValue && `max ${field.maxValue}`}
            </span>
          )}
        </div>
      )}

      {field.type === 'measurement' && (
        <div className="flex items-center gap-2">
          <input type="number" className={INPUT_CLS} placeholder="0.0" readOnly />
          <span className="px-3 py-2 bg-bg-3 border border-border rounded-[8px] text-[12px] font-mono text-text-2 whitespace-nowrap">
            {field.unit || 'unit'}
          </span>
        </div>
      )}

      {field.type === 'dropdown' && (
        <select className={INPUT_CLS}>
          <option value="">Select…</option>
          {field.optionsText.split('\n').filter(Boolean).map((opt, i) => (
            <option key={i} value={opt}>{opt}</option>
          ))}
        </select>
      )}

      {field.type === 'multiselect' && (
        <div className="flex flex-col gap-2">
          {field.optionsText.split('\n').filter(Boolean).map((opt, i) => (
            <label key={i} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded" readOnly />
              <span className="text-[12px] text-text">{opt}</span>
            </label>
          ))}
          {!field.optionsText && <p className="text-[12px] text-text-3 italic">No options defined</p>}
        </div>
      )}

      {field.type === 'date' && (
        <input type="date" className={INPUT_CLS} readOnly />
      )}

      {field.type === 'photo' && (
        <div className="flex flex-col items-center justify-center py-6 rounded-[8px] border-2 border-dashed border-border-2 text-text-3 gap-2">
          <Camera size={24} />
          <p className="text-[12px]">Tap to capture photo</p>
        </div>
      )}

      {field.type === 'signature' && (
        <div className="flex flex-col items-center justify-center py-8 rounded-[8px] border-2 border-dashed border-border-2 text-text-3 gap-2">
          <PenLine size={24} />
          <p className="text-[12px]">Sign here</p>
        </div>
      )}
    </div>
  )
}
