import { Brush, Captions, Circle, SlidersHorizontal, Square, Trash2, Type } from 'lucide-react'
import { createAdjustmentClip, createShapeClip, createStyledTextClip, createTextClip } from '@core/index'
import type { TextClip } from '@core/index'
import { addGeneratedClip, applyTextStyle, applyStyleToCaptions } from '@/store/commands'
import { useEditor } from '@/store/editor'
import { deleteTextStyle, usePresets } from '@/store/presets'
import { openContextMenu } from '@/ui/ContextMenu'

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
    name: 'Typewriter',
    sample: 'Typing…',
    apply: (c, { height }) => {
      c.style.fontSize = Math.round(height * 0.07)
      c.style.fontFamily = 'monospace'
      c.style.fontWeight = 500
      c.reveal = { mode: 'letters', seconds: 1.5 }
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
      <MyStyles />
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

/** Text styles the user saved (right-click a text clip → “Save as text style…”), for every project. */
function MyStyles() {
  const styles = usePresets((s) => s.text)
  return (
    <Group title="My styles">
      {styles.length === 0 && (
        <p className="col-span-full text-2xs text-faint">
          Style a text clip the way you like, then right-click it and choose “Save as text style…”.
        </p>
      )}
      {styles.map(({ name, look }) => (
        <button
          key={name}
          className={`${card} overflow-hidden px-1`}
          title={`Add “${name}” at the playhead. Right-click for more.`}
          onClick={() =>
            addGeneratedClip(`Add ${name}`, (start, settings) =>
              createStyledTextClip(start, settings.fps, 'Your text', look)
            )
          }
          onContextMenu={(e) =>
            openContextMenu(e, [
              {
                label: 'Apply to selected text',
                icon: <Brush size={13} />,
                disabled: !useEditor.getState().selection.length,
                onSelect: () => applyTextStyle(look, name)
              },
              {
                label: 'Use for captions',
                icon: <Captions size={13} />,
                onSelect: () => applyStyleToCaptions(look, name)
              },
              { type: 'separator' },
              {
                label: `Delete “${name}”`,
                icon: <Trash2 size={13} />,
                danger: true,
                onSelect: () => void deleteTextStyle(name)
              }
            ])
          }
        >
          <span
            className="max-w-full truncate text-sm leading-tight"
            style={{
              fontFamily: `"${look.style.fontFamily}", "Inter Variable", sans-serif`,
              fontWeight: look.style.fontWeight,
              fontStyle: look.style.italic ? 'italic' : 'normal',
              color: look.style.color,
              WebkitTextStroke: look.style.strokeWidth ? `1px ${look.style.strokeColor}` : undefined,
              background: look.style.backgroundColor,
              padding: '1px 4px',
              borderRadius: 4
            }}
          >
            Aa
          </span>
          <span className="max-w-full truncate text-2xs">{name}</span>
        </button>
      ))}
    </Group>
  )
}
