import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Diamond, Spline } from 'lucide-react'
import type { Draft } from 'immer'
import { evaluate, isAnimated, keyframeAt, removeKeyframe, setValueAt, upsertKeyframe } from '@core/index'
import type { Animatable, AnimValue, Clip, Easing, Vec2 } from '@core/index'
import { seek } from '@/engine/playback/session'
import { openDialog } from '@/store/dialogs'
import { beginTransaction, commitTransaction, useEditor } from '@/store/editor'
import { editClips, localFrame } from '@/store/clipEdits'
import { NumberInput } from '@/ui/NumberInput'

/** Picks one animatable property out of a clip; works on both the live clip and its Immer draft. */
export type AnimGetter<T extends AnimValue> = (clip: Clip | Draft<Clip>) => Animatable<T> | undefined

const EASINGS: Array<{ value: Exclude<Easing, object>; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease in' },
  { value: 'easeOut', label: 'Ease out' },
  { value: 'easeInOut', label: 'Ease in-out' },
  { value: 'hold', label: 'Hold' }
]

function KeyframeControls<T extends AnimValue>({
  clip,
  get,
  label
}: {
  clip: Clip
  get: AnimGetter<T>
  label: string
}) {
  useEditor((s) => s.playhead)
  const anim = get(clip)
  if (!anim) return null
  const frame = localFrame(clip)
  const current = keyframeAt(anim, frame)
  const animated = isAnimated(anim)
  const previous = [...(anim.keyframes ?? [])].reverse().find((k) => k.frame < frame)
  const next = anim.keyframes?.find((k) => k.frame > frame)
  const change = (title: string, fn: (a: Animatable<T>) => void): void =>
    editClips([clip.id], title, (draft) => {
      const target = get(draft)
      if (target) fn(target as Animatable<T>)
    })

  return (
    <span className="flex shrink-0 items-center">
      {animated && (
        <button
          className="text-faint hover:text-fg disabled:opacity-25"
          disabled={!previous}
          aria-label="Previous keyframe"
          title="Previous keyframe"
          onClick={() => previous && seek(clip.start + previous.frame)}
        >
          <ChevronLeft size={13} />
        </button>
      )}
      <button
        aria-label={current ? `Remove ${label} keyframe` : `Add ${label} keyframe`}
        title={current ? 'Remove keyframe' : 'Add keyframe at playhead'}
        aria-pressed={Boolean(current)}
        className={`flex size-5 items-center justify-center rounded hover:bg-hover ${animated ? 'text-accent' : 'text-faint hover:text-fg'}`}
        onClick={() =>
          change(current ? 'Remove keyframe' : 'Add keyframe', (a) =>
            current ? removeKeyframe(a, frame) : upsertKeyframe(a, frame)
          )
        }
      >
        <Diamond size={11} fill={current ? 'currentColor' : 'none'} />
      </button>
      {animated && (
        <button
          className="flex size-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
          aria-label={`Edit ${label} curve`}
          title="Edit the curve"
          onClick={() =>
            openDialog({ kind: 'curve', clipId: clip.id, label, get: get as AnimGetter<AnimValue> })
          }
        >
          <Spline size={12} />
        </button>
      )}
      {animated && (
        <button
          className="text-faint hover:text-fg disabled:opacity-25"
          disabled={!next}
          aria-label="Next keyframe"
          title="Next keyframe"
          onClick={() => next && seek(clip.start + next.frame)}
        >
          <ChevronRight size={13} />
        </button>
      )}
    </span>
  )
}

/** Easing of the keyframe under the playhead, on its own line so the value fields keep their width. */
function EasingRow<T extends AnimValue>({
  clip,
  get,
  label
}: {
  clip: Clip
  get: AnimGetter<T>
  label: string
}) {
  useEditor((s) => s.playhead)
  const anim = get(clip)
  const frame = localFrame(clip)
  const current = anim && keyframeAt(anim, frame)
  if (!current) return null
  return (
    <Row label="">
      <span className="shrink-0 text-2xs text-faint">Easing</span>
      <select
        aria-label={`${label} easing`}
        title="How the value moves towards the next keyframe"
        value={typeof current.easing === 'string' ? current.easing : 'easeInOut'}
        onChange={(e) =>
          editClips([clip.id], 'Change easing', (draft) => {
            const target = get(draft)
            const keyframe = target && keyframeAt(target, frame)
            if (keyframe) keyframe.easing = e.target.value as Easing
          })
        }
        className="h-6 min-w-0 flex-1 rounded border border-line bg-raised px-1 text-2xs text-muted outline-none"
      >
        {EASINGS.map((e) => (
          <option key={e.value} value={e.value}>
            {e.label}
          </option>
        ))}
      </select>
    </Row>
  )
}

interface NumberSpec {
  min?: number
  max?: number
  step?: number
  precision?: number
  suffix?: string
  /** Display multiplier, e.g. 100 to show 0-1 as percent. */
  display?: number
}

export function Row({
  label,
  children,
  trailing
}: {
  label: string
  children: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="w-[72px] shrink-0 truncate text-xs text-muted" title={label}>
        {label}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">{children}</span>
      {trailing}
    </div>
  )
}

const scrub = { onScrubStart: () => beginTransaction('Adjust'), onScrubEnd: commitTransaction }

export function AnimNumberRow({
  clip,
  get,
  label,
  spec = {}
}: {
  clip: Clip
  get: AnimGetter<number>
  label: string
  spec?: NumberSpec
}) {
  useEditor((s) => s.playhead)
  const anim = get(clip)
  if (!anim) return null
  const k = spec.display ?? 1
  return (
    <>
      <Row label={label} trailing={<KeyframeControls clip={clip} get={get} label={label} />}>
        <NumberInput
          label={label}
          value={evaluate(anim, localFrame(clip)) * k}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          precision={spec.precision ?? 1}
          suffix={spec.suffix}
          {...scrub}
          onChange={(v) =>
            editClips([clip.id], `Change ${label.toLowerCase()}`, (draft) => {
              const target = get(draft)
              if (target) setValueAt(target, localFrame(clip), v / k)
            })
          }
        />
      </Row>
      <EasingRow clip={clip} get={get} label={label} />
    </>
  )
}

export function AnimVec2Row({
  clip,
  get,
  label,
  labels,
  spec = {},
  linked = false
}: {
  clip: Clip
  get: AnimGetter<Vec2>
  label: string
  labels: [string, string]
  spec?: NumberSpec
  linked?: boolean
}) {
  useEditor((s) => s.playhead)
  const anim = get(clip)
  if (!anim) return null
  const k = spec.display ?? 1
  const value = evaluate(anim, localFrame(clip))
  const set = (index: 0 | 1, v: number): void =>
    editClips([clip.id], `Change ${label.toLowerCase()}`, (draft) => {
      const target = get(draft)
      if (!target) return
      const current = evaluate(target, localFrame(clip))
      const next: Vec2 = [current[0], current[1]]
      next[index] = v / k
      // Linked scale keeps the current proportions.
      if (linked)
        next[index === 0 ? 1 : 0] =
          current[index] !== 0 ? (current[index === 0 ? 1 : 0] * (v / k)) / current[index] : v / k
      setValueAt(target, localFrame(clip), next)
    })
  return (
    <>
      <Row label={label} trailing={<KeyframeControls clip={clip} get={get} label={label} />}>
        {([0, 1] as const).map((i) => (
          <NumberInput
            key={i}
            label={`${label} ${labels[i]}`}
            value={value[i] * k}
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            precision={spec.precision ?? 1}
            suffix={spec.suffix}
            {...scrub}
            onChange={(v) => set(i, v)}
          />
        ))}
      </Row>
      <EasingRow clip={clip} get={get} label={label} />
    </>
  )
}

export function Section({
  title,
  children,
  actions
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="border-b border-line px-3 py-2.5">
      <header className="mb-1.5 flex h-5 items-center justify-between">
        <h3 className="text-2xs font-semibold tracking-wider text-muted uppercase">{title}</h3>
        {actions}
      </header>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  )
}

export { scrub }
