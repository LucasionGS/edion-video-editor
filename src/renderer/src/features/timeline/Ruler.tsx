import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { formatRulerLabel, moveMarker } from '@core/index'
import type { Marker } from '@core/index'
import { seek } from '@/engine/playback/session'
import { beginTransaction, commitTransaction, edit, rollbackTransaction, useEditor } from '@/store/editor'
import { openContextMenu, type MenuItem } from '@/ui/ContextMenu'
import { startDrag } from './drag'
import { RULER_HEIGHT, rulerStep, useTimelineView } from './view'

export function Ruler() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zoom = useEditor((s) => s.zoom)
  const fps = useEditor((s) => s.project.settings.fps)
  const markers = useEditor((s) => s.project.markers)
  const range = useEditor((s) => s.project.range)
  const display = useEditor((s) => s.timeDisplay)
  const scrollLeft = useTimelineView((s) => s.scrollLeft)
  const width = useTimelineView((s) => s.viewportWidth)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.round(RULER_HEIGHT * ratio)
    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    const styles = getComputedStyle(document.documentElement)
    const color = (name: string): string => styles.getPropertyValue(name).trim()
    ctx.clearRect(0, 0, width, RULER_HEIGHT)

    if (range) {
      ctx.fillStyle = color('--color-accent-soft')
      ctx.fillRect(range.in * zoom - scrollLeft, 0, (range.out - range.in) * zoom, RULER_HEIGHT)
    }
    const { major, minor } = rulerStep(zoom, fps)
    const first = Math.floor(scrollLeft / zoom / minor) * minor
    const last = (scrollLeft + width) / zoom
    ctx.font = `10px ${color('--font-mono')}`
    ctx.textBaseline = 'top'
    for (let frame = first; frame <= last; frame += minor) {
      const x = Math.round(frame * zoom - scrollLeft) + 0.5
      const isMajor = frame % major === 0
      ctx.strokeStyle = color(isMajor ? '--color-faint' : '--color-line')
      ctx.beginPath()
      ctx.moveTo(x, isMajor ? 12 : 19)
      ctx.lineTo(x, RULER_HEIGHT)
      ctx.stroke()
      if (isMajor) {
        ctx.fillStyle = color('--color-muted')
        ctx.fillText(formatRulerLabel(frame, fps, display), x + 4, 3)
      }
    }
    ctx.font = `10px ${color('--font-sans')}`
    for (const [i, marker] of markers.entries()) {
      const x = marker.frame * zoom - scrollLeft
      ctx.fillStyle = marker.color
      ctx.beginPath()
      ctx.moveTo(x - 4, RULER_HEIGHT - 9)
      ctx.lineTo(x + 4, RULER_HEIGHT - 9)
      ctx.lineTo(x, RULER_HEIGHT - 1)
      ctx.fill()
      // Labels only while they fit before the next marker.
      const next = markers[i + 1]
      const room = next ? (next.frame - marker.frame) * zoom - 10 : Infinity
      if (marker.label && room > 24) {
        let label = marker.label
        while (label.length > 1 && ctx.measureText(label).width > room) label = label.slice(0, -1)
        ctx.fillText(label === marker.label ? label : `${label.slice(0, -1)}…`, x + 6, RULER_HEIGHT - 11)
      }
    }
  }, [zoom, fps, scrollLeft, width, markers, range, display])

  /** The marker whose flag is under an x offset in the ruler, if any. */
  const markerAt = (x: number): Marker | undefined => {
    const scroll = useTimelineView.getState().scrollLeft
    return markers.find((m) => Math.abs(m.frame * zoom - scroll - x) <= 5)
  }

  return (
    <canvas
      ref={canvasRef}
      className="block cursor-ew-resize"
      style={{ width, height: RULER_HEIGHT }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const left = e.currentTarget.getBoundingClientRect().left
        const frameAt = (clientX: number): number =>
          (clientX - left + useTimelineView.getState().scrollLeft) / useEditor.getState().zoom
        const marker = markerAt(e.clientX - left)
        if (marker) return dragMarker(e, marker.id, frameAt)
        seek(frameAt(e.clientX))
        startDrag(e, { threshold: 0, onMove: (_dx, _dy, ev) => seek(frameAt(ev.clientX)) })
      }}
      onContextMenu={(e) => {
        const marker = markerAt(e.clientX - e.currentTarget.getBoundingClientRect().left)
        if (!marker) return e.preventDefault()
        e.stopPropagation()
        openContextMenu(e, [
          { label: 'Go to marker', onSelect: () => seek(marker.frame) },
          { type: 'separator' },
          ...MARKER_COLORS.map((c): MenuItem => ({
            label: c.label,
            icon: <span className="size-2.5 rounded-full" style={{ background: c.value }} />,
            onSelect: () => updateMarker(marker.id, 'Change marker colour', (m) => void (m.color = c.value))
          })),
          { type: 'separator' },
          {
            label: 'Delete marker',
            icon: <Trash2 size={13} />,
            danger: true,
            onSelect: () =>
              edit('Delete marker', (d) => void (d.markers = d.markers.filter((m) => m.id !== marker.id)))
          }
        ])
      }}
    />
  )
}

export const MARKER_COLORS = [
  { label: 'Yellow', value: '#f5c451' },
  { label: 'Red', value: '#ef5b5b' },
  { label: 'Orange', value: '#f08a3c' },
  { label: 'Green', value: '#6fd08c' },
  { label: 'Blue', value: '#5bb3ef' },
  { label: 'Purple', value: '#b57bee' }
]

export function updateMarker(id: string, label: string, change: (marker: Marker) => void): void {
  edit(label, (draft) => {
    const marker = draft.markers.find((m) => m.id === id)
    if (marker) change(marker)
  })
}

/** Drags a marker along the ruler as one undo step; a click without movement just seeks to it. */
function dragMarker(event: React.PointerEvent, id: string, frameAt: (clientX: number) => number): void {
  const marker = useEditor.getState().project.markers.find((m) => m.id === id)
  if (!marker) return
  startDrag(event, {
    onStart: () => beginTransaction('Move marker'),
    onMove: (_dx, _dy, e) => edit('Move marker', (d) => moveMarker(d, id, frameAt(e.clientX))),
    onEnd: (moved, cancelled) => {
      if (!moved) return seek(marker.frame)
      if (cancelled) rollbackTransaction()
      else commitTransaction()
    }
  })
}
