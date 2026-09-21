import { useEffect, useRef, useState } from 'react'
import { startDrag } from '@/features/timeline/drag'

interface Props {
  value: number
  onChange(value: number): void
  /** Wraps a drag so that it becomes one undo step. */
  onScrubStart?(): void
  onScrubEnd?(): void
  min?: number
  max?: number
  step?: number
  /** Value change per pixel dragged. */
  sensitivity?: number
  precision?: number
  suffix?: string
  label?: string
  className?: string
  disabled?: boolean
}

const clamp = (v: number, min = -Infinity, max = Infinity): number => Math.min(max, Math.max(min, v))

/** Numeric field that can be typed into, nudged with arrows, or scrubbed by dragging sideways. */
export function NumberInput({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
  min,
  max,
  step = 1,
  sensitivity = step,
  precision = 2,
  suffix = '',
  label,
  className = '',
  disabled
}: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const shown = Number(value.toFixed(precision)).toString()

  useEffect(() => {
    if (draft !== null) inputRef.current?.select()
  }, [draft !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (): void => {
    if (draft === null) return
    const parsed = Number(draft.replace(',', '.'))
    if (draft.trim() !== '' && Number.isFinite(parsed)) onChange(clamp(parsed, min, max))
    setDraft(null)
  }

  if (draft !== null) {
    return (
      <input
        ref={inputRef}
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(null)
        }}
        className={`h-7 min-w-0 flex-1 basis-0 rounded-md border border-accent bg-bg px-2 font-mono text-xs text-fg outline-none select-text ${className}`}
      />
    )
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label ? `${label} — drag to adjust, click to type` : undefined}
      className={`h-7 min-w-0 flex-1 basis-0 cursor-ew-resize truncate rounded-md border border-line bg-raised px-2 text-left font-mono text-xs text-fg tabular-nums hover:border-faint disabled:opacity-40 ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const origin = value
        startDrag(e, {
          onStart: onScrubStart,
          onMove: (dx, _dy, ev) => {
            const scale = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1
            const next = origin + dx * sensitivity * scale
            onChange(clamp(Math.round(next / step) * step, min, max))
          },
          onEnd: (moved) => (moved ? onScrubEnd?.() : setDraft(shown))
        })
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          e.stopPropagation()
          onChange(clamp(value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1), min, max))
        } else if (e.key === 'Enter' || /^[\d.-]$/.test(e.key)) {
          setDraft(e.key === 'Enter' ? shown : '')
        }
      }}
    >
      {shown}
      {suffix && <span className="text-faint">{suffix}</span>}
    </button>
  )
}
