import { useRef, useState } from 'react'
import { Upload, FileText, X, CheckSquare, AlignJustify, Ruler, AlignLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { JWT_KEY } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { WIField, FieldType } from '@/pages/WIBuilder'

interface ImportedItem {
  itemNo:             string
  description:        string
  fieldType:          string
  acceptanceCriteria: string | null
  required:           boolean
}

interface ImportedWI {
  wiTitle:  string
  wiNumber: string
  revision?: string
  items:    ImportedItem[]
}

interface ImportPdfModalProps {
  onImport: (fields: WIField[], meta: { title: string; wiNumber: string; revision: string }, mode: 'replace' | 'append') => void
  onClose:  () => void
}

const FIELD_ICON: Record<string, React.ReactNode> = {
  heading:    <AlignJustify size={12} className="text-text-3" />,
  pass_fail:  <CheckSquare  size={12} className="text-accent"  />,
  measurement:<Ruler        size={12} className="text-warning" />,
  textarea:   <AlignLeft    size={12} className="text-text-2"  />,
}

const FIELD_LABEL: Record<string, string> = {
  heading: 'Heading', pass_fail: 'Pass/Fail', measurement: 'Measurement',
  textarea: 'Text', text: 'Text',
}

function toWIField(item: ImportedItem): WIField {
  return {
    id:                 crypto.randomUUID(),
    type:               (item.fieldType as FieldType) ?? 'pass_fail',
    label:              item.description,
    acceptanceCriteria: item.acceptanceCriteria ?? '',
    required:           item.fieldType !== 'heading' && (item.required !== false),
    placeholder:        '',
    optionsText:        '',
    unit:               item.fieldType === 'measurement' ? 'V' : '',
    minValue:           '',
    maxValue:           '',
    conditional:        null,
  }
}

export function ImportPdfModal({ onImport, onClose }: ImportPdfModalProps) {
  const fileRef       = useRef<HTMLInputElement>(null)
  const [dragging,    setDragging]    = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [imported,    setImported]    = useState<ImportedWI | null>(null)
  const [mode,        setMode]        = useState<'replace' | 'append'>('replace')
  const [fileName,    setFileName]    = useState<string | null>(null)
  const [progress,    setProgress]    = useState(0)

  const processFile = async (file: File) => {
    if (file.type !== 'application/pdf') { setError('Please upload a PDF file.'); return }
    setFileName(file.name)
    setLoading(true)
    setError(null)
    setImported(null)

    // Fake progress bar (no real streaming — just visual feedback for ~20s wait)
    let p = 0
    const tick = setInterval(() => {
      p = Math.min(p + Math.random() * 4, 90)
      setProgress(Math.round(p))
    }, 500)

    try {
      const formData = new FormData()
      formData.append('pdf', file)

      const token = localStorage.getItem(JWT_KEY) ?? ''
      const res = await fetch('/api/ai/import-wi-pdf', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    formData,
      })

      clearInterval(tick)
      setProgress(100)

      const json = await res.json() as { data?: ImportedWI; error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? 'Import failed')
      setImported(json.data!)
    } catch (err) {
      clearInterval(tick)
      setError(err instanceof Error ? err.message : 'Failed to parse PDF')
    } finally {
      setLoading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleConfirm = () => {
    if (!imported) return
    const fields = imported.items.map(toWIField)
    onImport(
      fields,
      { title: imported.wiTitle, wiNumber: imported.wiNumber, revision: imported.revision ?? 'Rev 1' },
      mode,
    )
  }

  const checkableCount = imported?.items.filter(i => i.fieldType !== 'heading').length ?? 0
  const headingCount   = imported?.items.filter(i => i.fieldType === 'heading').length ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-bg border border-border rounded-[14px] w-full max-w-[680px] max-h-[85vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          <FileText size={18} className="text-accent" />
          <div className="flex-1">
            <p className="text-[14px] font-semibold text-text">Import from PDF</p>
            <p className="text-[12px] text-text-2">AI reads your existing work instruction and builds the checklist automatically</p>
          </div>
          <button onClick={onClose} className="text-text-3 hover:text-text bg-transparent border-none cursor-pointer p-1">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* Drop zone — shown when no result yet */}
          {!imported && (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => !loading && fileRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-[12px] p-8 text-center transition-colors',
                dragging ? 'border-accent bg-accent/5' : 'border-border-2 bg-bg-2 hover:border-accent/50',
                loading ? 'cursor-default' : 'cursor-pointer'
              )}
            >
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = '' }} />

              {loading ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <div className="w-full max-w-[280px]">
                    <div className="flex justify-between text-[11px] text-text-3 mb-1.5">
                      <span>AI is reading <span className="text-text font-medium">{fileName}</span>…</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-bg-3 rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-[11px] text-text-3 mt-2">Extracting tasks, section headings and field types — this takes 15–30 seconds</p>
                  </div>
                </div>
              ) : (
                <>
                  <Upload size={28} className="mx-auto text-text-3 mb-3" />
                  <p className="text-[14px] font-medium text-text mb-1">Drop your PDF here</p>
                  <p className="text-[12px] text-text-3">or click to browse · Max 20 MB</p>
                  <p className="text-[11px] text-text-3 mt-3 italic">Works with any Work Record Form, maintenance checklist, or procedure document</p>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 bg-danger-bg border border-danger-border rounded-[8px] text-[12px] text-danger">
              {error}
              <button onClick={() => { setError(null); setImported(null) }}
                className="ml-3 underline cursor-pointer bg-transparent border-none text-danger text-[11px]">
                Try again
              </button>
            </div>
          )}

          {/* Preview — shown after successful extraction */}
          {imported && (
            <>
              {/* Detected metadata */}
              <div className="bg-success-bg border border-success-border rounded-[10px] p-4 mb-4">
                <p className="text-[11px] text-success font-semibold uppercase tracking-[0.07em] mb-2">✓ Extracted successfully</p>
                <p className="text-[14px] font-semibold text-text">{imported.wiTitle}</p>
                <div className="flex items-center gap-4 mt-1">
                  <span className="font-mono text-[12px] text-text-2">{imported.wiNumber}</span>
                  {imported.revision && <span className="text-[12px] text-text-3">{imported.revision}</span>}
                  <span className="text-[12px] text-text-2">{checkableCount} tasks · {headingCount} sections</span>
                </div>
              </div>

              {/* Import mode */}
              <div className="flex gap-2 mb-4">
                {(['replace', 'append'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={cn(
                      'flex-1 py-2 text-[12px] font-medium rounded-[8px] border cursor-pointer transition-colors',
                      mode === m
                        ? 'bg-accent/10 border-accent text-accent'
                        : 'bg-bg-2 border-border-2 text-text-2 hover:border-border-3'
                    )}>
                    {m === 'replace' ? 'Replace current canvas' : 'Append to current canvas'}
                  </button>
                ))}
              </div>

              {/* Item preview list */}
              <div className="border border-border rounded-[10px] overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-bg-3 border-b border-border">
                  <span className="text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em] w-14">Item #</span>
                  <span className="text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em] flex-1">Description</span>
                  <span className="text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em] w-20">Type</span>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {imported.items.map((item, i) => (
                    <div key={i}
                      className={cn(
                        'flex items-start gap-2 px-3 py-2 border-b border-border last:border-0 text-[12px]',
                        item.fieldType === 'heading'
                          ? 'bg-bg-3'
                          : 'bg-bg hover:bg-bg-2 transition-colors'
                      )}>
                      <span className={cn(
                        'font-mono w-14 flex-shrink-0 pt-px',
                        item.fieldType === 'heading' ? 'text-text-2 font-semibold text-[11px]' : 'text-text-3 text-[11px]'
                      )}>
                        {item.itemNo}
                      </span>
                      <span className={cn(
                        'flex-1 leading-snug',
                        item.fieldType === 'heading' ? 'font-semibold text-text' : 'text-text-2'
                      )}>
                        {item.description}
                      </span>
                      <span className="flex items-center gap-1 w-20 flex-shrink-0 pt-px">
                        {FIELD_ICON[item.fieldType] ?? <CheckSquare size={12} className="text-accent" />}
                        <span className="text-[10px] text-text-3">{FIELD_LABEL[item.fieldType] ?? item.fieldType}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => { setImported(null); setError(null); setFileName(null); setProgress(0) }}
                className="mt-3 text-[11px] text-text-3 hover:text-text bg-transparent border-none cursor-pointer underline p-0"
              >
                Upload a different PDF
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border flex-shrink-0">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {imported && (
            <Button variant="primary" onClick={handleConfirm}>
              Import {imported.items.length} items into builder
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
