import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { easingBezier, evaluate, findClip, removeKeyframe, upsertKeyframe } from '@core/index'
import type { Animatable, AnimValue, Easing, Id } from '@core/index'
import { seek } from '@/engine/playback/session'
import { startDrag } from '@/features/timeline/drag'
import { editClips, localFrame } from '@/store/clipEdits'
import { closeDialog } from '@/store/dialogs'
import { beginTransaction, commitTransaction, rollbackTransaction, useEditor } from '@/store/editor'
import { Button } from '@/ui/Button'
import { Segmented } from '@/ui/Field'
import { Modal } from '@/ui/Modal'
import type { AnimGetter } from './anim'

const WIDTH = 680
const HEIGHT = 300
const PAD = 22

const EASING_BUTTONS: ReadonlyArray<{ label: string; easing: Easing }> = [
  { label: 'Linear', easing: 'linear' },
  { label: 'Ease in', easing: 'easeIn' },
  { label: 'Ease out', easing: 'easeOut' },
  { label: 'Ease in-out', easing: 'easeInOut' },
  { label: 'Hold', easing: 'hold' }
]

const channelOf = (value: AnimValue, channel: 0 | 1): number =>
  typeof value === 'number' ? value : value[channel]
const withChannel = <T extends AnimValue>(value: T, channel: 0 | 1, next: number): T => {
  if (typeof value === 'number') return next as T
  const copy: [number, number] = [value[0], value[1]]
  copy[channel] = next
  return copy as T
}

/**
 * The value of one animated property over its clip, as a curve. Keyframes are dragged in time and value,
 * the bezier handles of the selected keyframe shape the move to the next one, and a double-click adds a
 * keyframe. Every drag is one undo step.
 */
export function CurveEditor({
  clipId,
  label,
  get
}: {
  clipId: Id
  label: string
  get: AnimGetter<AnimValue>
}) {
  const clip = useEditor((s) => findClip(s.project, clipId)?.clip)
  const playhead = useEditor((s) => s.playhead)
  const [selected, setSelected] = useState(0)
  const [channel, setChannel] = useState<0 | 1>(0)
  const anim = clip ? get(clip) : undefined

  const view = useMemo(() => {
    if (!clip || !anim) return null
    const last = Math.max(1, clip.duration - 1)
    const step = Math.max(1, Math.floor(last / 400))
    const samples: Array<[number, number]> = []
    for (let f = 0; f <= last; f += step) samples.push([f, channelOf(evaluate(anim, f), channel)])
    samples.push([last, channelOf(evaluate(anim, last), channel)])
    const values = [
      ...samples.map((s) => s[1]),
      ...(anim.keyframes ?? []).map((k) => channelOf(k.value, channel))
    ]
    let min = Math.min(...values)
    let max = Math.max(...values)
    if (max - min < 1e-6) {
      min -= 1
      max += 1
    }
    const margin = (max - min) * 0.15
    min -= margin
    max += margin
    const x = (frame: number): number => PAD + (frame / last) * (WIDTH - PAD * 2)
    const y = (value: number): number => HEIGHT - PAD - ((value - min) / (max - min)) * (HEIGHT - PAD * 2)
    return {
      last,
      samples,
      x,
      y,
      framePerPx: last / (WIDTH - PAD * 2),
      valuePerPx: (max - min) / (HEIGHT - PAD * 2),
      min,
      max
    }
  }, [clip, anim, channel])

  if (!clip || !anim || !view) return null
  const keyframes = anim.keyframes ?? []
  const index = Math.min(selected, keyframes.length - 1)
  const current = keyframes[index]
  const next = keyframes[index + 1]
  const vector = typeof anim.value !== 'number'

  const change = (title: string, fn: (target: Animatable<AnimValue>) => void): void =>
    editClips([clipId], title, (draft) => {
      const target = get(draft)
      if (target) fn(target as Animatable<AnimValue>)
    })

  /** One undo step per drag; `onMove` gets the pointer offset in pixels. */
  const drag = (event: React.PointerEvent, title: string, onMove: (dx: number, dy: number) => void): void => {
    event.stopPropagation()
    startDrag(event, {
      threshold: 1,
      onStart: () => beginTransaction(title),
      onMove: (dx, dy) => onMove(dx, dy),
      onEnd: (moved, cancelled) => {
        if (!moved) return
        if (cancelled) rollbackTransaction()
        else commitTransaction()
      }
    })
  }

  const dragKeyframe = (event: React.PointerEvent, i: number): void => {
    setSelected(i)
    const origin = keyframes[i]!
    const low = i > 0 ? keyframes[i - 1]!.frame + 1 : 0
    const high = i < keyframes.length - 1 ? keyframes[i + 1]!.frame - 1 : view.last
    drag(event, 'Move keyframe', (dx, dy) =>
      change('Move keyframe', (target) => {
        const k = target.keyframes?.[i]
        if (!k) return
        k.frame = Math.max(low, Math.min(high, Math.round(origin.frame + dx * view.framePerPx)))
        k.value = withChannel(origin.value, channel, channelOf(origin.value, channel) - dy * view.valuePerPx)
      })
    )
  }

  const bezier = current && next ? easingBezier(current.easing) : null
  const segment =
    current && next
      ? {
          f0: current.frame,
          f1: next.frame,
          v0: channelOf(current.value, channel),
          v1: channelOf(next.value, channel)
        }
      : null
  const handlePoint = (tx: number, ty: number): [number, number] =>
    segment
      ? [
          view.x(segment.f0 + tx * (segment.f1 - segment.f0)),
          view.y(segment.v0 + ty * (segment.v1 - segment.v0))
        ]
      : [0, 0]

  const dragHandle = (event: React.PointerEvent, which: 0 | 1): void => {
    if (!segment || !bezier) return
    const start = [...bezier] as [number, number, number, number]
    const span = segment.f1 - segment.f0
    // A flat segment has no value range to express the handle in; fall back to the frame's own units.
    const rise = Math.abs(segment.v1 - segment.v0) > 1e-9 ? segment.v1 - segment.v0 : view.valuePerPx * 100
    drag(event, 'Shape curve', (dx, dy) =>
      change('Shape curve', (target) => {
        const k = target.keyframes?.[index]
        if (!k) return
        const points: [number, number, number, number] = [...start]
        points[which * 2] = Math.max(0, Math.min(1, start[which * 2]! + (dx * view.framePerPx) / span))
        points[which * 2 + 1] = start[which * 2 + 1]! - (dy * view.valuePerPx) / rise
        k.easing = { bezier: points }
      })
    )
  }

  const path = view.samples.map(
    ([f, v], i) => `${i ? 'L' : 'M'}${view.x(f).toFixed(1)},${view.y(v).toFixed(1)}`
  )
  const playheadX = view.x(localFrame(clip))

  return (
    <Modal title={`${label} · curve`} onClose={closeDialog} width={WIDTH + 34}>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs text-faint">
            Drag keyframes to move them, the handles to shape the move to the next keyframe. Double-click to
            add one.
          </span>
          {vector && (
            <span className="w-28 shrink-0">
              <Segmented
                value={String(channel)}
                options={[
                  { value: '0', label: 'X' },
                  { value: '1', label: 'Y' }
                ]}
                onChange={(v) => setChannel(v === '1' ? 1 : 0)}
              />
            </span>
          )}
        </div>
        <svg
          width={WIDTH}
          height={HEIGHT}
          className="rounded-md bg-bg select-none"
          onDoubleClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const frame = Math.round((e.clientX - rect.left - PAD) * view.framePerPx)
            if (frame < 0 || frame > view.last) return
            change('Add keyframe', (target) => upsertKeyframe(target, frame))
            const after = keyframes.filter((k) => k.frame < frame).length
            setSelected(after)
          }}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return
            const rect = e.currentTarget.getBoundingClientRect()
            const frame = Math.round((e.clientX - rect.left - PAD) * view.framePerPx)
            seek(clip.start + Math.max(0, Math.min(view.last, frame)))
          }}
        >
          {[0.25, 0.5, 0.75].map((t) => (
            <line
              key={t}
              x1={PAD}
              x2={WIDTH - PAD}
              y1={PAD + t * (HEIGHT - PAD * 2)}
              y2={PAD + t * (HEIGHT - PAD * 2)}
              stroke="currentColor"
              className="text-line"
              pointerEvents="none"
            />
          ))}
          <text x={4} y={PAD - 6} className="fill-faint text-[10px]" pointerEvents="none">
            {view.max.toFixed(2)}
          </text>
          <text x={4} y={HEIGHT - 6} className="fill-faint text-[10px]" pointerEvents="none">
            {view.min.toFixed(2)}
          </text>
          <line
            x1={playheadX}
            x2={playheadX}
            y1={0}
            y2={HEIGHT}
            stroke="white"
            strokeOpacity={playhead >= clip.start && playhead < clip.start + clip.duration ? 0.6 : 0}
            pointerEvents="none"
          />
          <path
            d={path.join(' ')}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2}
            pointerEvents="none"
          />
          {segment && bezier && (
            <g>
              {([0, 1] as const).map((which) => {
                const [hx, hy] = handlePoint(bezier[which * 2]!, bezier[which * 2 + 1]!)
                const [ax, ay] =
                  which === 0
                    ? [view.x(segment.f0), view.y(segment.v0)]
                    : [view.x(segment.f1), view.y(segment.v1)]
                return (
                  <g key={which}>
                    <line
                      x1={ax}
                      y1={ay}
                      x2={hx}
                      y2={hy}
                      stroke="white"
                      strokeOpacity={0.4}
                      pointerEvents="none"
                    />
                    <circle
                      cx={hx}
                      cy={hy}
                      r={5}
                      fill="var(--color-surface)"
                      stroke="white"
                      className="cursor-grab"
                      onPointerDown={(e) => dragHandle(e, which)}
                    />
                  </g>
                )
              })}
            </g>
          )}
          {keyframes.map((k, i) => (
            <rect
              key={i}
              x={view.x(k.frame) - 6}
              y={view.y(channelOf(k.value, channel)) - 6}
              width={12}
              height={12}
              transform={`rotate(45 ${view.x(k.frame)} ${view.y(channelOf(k.value, channel))})`}
              fill={i === index ? 'var(--color-accent)' : 'var(--color-surface)'}
              stroke={i === index ? 'white' : 'var(--color-accent)'}
              strokeWidth={1.5}
              className="cursor-move"
              onPointerDown={(e) => dragKeyframe(e, i)}
            />
          ))}
        </svg>
        {current && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-2xs text-faint">
              Keyframe {index + 1} of {keyframes.length} · frame {current.frame}
            </span>
            {EASING_BUTTONS.map((b) => (
              <Button
                key={b.label}
                disabled={!next}
                onClick={() =>
                  change('Change easing', (target) => {
                    const k = target.keyframes?.[index]
                    if (k) k.easing = b.easing
                  })
                }
              >
                {b.label}
              </Button>
            ))}
            <Button
              className="ml-auto hover:text-danger"
              onClick={() => {
                change('Remove keyframe', (target) => removeKeyframe(target, current.frame))
                setSelected(Math.max(0, index - 1))
              }}
            >
              <Trash2 size={13} /> Delete
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
