import { Trash2 } from 'lucide-react'
import { removeTransition, TRANSITIONS } from '@core/index'
import type { Id, Transition } from '@core/index'
import { edit, selectTransition, useEditor } from '@/store/editor'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/Field'
import { NumberInput } from '@/ui/NumberInput'
import { Row, scrub, Section } from './anim'

export function TransitionInspector({ id }: { id: Id }) {
  const fps = useEditor((s) => s.project.settings.fps)
  const transition = useEditor((s) => s.project.tracks.flatMap((t) => t.transitions).find((t) => t.id === id))
  const audio = useEditor(
    (s) => s.project.tracks.find((t) => t.transitions.some((x) => x.id === id))?.kind === 'audio'
  )
  if (!transition) return null
  const change = (label: string, fn: (t: Transition) => void): void =>
    edit(label, (draft) => {
      const target = draft.tracks.flatMap((t) => t.transitions).find((t) => t.id === id)
      if (target) fn(target)
    })
  return (
    <Section title="Transition">
      <Row label="Type">
        {audio ? (
          <span className="text-xs">Crossfade (equal power)</span>
        ) : (
          <Select
            value={transition.type}
            onChange={(e) => change('Change transition', (t) => void (t.type = e.target.value))}
          >
            {TRANSITIONS.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </Select>
        )}
      </Row>
      <Row label="Duration">
        <NumberInput
          label="Duration"
          value={transition.duration / fps}
          min={2 / fps}
          max={10}
          step={0.05}
          precision={2}
          suffix=" s"
          {...scrub}
          onChange={(v) =>
            // Re-applying through the op keeps the length even and within what both clips allow.
            edit('Change transition duration', (draft) => {
              for (const track of draft.tracks) {
                const target = track.transitions.find((t) => t.id === id)
                if (!target) continue
                const frames = Math.max(2, Math.round((v * fps) / 2) * 2)
                const left = track.clips.find((c) => c.id === target.leftClipId)
                const right = track.clips.find((c) => c.id === target.rightClipId)
                const max = Math.min(left?.duration ?? 2, right?.duration ?? 2) * 2
                target.duration = Math.min(frames, max - (max % 2))
              }
            })
          }
        />
      </Row>
      <Button
        className="mt-1 self-start"
        onClick={() => {
          edit('Remove transition', (d) => removeTransition(d, id))
          selectTransition(null)
        }}
      >
        <Trash2 size={13} /> Remove
      </Button>
    </Section>
  )
}
