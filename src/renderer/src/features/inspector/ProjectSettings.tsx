import { edit, useEditor } from '@/store/editor'
import { ColorInput } from '@/ui/ColorInput'
import { Select } from '@/ui/Field'
import { NumberInput } from '@/ui/NumberInput'
import { Row, Section } from './anim'

const FORMATS = [
  { label: 'Landscape 16:9 · 1080p', width: 1920, height: 1080 },
  { label: 'Landscape 16:9 · 4K', width: 3840, height: 2160 },
  { label: 'Landscape 16:9 · 720p', width: 1280, height: 720 },
  { label: 'Vertical 9:16 · 1080×1920', width: 1080, height: 1920 },
  { label: 'Square 1:1 · 1080', width: 1080, height: 1080 },
  { label: 'Portrait 4:5 · 1080×1350', width: 1080, height: 1350 },
  { label: 'Cinema 21:9 · 2560×1080', width: 2560, height: 1080 }
]
const RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]

/** Shown in the inspector when nothing is selected. */
export function ProjectSettings() {
  const settings = useEditor((s) => s.project.settings)
  const hasClips = useEditor((s) => s.project.tracks.some((t) => t.clips.length > 0))
  const format = FORMATS.find((f) => f.width === settings.width && f.height === settings.height)
  const resize = (width: number, height: number): void =>
    edit('Change project size', (d) => {
      d.settings.width = Math.max(16, Math.round(width / 2) * 2)
      d.settings.height = Math.max(16, Math.round(height / 2) * 2)
    })

  return (
    <Section title="Project">
      <Row label="Format">
        <Select
          value={format ? format.label : 'custom'}
          onChange={(e) => {
            const next = FORMATS.find((f) => f.label === e.target.value)
            if (next) resize(next.width, next.height)
          }}
        >
          {!format && <option value="custom">Custom</option>}
          {FORMATS.map((f) => (
            <option key={f.label}>{f.label}</option>
          ))}
        </Select>
      </Row>
      <Row label="Size">
        <NumberInput
          label="Width"
          value={settings.width}
          min={16}
          max={8192}
          step={2}
          precision={0}
          suffix=" px"
          onChange={(v) => resize(v, settings.height)}
        />
        <NumberInput
          label="Height"
          value={settings.height}
          min={16}
          max={8192}
          step={2}
          precision={0}
          suffix=" px"
          onChange={(v) => resize(settings.width, v)}
        />
      </Row>
      <Row label="Frame rate">
        <Select
          value={settings.fps}
          disabled={hasClips}
          title={hasClips ? 'The frame rate is fixed once the timeline has clips' : undefined}
          onChange={(e) => edit('Change frame rate', (d) => void (d.settings.fps = Number(e.target.value)))}
        >
          {!RATES.includes(settings.fps) && <option value={settings.fps}>{settings.fps} fps</option>}
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r} fps
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Background">
        <ColorInput
          label="Background"
          value={settings.background}
          onChange={(background) =>
            edit('Change background', (d) => void (d.settings.background = background))
          }
        />
      </Row>
      <p className="mt-1 text-2xs leading-relaxed text-faint">
        The first video you import sets the size and frame rate automatically. Select a clip to edit its
        properties.
      </p>
    </Section>
  )
}
