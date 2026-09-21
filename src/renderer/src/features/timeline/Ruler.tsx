import { useEffect, useRef } from 'react'
import { formatTimecode } from '@core/index'
import { seek } from '@/engine/playback/session'
import { useEditor } from '@/store/editor'
import { startDrag } from './drag'
import { RULER_HEIGHT, rulerStep, useTimelineView } from './view'

export function Ruler() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zoom = useEditor((s) => s.zoom)
  const fps = useEditor((s) => s.project.settings.fps)
  const markers = useEditor((s) => s.project.markers)
  const range = useEditor((s) => s.project.range)
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
        ctx.fillText(formatTimecode(frame, fps), x + 4, 3)
      }
    }
    for (const marker of markers) {
      const x = marker.frame * zoom - scrollLeft
      ctx.fillStyle = marker.color
      ctx.beginPath()
      ctx.moveTo(x - 4, RULER_HEIGHT - 9)
      ctx.lineTo(x + 4, RULER_HEIGHT - 9)
      ctx.lineTo(x, RULER_HEIGHT - 1)
      ctx.fill()
    }
  }, [zoom, fps, scrollLeft, width, markers, range])

  return (
    <canvas
      ref={canvasRef}
      className="block cursor-ew-resize"
      style={{ width, height: RULER_HEIGHT }}
      onPointerDown={(e) => {
        const left = e.currentTarget.getBoundingClientRect().left
        const frameAt = (clientX: number): number =>
          (clientX - left + useTimelineView.getState().scrollLeft) / useEditor.getState().zoom
        seek(frameAt(e.clientX))
        startDrag(e, { threshold: 0, onMove: (_dx, _dy, ev) => seek(frameAt(ev.clientX)) })
      }}
    />
  )
}
