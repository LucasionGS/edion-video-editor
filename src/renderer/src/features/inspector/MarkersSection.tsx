import { ClipboardList, Trash2 } from 'lucide-react'
import { chapterList, formatPosition } from '@core/index'
import { seek } from '@/engine/playback/session'
import { MARKER_COLORS, updateMarker } from '@/features/timeline/Ruler'
import { edit, useEditor } from '@/store/editor'
import { toast } from '@/store/feedback'
import { IconButton } from '@/ui/IconButton'
import { Section } from './anim'

/** Every marker with its name, colour and position; shown when nothing is selected. */
export function MarkersSection() {
  const markers = useEditor((s) => s.project.markers)
  const fps = useEditor((s) => s.project.settings.fps)
  const display = useEditor((s) => s.timeDisplay)
  if (markers.length === 0) return null
  const sorted = [...markers].sort((a, b) => a.frame - b.frame)
  return (
    <Section
      title="Markers"
      actions={
        <IconButton
          label="Copy as YouTube chapters"
          className="size-5"
          onClick={() => {
            window.edion.copyText(chapterList(useEditor.getState().project))
            toast('Chapters copied. Paste them into the video description.')
          }}
        >
          <ClipboardList size={12} />
        </IconButton>
      }
    >
      {sorted.map((marker) => (
        <div key={marker.id} className="group flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Change marker colour"
            title="Change colour"
            className="size-3 shrink-0 rounded-full ring-1 ring-black/40"
            style={{ background: marker.color }}
            onClick={() => {
              const index = MARKER_COLORS.findIndex((c) => c.value === marker.color)
              const next = MARKER_COLORS[(index + 1) % MARKER_COLORS.length]!.value
              updateMarker(marker.id, 'Change marker colour', (m) => void (m.color = next))
            }}
          />
          <button
            type="button"
            className="w-16 shrink-0 text-left font-mono text-2xs text-faint hover:text-fg"
            title="Go to marker"
            onClick={() => seek(marker.frame)}
          >
            {formatPosition(marker.frame, fps, display)}
          </button>
          <input
            defaultValue={marker.label}
            key={marker.label}
            placeholder="Name"
            aria-label="Marker name"
            className="h-6 min-w-0 flex-1 rounded bg-transparent px-1 text-xs outline-none select-text placeholder:text-faint hover:bg-hover focus:bg-bg focus:ring-1 focus:ring-accent"
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
            }}
            onBlur={(e) => {
              const label = e.target.value.trim()
              if (label !== marker.label)
                updateMarker(marker.id, 'Rename marker', (m) => void (m.label = label))
            }}
          />
          <IconButton
            label="Delete marker"
            className="size-5 opacity-0 group-hover:opacity-100 hover:text-danger"
            onClick={() =>
              edit('Delete marker', (d) => void (d.markers = d.markers.filter((m) => m.id !== marker.id)))
            }
          >
            <Trash2 size={11} />
          </IconButton>
        </div>
      ))}
    </Section>
  )
}
