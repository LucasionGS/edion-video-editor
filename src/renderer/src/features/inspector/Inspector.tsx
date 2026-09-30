import { useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Eye,
  EyeOff,
  Gauge,
  Italic,
  Pause,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Ungroup,
  Unlink
} from 'lucide-react'
import {
  ANIMATION_PRESETS,
  DEFAULT_ANIMATION_SECONDS,
  setClipAnimation,
  defaultTransform,
  detachAudio,
  EFFECTS,
  effectSpec,
  defaultEffectParams,
  findClip,
  hasEffects,
  isAudibleClip,
  isVisualClip,
  newId,
  parseCube,
  applySpeedRamp,
  hasRamp,
  setClipSpeed,
  SPEED_RAMP_PRESETS,
  setReversed
} from '@core/index'
import type {
  AdjustmentClip,
  AnimationPreset,
  BlendMode,
  Clip,
  Project,
  SpeedRampPreset,
  TextStyle,
  VisualClip
} from '@core/index'
import { edit, select, useEditor } from '@/store/editor'
import { editClips } from '@/store/clipEdits'
import {
  breakApartSelection,
  insertHoldAtPlayhead,
  normalizeLoudness,
  applyStyleToCaptions
} from '@/store/commands'
import { toast } from '@/store/feedback'
import { deleteEffectPreset, presetEffects, usePresets } from '@/store/presets'
import { openContextMenu } from '@/ui/ContextMenu'
import { AudioEffectsSection, MixerSection, PanRow } from './AudioSections'
import { MarkersSection } from './MarkersSection'
import { Button } from '@/ui/Button'
import { ColorInput } from '@/ui/ColorInput'
import { Segmented, Select } from '@/ui/Field'
import { IconButton } from '@/ui/IconButton'
import { NumberInput } from '@/ui/NumberInput'
import { EmptyState } from '@/ui/Panel'
import { AnimNumberRow, AnimVec2Row, Row, scrub, Section } from './anim'
import { useFontFamilies } from './fonts'
import { ProjectSettings } from './ProjectSettings'
import { TransitionInspector } from './TransitionInspector'

const BLEND_MODES: BlendMode[] = ['normal', 'add', 'multiply', 'screen', 'overlay', 'darken', 'lighten']
const percent = { display: 100, suffix: '%', step: 1, precision: 0 }

export function Inspector() {
  const selection = useEditor((s) => s.selection)
  const selectedTransition = useEditor((s) => s.selectedTransition)
  const clip = useEditor((s) =>
    s.selection.length === 1 ? findClip(s.project, s.selection[0]!)?.clip : undefined
  )

  if (selectedTransition) return <TransitionInspector id={selectedTransition} />
  if (selection.length === 0)
    return (
      <>
        <ProjectSettings />
        <MarkersSection />
        <MixerSection />
      </>
    )
  if (!clip) {
    return (
      <EmptyState
        icon={<SlidersHorizontal size={22} />}
        title={`${selection.length} clips selected`}
        hint="Select a single clip to edit its properties."
      />
    )
  }
  return (
    <div key={clip.id}>
      <ClipHeader clip={clip} />
      {(clip.type === 'text' || clip.type === 'caption') && <TextSection clip={clip} />}
      {clip.type === 'shape' && <ShapeSection clip={clip} />}
      {isVisualClip(clip) && <TransformSection clip={clip} />}
      {(clip.type === 'video' || clip.type === 'image') && <CropSection clip={clip} />}
      {(clip.type === 'video' || clip.type === 'audio') && <SpeedSection clip={clip} />}
      {isAudibleClip(clip) && !(clip.type === 'video' && (clip.audioMuted || clip.hold)) && (
        <>
          <AudioSection clip={clip} />
          <AudioEffectsSection clip={clip} />
        </>
      )}
      {isVisualClip(clip) && <AnimateSection clip={clip} />}
      {clip.type === 'compound' && (
        <Section title="Compound clip">
          <Row label="Volume">
            <NumberInput
              label="Compound volume"
              value={clip.volume * 100}
              min={0}
              max={400}
              step={1}
              precision={0}
              suffix="%"
              {...scrub}
              onChange={(v) =>
                editClips(
                  [clip.id],
                  'Change volume',
                  (c) => c.type === 'compound' && void (c.volume = Math.max(0, v / 100))
                )
              }
            />
          </Row>
          <Button className="mt-1 self-start" onClick={breakApartSelection}>
            <Ungroup size={13} /> Break apart
          </Button>
          <p className="text-2xs text-faint">
            Break it apart to edit the clips inside, then group them again.
          </p>
        </Section>
      )}
      {clip.type === 'adjustment' && (
        <Section title="Adjustment layer">
          <AnimNumberRow
            clip={clip}
            label="Opacity"
            get={(c) => (c.type === 'adjustment' ? c.opacity : undefined)}
            spec={{ ...percent, min: 0, max: 100 }}
          />
          <p className="text-2xs text-faint">Its effects apply to every track below it.</p>
        </Section>
      )}
      {hasEffects(clip) && <EffectsSection clip={clip} />}
    </div>
  )
}

function ClipHeader({ clip }: { clip: Clip }) {
  const fps = useEditor((s) => s.project.settings.fps)
  return (
    <div className="border-b border-line px-3 py-2.5">
      <input
        aria-label="Clip name"
        defaultValue={clip.name}
        key={clip.name}
        className="w-full rounded bg-transparent text-xs font-medium outline-none select-text focus:bg-bg focus:px-1.5 focus:ring-1 focus:ring-accent"
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
        }}
        onBlur={(e) => {
          const name = e.target.value.trim()
          if (name && name !== clip.name) editClips([clip.id], 'Rename clip', (c) => void (c.name = name))
        }}
      />
      <p className="mt-0.5 text-2xs text-faint capitalize">
        {clip.type} · {(clip.duration / fps).toFixed(2)} s
      </p>
    </div>
  )
}

function TransformSection({ clip }: { clip: VisualClip }) {
  const [linked, setLinked] = useState(true)
  return (
    <Section
      title="Transform"
      actions={
        <IconButton
          label="Reset transform"
          className="size-5"
          onClick={() =>
            editClips(
              [clip.id],
              'Reset transform',
              (c) => isVisualClip(c) && void (c.transform = defaultTransform())
            )
          }
        >
          <RotateCcw size={11} />
        </IconButton>
      }
    >
      <AnimVec2Row
        clip={clip}
        label="Position"
        labels={['X', 'Y']}
        get={(c) => (isVisualClip(c) ? c.transform.position : undefined)}
        spec={{ precision: 0, suffix: ' px' }}
      />
      <AnimVec2Row
        clip={clip}
        label="Scale"
        labels={['width', 'height']}
        linked={linked}
        get={(c) => (isVisualClip(c) ? c.transform.scale : undefined)}
        spec={{ ...percent, min: -1000, max: 1000 }}
      />
      <Row label="">
        <button
          className={`text-2xs ${linked ? 'text-accent' : 'text-faint hover:text-fg'}`}
          onClick={() => setLinked(!linked)}
        >
          {linked ? 'Proportions locked' : 'Proportions unlocked'}
        </button>
      </Row>
      <AnimNumberRow
        clip={clip}
        label="Rotation"
        get={(c) => (isVisualClip(c) ? c.transform.rotation : undefined)}
        spec={{ suffix: '°', step: 1, precision: 1 }}
      />
      <AnimNumberRow
        clip={clip}
        label="Opacity"
        get={(c) => (isVisualClip(c) ? c.transform.opacity : undefined)}
        spec={{ ...percent, min: 0, max: 100 }}
      />
      <Row label="Blend">
        <Select
          value={clip.blendMode}
          onChange={(e) =>
            editClips(
              [clip.id],
              'Change blend mode',
              (c) => isVisualClip(c) && void (c.blendMode = e.target.value as BlendMode)
            )
          }
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m} className="capitalize">
              {m[0]!.toUpperCase() + m.slice(1)}
            </option>
          ))}
        </Select>
      </Row>
    </Section>
  )
}

function CropSection({ clip }: { clip: Extract<Clip, { type: 'video' | 'image' }> }) {
  const field = (side: 'left' | 'top' | 'right' | 'bottom') => (
    <NumberInput
      key={side}
      label={`Crop ${side}`}
      value={clip.crop[side] * 100}
      min={0}
      max={95}
      precision={0}
      suffix="%"
      {...scrub}
      onChange={(v) => editClips([clip.id], 'Crop', (c) => 'crop' in c && void (c.crop[side] = v / 100))}
    />
  )
  return (
    <Section title="Crop">
      <Row label="Left · Right">{[field('left'), field('right')]}</Row>
      <Row label="Top · Bottom">{[field('top'), field('bottom')]}</Row>
    </Section>
  )
}

function SpeedSection({ clip }: { clip: Extract<Clip, { type: 'video' | 'audio' }> }) {
  const playhead = useEditor((s) => s.playhead)
  const fps = useEditor((s) => s.project.settings.fps)
  if (clip.type === 'video' && clip.hold) {
    return (
      <Section title="Frame hold">
        <p className="text-2xs text-faint">
          Shows one frame for {(clip.duration / fps).toFixed(2)} s. Trim it to change the length; use the slip
          tool to hold a different frame.
        </p>
      </Section>
    )
  }
  const underPlayhead =
    clip.type === 'video' && playhead >= clip.start && playhead < clip.start + clip.duration
  return (
    <Section title="Speed">
      <Row label="Speed">
        <NumberInput
          label="Speed"
          value={clip.speed * 100}
          min={5}
          max={1000}
          step={5}
          precision={0}
          suffix="%"
          {...scrub}
          onChange={(v) => edit('Change speed', (d) => setClipSpeed(d, clip.id, v / 100))}
        />
      </Row>
      <Row label="Direction">
        <Segmented
          value={clip.reversed ? 'reverse' : 'forward'}
          options={[
            { value: 'forward', label: 'Forward' },
            { value: 'reverse', label: 'Reverse' }
          ]}
          onChange={(v) =>
            edit(v === 'reverse' ? 'Reverse clip' : 'Play forward', (d) =>
              setReversed(d, clip.id, v === 'reverse')
            )
          }
        />
      </Row>
      {clip.type === 'video' && (
        <>
          <Row label="Ramp">
            <Select
              value=""
              onChange={(e) =>
                edit('Speed ramp', (d) => applySpeedRamp(d, clip.id, e.target.value as SpeedRampPreset))
              }
            >
              <option value="" disabled>
                {clip.speedRamp ? 'Custom ramp' : 'Apply a preset…'}
              </option>
              {SPEED_RAMP_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Row>
          {clip.speedRamp && (
            <AnimNumberRow
              clip={clip}
              label="Ramp speed"
              get={(c) => (c.type === 'video' ? c.speedRamp : undefined)}
              spec={{ ...percent, min: 5, max: 1000 }}
            />
          )}
          {hasRamp(clip) && (
            <p className="text-2xs text-faint">The clip is silent while a speed ramp is active.</p>
          )}
        </>
      )}
      {clip.type === 'video' && (
        <Button
          className="mt-1 self-start"
          disabled={!underPlayhead}
          title={underPlayhead ? undefined : 'Move the playhead over the clip first'}
          onClick={() => insertHoldAtPlayhead(clip.id)}
        >
          <Pause size={13} /> Insert frame hold
        </Button>
      )}
      <p className="text-2xs text-faint">Changing speed also changes pitch.</p>
    </Section>
  )
}

function AudioSection({ clip }: { clip: Extract<Clip, { type: 'video' | 'audio' }> }) {
  const fps = useEditor((s) => s.project.settings.fps)
  const fade = (key: 'fadeIn' | 'fadeOut', label: string) => (
    <Row label={label}>
      <NumberInput
        label={label}
        value={clip[key] / fps}
        min={0}
        max={clip.duration / fps}
        step={0.1}
        precision={1}
        suffix=" s"
        {...scrub}
        onChange={(v) =>
          editClips([clip.id], label, (c) => isAudibleClip(c) && void (c[key] = Math.round(v * fps)))
        }
      />
    </Row>
  )
  return (
    <Section title="Audio">
      <AnimNumberRow
        clip={clip}
        label="Volume"
        get={(c) => (isAudibleClip(c) ? c.volume : undefined)}
        spec={{ ...percent, min: 0, max: 400 }}
      />
      {fade('fadeIn', 'Fade in')}
      {fade('fadeOut', 'Fade out')}
      <PanRow
        label="Clip pan"
        value={clip.pan ?? 0}
        onChange={(pan) =>
          editClips([clip.id], 'Change pan', (c) => {
            if (!isAudibleClip(c)) return
            if (pan === 0) delete c.pan
            else c.pan = pan
          })
        }
      />
      <Button className="mt-1 self-start" onClick={() => void normalizeLoudness([clip.id])}>
        <Gauge size={13} /> Normalize loudness
      </Button>
      {clip.type === 'video' && (
        <Button
          className="mt-1 self-start"
          onClick={() => {
            let id: string | null = null
            edit('Detach audio', (d) => void (id = detachAudio(d, clip.id)))
            if (id) select([id])
          }}
        >
          <Unlink size={13} /> Detach audio
        </Button>
      )}
    </Section>
  )
}

function TextSection({ clip }: { clip: Extract<Clip, { type: 'text' | 'caption' }> }) {
  return (
    <Section title={clip.type === 'caption' ? 'Caption' : 'Text'}>
      <textarea
        aria-label="Text"
        value={clip.text}
        rows={3}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) =>
          editClips(
            [clip.id],
            'Edit text',
            (c) => (c.type === 'text' || c.type === 'caption') && void (c.text = e.target.value)
          )
        }
        className="w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 text-xs leading-relaxed outline-none select-text focus:border-accent"
      />
      {clip.type === 'text' ? (
        <>
          <TextStyleFields
            style={clip.style}
            onChange={(patch) =>
              editClips(
                [clip.id],
                'Change text style',
                (c) => c.type === 'text' && void Object.assign(c.style, patch)
              )
            }
          />
          <Row label="Wrap width">
            <NumberInput
              label="Wrap width"
              value={clip.boxWidth}
              min={0}
              max={10000}
              step={10}
              precision={0}
              suffix=" px"
              {...scrub}
              onChange={(v) =>
                editClips([clip.id], 'Change wrap width', (c) => c.type === 'text' && void (c.boxWidth = v))
              }
            />
          </Row>
          <Row label="Type on">
            <Select
              value={clip.reveal?.mode ?? 'none'}
              onChange={(e) => {
                const mode = e.target.value
                editClips([clip.id], 'Change type-on', (c) => {
                  if (c.type !== 'text') return
                  if (mode === 'none') delete c.reveal
                  else c.reveal = { mode: mode as 'letters' | 'words', seconds: c.reveal?.seconds ?? 1.5 }
                })
              }}
            >
              <option value="none">Off</option>
              <option value="letters">Letter by letter</option>
              <option value="words">Word by word</option>
            </Select>
          </Row>
          {clip.reveal && (
            <Row label="Duration">
              <NumberInput
                label="Type-on duration"
                value={clip.reveal.seconds}
                min={0.1}
                max={60}
                step={0.1}
                precision={1}
                suffix=" s"
                {...scrub}
                onChange={(v) =>
                  editClips([clip.id], 'Change type-on', (c) => {
                    if (c.type === 'text' && c.reveal) c.reveal.seconds = Math.max(0.1, v)
                  })
                }
              />
            </Row>
          )}
        </>
      ) : (
        <CaptionStyle />
      )}
    </Section>
  )
}

function CaptionStyle() {
  const style = useEditor((s) => s.project.captionStyle)
  const animation = useEditor((s) => s.project.captionAnimation)
  const fps = useEditor((s) => s.project.settings.fps)
  const saved = usePresets((s) => s.text)
  const animate = (label: string, change: (a: NonNullable<Project['captionAnimation']>) => void): void =>
    edit(label, (d) => {
      const next = { ...d.captionAnimation }
      change(next)
      d.captionAnimation = next
    })
  return (
    <>
      <p className="mt-1 text-2xs text-faint">Style (shared by all captions)</p>
      {saved.length > 0 && (
        <Row label="Saved style">
          <Select
            value=""
            onChange={(e) => {
              const found = saved.find((s) => s.name === e.target.value)
              if (found) applyStyleToCaptions(found.look, found.name)
            }}
          >
            <option value="" disabled>
              Use a saved style…
            </option>
            {saved.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
        </Row>
      )}
      <TextStyleFields
        style={style}
        onChange={(patch) => edit('Change caption style', (d) => void Object.assign(d.captionStyle, patch))}
      />
      <Row label="Type on">
        <Select
          value={animation?.reveal?.mode ?? 'none'}
          onChange={(e) =>
            animate('Caption type-on', (a) => {
              if (e.target.value === 'none') delete a.reveal
              else
                a.reveal = { mode: e.target.value as 'letters' | 'words', seconds: a.reveal?.seconds ?? 0.8 }
            })
          }
        >
          <option value="none">Off</option>
          <option value="letters">Letter by letter</option>
          <option value="words">Word by word</option>
        </Select>
      </Row>
      {animation?.reveal && (
        <Row label="Duration">
          <NumberInput
            label="Caption type-on duration"
            value={animation.reveal.seconds}
            min={0.1}
            max={10}
            step={0.1}
            precision={1}
            suffix=" s"
            {...scrub}
            onChange={(v) =>
              animate('Caption type-on', (a) => a.reveal && (a.reveal.seconds = Math.max(0.1, v)))
            }
          />
        </Row>
      )}
      <Row label="Fade">
        <NumberInput
          label="Caption fade"
          value={(animation?.fade ?? 0) / fps}
          min={0}
          max={2}
          step={0.05}
          precision={2}
          suffix=" s"
          {...scrub}
          onChange={(v) => animate('Caption fade', (a) => (a.fade = Math.round(Math.max(0, v) * fps)))}
        />
      </Row>
    </>
  )
}

export function TextStyleFields({
  style,
  onChange
}: {
  style: TextStyle
  onChange(patch: Partial<TextStyle>): void
}) {
  const fonts = useFontFamilies()
  const aligns = [
    { value: 'left', Icon: AlignLeft },
    { value: 'center', Icon: AlignCenter },
    { value: 'right', Icon: AlignRight }
  ] as const
  return (
    <>
      <Row label="Font">
        <Select value={style.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })}>
          {!fonts.includes(style.fontFamily) && <option>{style.fontFamily}</option>}
          {fonts.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </Select>
      </Row>
      <Row label="Size">
        <NumberInput
          label="Font size"
          value={style.fontSize}
          min={4}
          max={1000}
          precision={0}
          suffix=" px"
          {...scrub}
          onChange={(v) => onChange({ fontSize: v })}
        />
        <Select
          aria-label="Weight"
          className="max-w-24"
          value={style.fontWeight}
          onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
        >
          {[300, 400, 500, 600, 700, 800, 900].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Style">
        <IconButton label="Italic" active={style.italic} onClick={() => onChange({ italic: !style.italic })}>
          <Italic size={14} />
        </IconButton>
        <span className="mx-1 h-4 w-px bg-line" />
        {aligns.map(({ value, Icon }) => (
          <IconButton
            key={value}
            label={`Align ${value}`}
            active={style.align === value}
            onClick={() => onChange({ align: value })}
          >
            <Icon size={14} />
          </IconButton>
        ))}
      </Row>
      <Row label="Colour">
        <ColorInput label="Text colour" value={style.color} onChange={(color) => onChange({ color })} />
      </Row>
      <Row label="Spacing">
        <NumberInput
          label="Line height"
          value={style.lineHeight}
          min={0.5}
          max={4}
          step={0.05}
          precision={2}
          suffix="×"
          {...scrub}
          onChange={(v) => onChange({ lineHeight: v })}
        />
        <NumberInput
          label="Letter spacing"
          value={style.letterSpacing}
          min={-50}
          max={200}
          step={0.5}
          precision={1}
          suffix=" px"
          {...scrub}
          onChange={(v) => onChange({ letterSpacing: v })}
        />
      </Row>
      <Row label="Outline">
        <NumberInput
          label="Outline width"
          value={style.strokeWidth}
          min={0}
          max={100}
          step={0.5}
          precision={1}
          suffix=" px"
          {...scrub}
          onChange={(v) => onChange({ strokeWidth: v })}
        />
        <ColorInput
          label="Outline colour"
          value={style.strokeColor}
          onChange={(strokeColor) => onChange({ strokeColor })}
        />
      </Row>
      <Row label="Shadow">
        <NumberInput
          label="Shadow blur"
          value={style.shadowBlur}
          min={0}
          max={200}
          precision={0}
          suffix=" px"
          {...scrub}
          onChange={(v) => onChange({ shadowBlur: v })}
        />
        <ColorInput
          label="Shadow colour"
          alpha
          value={style.shadowColor}
          onChange={(shadowColor) => onChange({ shadowColor })}
        />
      </Row>
      <Row label="Box">
        <ColorInput
          label="Background colour"
          alpha
          value={style.backgroundColor}
          onChange={(backgroundColor) => onChange({ backgroundColor })}
        />
      </Row>
      <Row label="Box shape">
        <NumberInput
          label="Box padding"
          value={style.backgroundPadding}
          min={0}
          max={400}
          precision={0}
          suffix=" px"
          {...scrub}
          onChange={(v) => onChange({ backgroundPadding: v })}
        />
        <NumberInput
          label="Box corner radius"
          value={style.backgroundRadius}
          min={0}
          max={400}
          precision={0}
          suffix=" px"
          {...scrub}
          onChange={(v) => onChange({ backgroundRadius: v })}
        />
      </Row>
    </>
  )
}

function ShapeSection({ clip }: { clip: Extract<Clip, { type: 'shape' }> }) {
  const change = (label: string, fn: (c: Extract<Clip, { type: 'shape' }>) => void): void =>
    editClips([clip.id], label, (c) => c.type === 'shape' && fn(c))
  return (
    <Section title="Shape">
      <Row label="Size">
        <NumberInput
          label="Width"
          value={clip.size[0]}
          min={1}
          max={20000}
          precision={0}
          suffix=" px"
          {...scrub}
          onChange={(v) => change('Resize shape', (c) => void (c.size[0] = v))}
        />
        <NumberInput
          label="Height"
          value={clip.size[1]}
          min={1}
          max={20000}
          precision={0}
          suffix=" px"
          {...scrub}
          onChange={(v) => change('Resize shape', (c) => void (c.size[1] = v))}
        />
      </Row>
      <Row label="Fill">
        <ColorInput
          label="Fill"
          alpha
          value={clip.fill}
          onChange={(fill) => change('Change fill', (c) => void (c.fill = fill))}
        />
      </Row>
      <Row label="Outline">
        <NumberInput
          label="Outline width"
          value={clip.strokeWidth}
          min={0}
          max={500}
          precision={0}
          suffix=" px"
          {...scrub}
          onChange={(v) => change('Change outline', (c) => void (c.strokeWidth = v))}
        />
        <ColorInput
          label="Outline colour"
          value={clip.strokeColor}
          onChange={(color) => change('Change outline', (c) => void (c.strokeColor = color))}
        />
      </Row>
      {clip.shape === 'rect' && (
        <Row label="Corners">
          <NumberInput
            label="Corner radius"
            value={clip.cornerRadius}
            min={0}
            max={5000}
            precision={0}
            suffix=" px"
            {...scrub}
            onChange={(v) => change('Change corners', (c) => void (c.cornerRadius = v))}
          />
        </Row>
      )}
    </Section>
  )
}

function EffectsSection({ clip }: { clip: VisualClip | AdjustmentClip }) {
  const [adding, setAdding] = useState(false)
  const presets = usePresets((s) => s.effects)
  const change = (label: string, fn: (c: VisualClip | AdjustmentClip) => void): void =>
    editClips([clip.id], label, (c) => hasEffects(c) && fn(c))
  return (
    <Section
      title="Effects"
      actions={
        <IconButton label="Add effect" className="size-5" active={adding} onClick={() => setAdding(!adding)}>
          <Plus size={13} />
        </IconButton>
      }
    >
      {adding && (
        <div className="mb-1 grid grid-cols-2 gap-1">
          {EFFECTS.map((spec) => (
            <button
              key={spec.type}
              className="h-7 rounded-md border border-line bg-raised text-xs text-muted hover:border-accent hover:text-fg"
              onClick={async () => {
                setAdding(false)
                const resource = spec.resource ? await chooseResource(spec.resource.extensions) : undefined
                if (resource === null) return
                change(
                  `Add ${spec.label}`,
                  (c) =>
                    void c.effects.push({
                      id: newId(),
                      type: spec.type,
                      enabled: true,
                      params: defaultEffectParams(spec),
                      ...(resource ? { resource } : {})
                    })
                )
              }}
            >
              {spec.label}
            </button>
          ))}
        </div>
      )}
      {adding && presets.length > 0 && (
        <>
          <p className="mt-1 text-2xs text-faint">Presets (right-click to delete)</p>
          <div className="mb-1 grid grid-cols-2 gap-1">
            {presets.map((preset) => (
              <button
                key={preset.name}
                className="h-7 truncate rounded-md border border-dashed border-line bg-raised px-1 text-xs text-muted hover:border-accent hover:text-fg"
                title={preset.name}
                onClick={() => {
                  setAdding(false)
                  change(`Apply “${preset.name}”`, (c) => void c.effects.push(...presetEffects(preset)))
                }}
                onContextMenu={(e) =>
                  openContextMenu(e, [
                    {
                      label: `Delete “${preset.name}”`,
                      icon: <Trash2 size={13} />,
                      danger: true,
                      onSelect: () => void deleteEffectPreset(preset.name)
                    }
                  ])
                }
              >
                {preset.name}
              </button>
            ))}
          </div>
        </>
      )}
      {clip.effects.length === 0 && !adding && (
        <p className="text-2xs text-faint">No effects. Use + to add colour, blur, keying and more.</p>
      )}
      {clip.effects.map((effect, index) => {
        const spec = effectSpec(effect.type)
        if (!spec) return null
        return (
          <div
            key={effect.id}
            className={`rounded-lg border border-line bg-bg/60 p-2 ${effect.enabled ? '' : 'opacity-50'}`}
          >
            <header className="mb-1 flex items-center gap-1">
              <span className="flex-1 text-xs font-medium">{spec.label}</span>
              <IconButton
                label={effect.enabled ? 'Disable effect' : 'Enable effect'}
                className="size-5"
                onClick={() =>
                  change('Toggle effect', (c) => void (c.effects[index]!.enabled = !effect.enabled))
                }
              >
                {effect.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
              </IconButton>
              <IconButton
                label="Remove effect"
                className="size-5 hover:text-danger"
                onClick={() => change('Remove effect', (c) => void c.effects.splice(index, 1))}
              >
                <Trash2 size={12} />
              </IconButton>
            </header>
            <div className="flex flex-col gap-1">
              {spec.resource && (
                <Row label={spec.resource.label}>
                  <button
                    className="h-7 min-w-0 flex-1 truncate rounded-md border border-line bg-raised px-2 text-left text-xs text-muted hover:border-accent hover:text-fg"
                    title={effect.resource ?? 'Choose a file'}
                    onClick={async () => {
                      const resource = await chooseResource(spec.resource!.extensions)
                      if (resource)
                        change('Change LUT', (c) => {
                          const target = c.effects.find((e) => e.id === effect.id)
                          if (target) target.resource = resource
                        })
                    }}
                  >
                    {effect.resource ? effect.resource.split(/[\\/]/).pop() : 'Choose…'}
                  </button>
                </Row>
              )}
              {Object.entries(spec.params).map(([key, p]) =>
                p.options ? (
                  <Row key={key} label={p.label}>
                    <Segmented
                      value={String(Math.round(effect.params[key]?.value ?? p.default))}
                      options={p.options.map((label, i) => ({ value: String(i), label }))}
                      onChange={(v) =>
                        change(`Change ${p.label.toLowerCase()}`, (c) => {
                          const target = c.effects.find((e) => e.id === effect.id)
                          if (target) target.params[key] = { value: Number(v) }
                        })
                      }
                    />
                  </Row>
                ) : (
                  <AnimNumberRow
                    key={key}
                    clip={clip}
                    label={p.label}
                    get={(c) =>
                      hasEffects(c) ? c.effects.find((e) => e.id === effect.id)?.params[key] : undefined
                    }
                    spec={{
                      min: p.min,
                      max: p.max,
                      step: p.step,
                      precision: p.step < 1 ? 2 : 0,
                      suffix: p.unit ? ` ${p.unit}`.replace(' °', '°').replace(' %', '%') : ''
                    }}
                  />
                )
              )}
            </div>
          </div>
        )
      })}
    </Section>
  )
}

/**
 * Asks for an effect's file (a .cube LUT) and checks it can be read. Returns its path, or null when the
 * user cancelled or the file is unusable (after saying why).
 */
async function chooseResource(extensions: string[]): Promise<string | null> {
  const file = await window.edion.dialog.openText(extensions)
  if (!file) return null
  try {
    parseCube(file.content)
    return file.path
  } catch (error) {
    toast(`Cannot use this LUT: ${error instanceof Error ? error.message : String(error)}`, 'error')
    return null
  }
}

function AnimateSection({ clip }: { clip: VisualClip }) {
  const fps = useEditor((s) => s.project.settings.fps)
  const set = (edge: 'in' | 'out', preset: AnimationPreset, frames: number): void =>
    editClips(
      [clip.id],
      preset === 'none' ? `Remove ${edge === 'in' ? 'entrance' : 'exit'}` : `Animate ${edge}`,
      (c) => {
        if (isVisualClip(c)) setClipAnimation(c, edge, preset, frames)
      }
    )
  return (
    <Section title="Animate">
      {(['in', 'out'] as const).map((edge) => {
        const current = clip.animation?.[edge]
        return (
          <div key={edge} className="flex flex-col gap-1">
            <Row label={edge === 'in' ? 'Entrance' : 'Exit'}>
              <Select
                value={current?.preset ?? 'none'}
                onChange={(e) =>
                  set(
                    edge,
                    e.target.value as AnimationPreset,
                    current?.frames ?? Math.round(DEFAULT_ANIMATION_SECONDS * fps)
                  )
                }
              >
                {ANIMATION_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Row>
            {current && (
              <Row label="Length">
                <NumberInput
                  label={`${edge === 'in' ? 'Entrance' : 'Exit'} length`}
                  value={current.frames / fps}
                  min={1 / fps}
                  max={10}
                  step={0.05}
                  precision={2}
                  suffix=" s"
                  {...scrub}
                  onChange={(v) => set(edge, current.preset, Math.max(1, Math.round(v * fps)))}
                />
              </Row>
            )}
          </div>
        )
      })}
      <p className="text-2xs text-faint">
        Entrances and exits stay at the clip&apos;s edges when you trim or split it, on top of its own
        keyframes.
      </p>
    </Section>
  )
}
