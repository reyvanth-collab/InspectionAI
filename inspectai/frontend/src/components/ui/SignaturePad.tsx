import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from './Button'

interface SignaturePadProps {
  onSave:  (dataUrl: string, signerId?: string) => void
  onClose: () => void
  signerName?: string
  signerOptions?: Array<{ id: string; name: string; role?: string; staffId?: string }>
  selectedSignerId?: string
  onSignerChange?: (signerId: string) => void
  requireSigner?: boolean
}

export function SignaturePad({
  onSave,
  onClose,
  signerName,
  signerOptions = [],
  selectedSignerId = '',
  onSignerChange,
  requireSigner = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing]   = useState(false)
  const [isEmpty,  setIsEmpty]  = useState(true)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  // ── Canvas setup ────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // HiDPI / Retina support
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width  = rect.width  * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    ctx.fillStyle = 'transparent'
    ctx.clearRect(0, 0, rect.width, rect.height)

    ctx.strokeStyle = '#4f8ef7'
    ctx.lineWidth   = 2.5
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
  }, [])

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: t.clientX - rect.left, y: t.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    setDrawing(true)
    setIsEmpty(false)
    lastPos.current = getPos(e, canvas)
  }, [])

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!drawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx || !lastPos.current) return

    const pos = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPos.current = pos
  }, [drawing])

  const endDraw = useCallback(() => {
    setDrawing(false)
    lastPos.current = null
  }, [])

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr  = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width * dpr, rect.height * dpr)
    setIsEmpty(true)
  }, [])

  const save = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || isEmpty || (requireSigner && !selectedSignerId)) return
    // Compose onto white bg so PNG is not transparent
    const offscreen = document.createElement('canvas')
    offscreen.width  = canvas.width
    offscreen.height = canvas.height
    const octx = offscreen.getContext('2d')!
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, offscreen.width, offscreen.height)
    octx.drawImage(canvas, 0, 0)
    onSave(offscreen.toDataURL('image/png'), selectedSignerId || undefined)
  }, [isEmpty, onSave, requireSigner, selectedSignerId])

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-bg-2 border border-border rounded-[12px] shadow-2xl w-full max-w-[480px]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.2px]">Digital Signature</h2>
            {signerName && signerOptions.length === 0 && (
              <p className="text-[12px] text-text-2 mt-0.5">Signing as <span className="text-text font-medium">{signerName}</span></p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-3 hover:text-text bg-transparent border-none cursor-pointer text-[18px] leading-none"
          >
            ×
          </button>
        </div>

        {/* Canvas area */}
        <div className="px-5 pt-4 pb-2">
          {signerOptions.length > 0 && (
            <div className="mb-4">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.07em] text-text-2">
                Signer
              </label>
              <select
                value={selectedSignerId}
                onChange={e => onSignerChange?.(e.target.value)}
                className="w-full rounded-[8px] border border-border-2 bg-bg px-3 py-2 text-[13px] text-text outline-none transition-colors focus:border-accent"
              >
                <option value="">Select signer...</option>
                {signerOptions.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.name}{option.staffId ? ` (${option.staffId})` : ''}{option.role ? ` - ${option.role}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="text-[11px] text-text-3 mb-2 uppercase tracking-[0.07em]">Sign below</p>
          <div className="relative rounded-[8px] border-2 border-dashed border-border-2 overflow-hidden bg-bg"
               style={{ height: 160 }}>
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
            {isEmpty && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-[12px] text-text-3">Draw your signature here</p>
              </div>
            )}
          </div>
          {/* Baseline */}
          <div className="mt-1 mx-1 border-t border-border-2 flex justify-between">
            <span className="text-[10px] text-text-3 mt-1">×</span>
          </div>
        </div>

        {/* Timestamp */}
        <div className="px-5 pb-2">
          <p className="text-[11px] text-text-3 font-mono">
            {new Date().toLocaleString('en-SG', {
              day: '2-digit', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border gap-3">
          <button
            onClick={clear}
            className="text-[12px] text-text-3 hover:text-danger bg-transparent border-none cursor-pointer transition-colors"
          >
            Clear
          </button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={isEmpty || (requireSigner && !selectedSignerId)} onClick={save}>
              Apply Signature
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
