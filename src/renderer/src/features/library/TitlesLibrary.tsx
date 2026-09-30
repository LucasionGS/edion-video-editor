import { Circle, SlidersHorizontal, Square, Type } from 'lucide-react'
import { createAdjustmentClip, createShapeClip, createTextClip } from '@core/index'
import type { TextClip } from '@core/index'
import { addGeneratedClip } from '@/store/commands'

interface TitlePreset {
  name: string
  sample: string
  apply(clip: TextClip, canvas: { width: number; height: number }): void
}

const TITLES: TitlePreset[] = [
  {
    name: 'Title',
    sample: 'Title',
    apply: (c, { height }) => void (c.style.fontSize = Math.round(height * 0.11))
  },
  {
    name: 'Subtitle',
    sample: 'Subtitle',
    apply: (c, { height }) => {
      c.style.fontSize = Math.round(height * 0.055)
      c.style.fontWeight = 500
      c.transform.position.value = [0, height * 0.12]
    }
  },
  {
    name: 'Lower third',
    sample: 'Name · Role',
    apply: (c, { width, height }) => {
      c.style.fontSize = Math.round(height * 0.042)
      c.style.fontWeight = 600
      c.style.align = 'left'
      c.style.backgroundColor = '#000000b3'
      c.style.backgroundPadding = Math.round(height * 0.018)
      c.transform.anchor = [0, 1]
      c.transform.position.value = [-width * 0.44, height * 0.4]
    }
  },
  {
    name: 'Outline',
    sample: 'OUTLINE',
    apply: (c, { height }) => {
      c.style.fontSize = Math.round(height * 0.12)
      c.style.fontWeight = 900
      c.style.strokeWidth = Math.round(height * 0.006)
      c.style.strokeColor = '#000000'
    }
  },
  {
    name: 'Shadow',
    sample: 'Shadow',
    apply: (c, { height }) => {
      c.style.fontSize = Math.round(height * 0.1)
      c.style.shadowBlur = Math.round(height * 0.02)
      c.style.shadowColor = '#000000cc'
    }
  },
  {
    name: 'Label',
    sample: 'Label',
    apply: (c, { height }) => {
      c.style.fontSize = Math.round(height * 0.04)
      c.style.color = '#111111'
      c.style.backgroundColor = '#ffffff'
      c.style.backgroundPadding = Math.round(height * 0.015)
      c.style.backgroundRadius = 999
    }
  }
]

const card =
  'flex aspect-video flex-col items-center justify-center gap-1 rounded-md border border-line bg-raised text-muted transition-colors hover:border-accent hover:text-fg'

export function TitlesLibrary() {
  return (
    <div className="flex flex-col gap-3 overflow-auto p-3">
      <Group title="Text">
        {TITLES.map((preset) => (
          <button
            key={preset.name}
            className={card}
            title={`Add “${preset.name}” at the playhead`}
            onClick={() =>
              addGeneratedClip(`Add ${preset.name.toLowerCase()}`, (start, settings) => {
                const clip = createTextClip(start, settings.fps, preset.sample)
                preset.apply(clip, settings)
                return clip
              })
            }
          >
            <Type size={16} />
            <span className="text-2xs">{preset.name}</span>
          </button>
        ))}
      </Group>
      <Group title="Shapes">
        <button
          className={card}
          onClick={() =>
            addGeneratedClip('Add rectangle', (start, { fps }) => createShapeClip(start, fps, 'rect'))
          }
        >
          <Square size={16} />
          <span className="text-2xs">Rectangle</span>
        </button>
        <button
          className={card}
          onClick={() =>
            addGeneratedClip('Add ellipse', (start, { fps }) => createShapeClip(start, fps, 'ellipse'))
          }
        >
          <Circle size={16} />
          <span className="text-2xs">Ellipse</span>
        </button>
      </Group>
      <Group title="Layers">
        <button
          className={card}
          title="Applies its effects to everything below it"
          onClick={() =>
            addGeneratedClip('Add adjustment layer', (start, { fps }) => createAdjustmentClip(start, fps))
          }
        >
          <SlidersHorizontal size={16} />
          <span className="text-2xs">Adjustment layer</span>
        </button>
      </Group>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-2xs font-semibold tracking-wider text-faint uppercase">{title}</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">{children}</div>
    </section>
  )
}
