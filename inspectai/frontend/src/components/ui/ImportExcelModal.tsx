import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { JWT_KEY } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { WIField, FieldType } from '@/pages/WIBuilder'

interface ImportedExcelItem {
  itemNo: string
  description: string
  fieldType: string
  acceptanceCriteria: string | null
  required: boolean
  placeholder?: string
  options?: string[]
  unit?: string
  minValue?: number | null
  maxValue?: number | null
  layout: {
    width: 'full' | 'half' | 'third'
    height: number
    sectionLevel: 1 | 2 | 3
    tableColumns: string[]
    tableRows: number
    rowBreakBefore: boolean
  }
}

interface ImportedExcelWI {
  wiTitle: string
  wiNumber: string
  revision: string
  category: string
  effectiveDate: string
  expiryDate: string
  items: ImportedExcelItem[]
}

interface ImportExcelModalProps {
  onImport: (
    fields: WIField[],
    meta: { title: string; wiNumber: string; revision: string; category: string; effectiveDate: string; expiryDate: string },
    mode: 'replace' | 'append'
  ) => void
  onClose: () => void
}

function toWIField(item: ImportedExcelItem): WIField {
  const fieldType = (item.fieldType as FieldType) ?? 'pass_fail'
  return {
    id:                 crypto.randomUUID(),
    type:               fieldType,
    label:              item.description,
    acceptanceCriteria: item.acceptanceCriteria ?? '',
    required:           fieldType !== 'heading' && item.required !== false,
    placeholder:        item.placeholder ?? '',
    optionsText:        item.options?.join('\n') ?? '',
    unit:               item.unit ?? (fieldType === 'measurement' ? 'mm' : ''),
    minValue:           item.minValue != null ? String(item.minValue) : '',
    maxValue:           item.maxValue != null ? String(item.maxValue) : '',
    conditional:        null,
    sourcePage:         null,
    sourceText:         `Excel row ${item.itemNo}`,
    aiConfidence:       null,
    aiWarnings:         [],
    layout:             item.layout,
  }
}

export function ImportExcelModal({ onImport, onClose }: ImportExcelModalProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imported, setImported] = useState<ImportedExcelWI | null>(null)
  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [fileName, setFileName] = useState<string | null>(null)

  const token = () => localStorage.getItem(JWT_KEY) ?? ''

  const downloadTemplate = async () => {
    setDownloading(true)
    setError(null)
    try {
      const res = await fetch('/api/work-instructions/template', {
        headers: { Authorization: `Bearer ${token()}` },
      })
      if (!res.ok) throw new Error(`Template download failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'inspectai-wi-template.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download template')
    } finally {
      setDownloading(false)
    }
  }

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Please upload an .xlsx file created from the WI template.')
      return
    }
    setLoading(true)
    setError(null)
    setImported(null)
    setFileName(file.name)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/work-instructions/import-excel', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
        body: formData,
      })
      const json = await res.json() as { data?: ImportedExcelWI; error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? 'Import failed')
      setImported(json.data!)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import Excel file')
    } finally {
      setLoading(false)
    }
  }

  const confirm = () => {
    if (!imported) return
    onImport(
      imported.items.map(toWIField),
      {
        title:         imported.wiTitle,
        wiNumber:      imported.wiNumber,
        revision:      imported.revision,
        category:      imported.category,
        effectiveDate: imported.effectiveDate,
        expiryDate:    imported.expiryDate,
      },
      mode,
    )
  }

  const tableCount = imported?.items.filter(item => item.fieldType === 'table').length ?? 0
  const sectionCount = imported?.items.filter(item => item.fieldType === 'heading').length ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-bg border border-border rounded-[14px] w-full max-w-[700px] max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          <FileSpreadsheet size={18} className="text-accent" />
          <div className="flex-1">
            <p className="text-[14px] font-semibold text-text">Import WI from Excel</p>
            <p className="text-[12px] text-text-2">Download the template, fill it, then load it into the builder</p>
          </div>
          <button onClick={onClose} className="text-text-3 hover:text-text bg-transparent border-none cursor-pointer p-1">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4 rounded-[10px] border border-border bg-bg-2 p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-text">WI data loading template</p>
              <p className="text-[12px] text-text-3 mt-0.5">Includes metadata, checklist rows, sections, tables, sizing, and dropdown options.</p>
            </div>
            <Button variant="secondary" loading={downloading} onClick={downloadTemplate}>
              <Download size={14} /> Download
            </Button>
          </div>

          {!imported && (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) processFile(file) }}
              onClick={() => !loading && fileRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-[12px] p-8 text-center transition-colors',
                dragging ? 'border-accent bg-accent/5' : 'border-border-2 bg-bg-2 hover:border-accent/50',
                loading ? 'cursor-default' : 'cursor-pointer'
              )}
            >
              <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = '' }} />
              {loading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-9 h-9 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <p className="text-[13px] text-text-2">Loading {fileName}</p>
                </div>
              ) : (
                <>
                  <Upload size={28} className="mx-auto text-text-3 mb-3" />
                  <p className="text-[14px] font-medium text-text mb-1">Drop completed WI Excel here</p>
                  <p className="text-[12px] text-text-3">or click to browse .xlsx</p>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 bg-danger-bg border border-danger-border rounded-[8px] text-[12px] text-danger">
              {error}
            </div>
          )}

          {imported && (
            <>
              <div className="bg-success-bg border border-success-border rounded-[10px] p-4 mb-4">
                <p className="text-[11px] text-success font-semibold uppercase tracking-[0.07em] mb-2">Excel loaded</p>
                <p className="text-[14px] font-semibold text-text">{imported.wiTitle}</p>
                <div className="flex items-center gap-4 mt-1 flex-wrap">
                  <span className="font-mono text-[12px] text-text-2">{imported.wiNumber || 'No WI number'}</span>
                  <span className="text-[12px] text-text-3">{imported.revision}</span>
                  <span className="text-[12px] text-text-2">{imported.items.length} rows</span>
                  <span className="text-[12px] text-text-2">{sectionCount} sections</span>
                  <span className="text-[12px] text-text-2">{tableCount} tables</span>
                </div>
              </div>

              <div className="flex gap-2 mb-4">
                {(['replace', 'append'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={cn(
                      'flex-1 py-2 text-[12px] font-medium rounded-[8px] border cursor-pointer transition-colors',
                      mode === m ? 'bg-accent/10 border-accent text-accent' : 'bg-bg-2 border-border-2 text-text-2 hover:border-border-3'
                    )}>
                    {m === 'replace' ? 'Replace current canvas' : 'Append to current canvas'}
                  </button>
                ))}
              </div>

              <div className="border border-border rounded-[10px] overflow-hidden">
                <div className="grid grid-cols-[70px_1fr_95px_90px] gap-2 px-3 py-2 bg-bg-3 border-b border-border">
                  {['Item #', 'Question / Heading', 'Type', 'Layout'].map(h => (
                    <span key={h} className="text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em]">{h}</span>
                  ))}
                </div>
                <div className="max-h-[280px] overflow-y-auto">
                  {imported.items.map(item => (
                    <div key={item.itemNo} className="grid grid-cols-[70px_1fr_95px_90px] gap-2 px-3 py-2 border-b border-border last:border-0">
                      <span className="font-mono text-[11px] text-text-3">{item.itemNo}</span>
                      <span className="text-[12px] text-text-2 truncate">{item.description}</span>
                      <span className="text-[10px] text-text-3 uppercase">{item.fieldType}</span>
                      <span className="text-[10px] text-text-3 uppercase">{item.layout.width}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border flex-shrink-0">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {imported && (
            <Button variant="primary" onClick={confirm}>
              Import {imported.items.length} rows into builder
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
