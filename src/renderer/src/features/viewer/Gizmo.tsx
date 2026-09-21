import { useState } from 'react'
import { evaluate, evaluateScene, findClip, isVisualClip, setValueAt } from '@core/index'
import type { Layer, Project, Vec2, VisualClip } from '@core/index'
import { naturalSize } from '@/engine/layerSize'
import { beginTransaction, commitTransaction, rollbackTransaction, select, useEditor } from '@/store/editor'
import { editClips, localFrame } from '@/store/clipEdits'
import { startDrag } from '@/features/timeline/drag'

const SNAP_PIXELS = 7
const HANDLES = [
  [0, 0, 'nwse-resize'],
  [1, 0, 'nesw-resize'],
  [0, 1, 'nesw-resize'],
  [1, 1, 'nwse-resize']
] as const

interface Props {
  /** Screen pixels per project pixel. */
  scale: number
  width: number
  height: number
}

const layersAt = (project: Project, frame: number): Layer[] =>
  evaluateScene(project, frame).nodes.flatMap((n) => (n.kind === 'layer' ? [n] : [n.from, n.to]))

/** Topmost layer under a point given in project pixels (origin top-left). */
function hitTest(project: Project, frame: number, px: number, py: number): VisualClip | null {
  for (const layer of layersAt(project, frame).reverse()) {
    const [w, h] = naturalSize(project, layer.clip)
    const t = layer.transform
    const dx = px - (project.settings.width / 2 + t.x)
    const dy = py - (project.settings.height / 2 + t.y)
    const rad = (-t.rotation * Math.PI) / 180
    const lx = (dx * Math.cos(rad) - dy * Math.sin(rad)) / (t.scaleX || 1e-6) + t.anchorX * w
    const ly = (dx * Math.sin(rad) + dy * Math.cos(rad)) / (t.scaleY || 1e-6) + t.anchorY * h
    if (lx >= 0 && lx <= w && ly >= 0 && ly <= h) return layer.clip
  }
  return null
}

/** On-canvas move / scale / rotate for the selected clip, plus click-to-select. */
export function Gizmo({ scale: k, width, height }: Props) {
  const project = useEditor((s) => s.project)
  const playhead = useEditor((s) => s.playhead)
  const playing = useEditor((s) => s.playing)
  const selection = useEditor((s) => s.selection)
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false })

  const found = selection.length === 1 ? findClip(project, selection[0]!) : undefined
  const clip =
    found && isVisualClip(found.clip) && !found.track.locked && !found.track.hidden ? found.clip : null
  const active = clip && playhead >= clip.start && playhead < clip.start + clip.duration

  const finish = (moved: boolean, cancelled: boolean): void => {
    setGuides({ x: false, y: false })
    if (!moved) return
    if (cancelled) rollbackTransaction()
    else commitTransaction()
  }

  let box: React.ReactNode = null
  if (clip && active && !playing) {
    const frame = localFrame(clip)
    const [x, y] = evaluate(clip.transform.position, frame)
    const [sx, sy] = evaluate(clip.transform.scale, frame)
    const rotation = evaluate(clip.transform.rotation, frame)
    const [nw, nh] = naturalSize(project, clip)
    const w = nw * Math.abs(sx) * k
    const h = nh * Math.abs(sy) * k
    const [ax, ay] = clip.transform.anchor
    const centerX = (project.settings.width / 2 + x) * k
    const centerY = (project.settings.height / 2 + y) * k

    const write = (label: string, apply: (c: VisualClip, f: number) => void): void =>
      editClips([clip.id], label, (c) => isVisualClip(c) && apply(c, frame))

    const move = (e: React.PointerEvent): void => {
      e.stopPropagation()
      startDrag(e, {
        onStart: () => beginTransaction('Move'),
        onMove: (dx, dy, ev) => {
          let next: Vec2 = [x + dx / k, y + dy / k]
          // Snap the anchor to the centre lines unless Alt is held.
          const snapX = !ev.altKey && Math.abs(next[0]) * k < SNAP_PIXELS
          const snapY = !ev.altKey && Math.abs(next[1]) * k < SNAP_PIXELS
          if (ev.shiftKey) next = Math.abs(dx) > Math.abs(dy) ? [next[0], y] : [x, next[1]]
          setGuides({ x: snapX, y: snapY })
          write('Move', (c, f) =>
            setValueAt(c.transform.position, f, [snapX ? 0 : next[0], snapY ? 0 : next[1]])
          )
        },
        onEnd: finish
      })
    }

    const pointerFromAnchor = (
      ev: { clientX: number; clientY: number },
      stage: DOMRect
    ): [number, number] => [ev.clientX - stage.left - centerX, ev.clientY - stage.top - centerY]

    const resize = (e: React.PointerEvent): void => {
      e.stopPropagation()
      const stage = (e.currentTarget.closest('[data-gizmo-stage]') as HTMLElement).getBoundingClientRect()
      const [x0, y0] = pointerFromAnchor(e, stage)
      const d0 = Math.max(1, Math.hypot(x0, y0))
      startDrag(e, {
        onStart: () => beginTransaction('Scale'),
        onMove: (_dx, _dy, ev) => {
          const [x1, y1] = pointerFromAnchor(ev, stage)
          const factor = Math.max(0.01, Math.hypot(x1, y1) / d0)
          write('Scale', (c, f) => setValueAt(c.transform.scale, f, [sx * factor, sy * factor]))
        },
        onEnd: finish
      })
    }

    const rotate = (e: React.PointerEvent): void => {
      e.stopPropagation()
      const stage = (e.currentTarget.closest('[data-gizmo-stage]') as HTMLElement).getBoundingClientRect()
      const [x0, y0] = pointerFromAnchor(e, stage)
      const a0 = Math.atan2(y0, x0)
      startDrag(e, {
        onStart: () => beginTransaction('Rotate'),
        onMove: (_dx, _dy, ev) => {
          const [x1, y1] = pointerFromAnchor(ev, stage)
          let angle = rotation + ((Math.atan2(y1, x1) - a0) * 180) / Math.PI
          if (ev.shiftKey) angle = Math.round(angle / 15) * 15
          write('Rotate', (c, f) => setValueAt(c.transform.rotation, f, Math.round(angle * 10) / 10))
        },
        onEnd: finish
      })
    }

    box = (
      <div
        className="absolute cursor-move border border-accent"
        style={{
          left: centerX - ax * w,
          top: centerY - ay * h,
          width: w,
          height: h,
          transformOrigin: `${ax * 100}% ${ay * 100}%`,
          transform: `rotate(${rotation}deg)`
        }}
        onPointerDown={move}
      >
        {HANDLES.map(([hx, hy, cursor]) => (
          <span
            key={`${hx}${hy}`}
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-white"
            style={{ left: `${hx * 100}%`, top: `${hy * 100}%`, cursor }}
            onPointerDown={resize}
          />
        ))}
        <span className="absolute -top-6 left-1/2 h-6 w-px -translate-x-1/2 bg-accent" />
        <span
          className="absolute -top-8 left-1/2 size-3 -translate-x-1/2 cursor-grab rounded-full border border-accent bg-white"
          title="Rotate (Shift snaps to 15°)"
          onPointerDown={rotate}
        />
        <span
          className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${ax * 100}%`, top: `${ay * 100}%` }}
        />
      </div>
    )
  }

  return (
    <div
      data-gizmo-stage
      className="absolute inset-0 overflow-visible"
      onPointerDown={(e) => {
        if (e.button !== 0 || playing) return
        const rect = e.currentTarget.getBoundingClientRect()
        const hit = hitTest(project, playhead, (e.clientX - rect.left) / k, (e.clientY - rect.top) / k)
        select(hit ? [hit.id] : [])
      }}
    >
      {guides.x && (
        <span
          className="pointer-events-none absolute inset-y-0 w-px bg-accent/80"
          style={{ left: width / 2 }}
        />
      )}
      {guides.y && (
        <span
          className="pointer-events-none absolute inset-x-0 h-px bg-accent/80"
          style={{ top: height / 2 }}
        />
      )}
      {box}
    </div>
  )
}
