import { useState } from 'react'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { AUDIO_EFFECTS, audioEffectSpec, defaultEffectParams, isAudibleClip, newId } from '@core/index'
import type { AudibleClip, Track } from '@core/index'
import { editClips } from '@/store/clipEdits'
import { edit, useEditor } from '@/store/editor'
import { IconButton } from '@/ui/IconButton'
import { NumberInput } from '@/ui/NumberInput'
import { Row, scrub, Section } from './anim'

const toDb = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : -60)
const fromDb = (db: number): number => (db <= -60 ? 0 : 10 ** (db / 20))

/** Stereo balance as −100 (left) … 100 (right). */
export function PanRow({
  value,
  label,
  onChange
}: {
  value: number
  label: string
  onChange: (pan: number) => void
}) {
  return (
    <Row label="Pan">
      <NumberInput
        label={label}
        value={value * 100}
        min={-100}
        max={100}
        step={1}
        precision={0}
        suffix={value < 0 ? ' L' : value > 0 ? ' R' : ''}
        {...scrub}
        onChange={(v) => onChange(Math.max(-1, Math.min(1, v / 100)))}
      />
    </Row>
  )
}

export function AudioEffectsSection({ clip }: { clip: AudibleClip }) {
  const [adding, setAdding] = useState(false)
  const effects = clip.audioEffects ?? []
  const change = (label: string, fn: (c: AudibleClip) => void): void =>
    editClips([clip.id], label, (c) => isAudibleClip(c) && fn(c))
  return (
    <Section
      title="Audio effects"
      actions={
        <IconButton
          label="Add audio effect"
          className="size-5"
          active={adding}
          onClick={() => setAdding(!adding)}
        >
          <Plus size={13} />
        </IconButton>
      }
    >
      {adding && (
        <div className="mb-1 grid grid-cols-2 gap-1">
          {AUDIO_EFFECTS.map((spec) => (
            <button
              key={spec.type}
              className="h-7 truncate rounded-md border border-line bg-raised px-1 text-xs text-muted hover:border-accent hover:text-fg"
              onClick={() => {
                setAdding(false)
                change(`Add ${spec.label}`, (c) => {
                  c.audioEffects ??= []
                  c.audioEffects.push({
                    id: newId(),
                    type: spec.type,
                    enabled: true,
                    params: defaultEffectParams(spec)
                  })
                })
              }}
            >
              {spec.label}
            </button>
          ))}
        </div>
      )}
      {effects.length === 0 && !adding && (
        <p className="text-2xs text-faint">
          No audio effects. Use + to add an equalizer, filters or a compressor.
        </p>
      )}
      {effects.map((effect, index) => {
        const spec = audioEffectSpec(effect.type)
        if (!spec) return null
        return (
          <div
            key={effect.id}
            className={`rounded-lg border border-line bg-bg/60 p-2 ${effect.enabled ? '' : 'opacity-50'}`}
          >
            <header className="mb-1 flex items-center gap-1">
              <span className="flex-1 text-xs font-medium">{spec.label}</span>
              <IconButton
                label={effect.enabled ? 'Bypass effect' : 'Enable effect'}
                className="size-5"
                onClick={() =>
                  change(
                    'Toggle audio effect',
                    (c) => void (c.audioEffects![index]!.enabled = !effect.enabled)
                  )
                }
              >
                {effect.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
              </IconButton>
              <IconButton
                label="Remove effect"
                className="size-5 hover:text-danger"
                onClick={() => change('Remove audio effect', (c) => void c.audioEffects!.splice(index, 1))}
              >
                <Trash2 size={12} />
              </IconButton>
            </header>
            {Object.entries(spec.params).map(([key, p]) => (
              <Row key={key} label={p.label}>
                <NumberInput
                  label={p.label}
                  value={effect.params[key]?.value ?? p.default}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  precision={p.step < 1 ? 1 : 0}
                  suffix={p.unit ?? ''}
                  {...scrub}
                  onChange={(v) =>
                    change(`Change ${p.label}`, (c) => {
                      const target = c.audioEffects?.find((e) => e.id === effect.id)
                      if (target) target.params[key] = { value: v }
                    })
                  }
                />
              </Row>
            ))}
          </div>
        )
      })}
    </Section>
  )
}

/** Volume and pan per track, shown in the inspector when nothing is selected. */
export function MixerSection() {
  const tracks = useEditor((s) => s.project.tracks)
  const audible = tracks.filter((t) => t.kind !== 'caption')
  if (audible.length === 0) return null
  const patch = (track: Track, label: string, change: Partial<Track>): void =>
    edit(label, (draft) => {
      const target = draft.tracks.find((t) => t.id === track.id)
      if (target) Object.assign(target, change)
    })
  return (
    <Section title="Mixer">
      {audible.map((track) => (
        <div key={track.id} className="flex items-center gap-1.5">
          <span className="w-[72px] shrink-0 truncate text-xs text-muted" title={track.name}>
            {track.name}
          </span>
          <NumberInput
            label={`${track.name} volume`}
            value={toDb(track.volume ?? 1)}
            min={-60}
            max={12}
            step={0.5}
            precision={1}
            suffix=" dB"
            {...scrub}
            onChange={(db) => patch(track, 'Track volume', { volume: fromDb(db) })}
          />
          <NumberInput
            label={`${track.name} pan`}
            value={(track.pan ?? 0) * 100}
            min={-100}
            max={100}
            step={1}
            precision={0}
            suffix={(track.pan ?? 0) < 0 ? ' L' : (track.pan ?? 0) > 0 ? ' R' : ''}
            {...scrub}
            onChange={(v) => patch(track, 'Track pan', { pan: Math.max(-1, Math.min(1, v / 100)) })}
          />
        </div>
      ))}
    </Section>
  )
}
