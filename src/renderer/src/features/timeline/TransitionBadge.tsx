import { Blend } from 'lucide-react'
import type { Track, Transition } from '@core/index'
import { removeTransition } from '@core/index'
import { edit, selectTransition, useEditor } from '@/store/editor'
import { openContextMenu } from '@/ui/ContextMenu'

/** The marker drawn over a cut that has a transition; its width shows the transition's length. */
export function TransitionBadge({
  track,
  transition,
  zoom
}: {
  track: Track
  transition: Transition
  zoom: number
}) {
  const selected = useEditor((s) => s.selectedTransition === transition.id)
  const right = track.clips.find((c) => c.id === transition.rightClipId)
  if (!right) return null
  const width = Math.max(14, transition.duration * zoom)
  return (
    <button
      type="button"
      aria-label="Transition"
      title="Transition — click to edit, Delete to remove"
      className={`absolute top-[18px] z-[6] flex items-center justify-center rounded-sm border text-white backdrop-blur-sm ${
        selected ? 'border-white bg-accent' : 'border-white/40 bg-black/50 hover:bg-accent/70'
      }`}
      style={{ left: right.start * zoom - width / 2, width, height: Math.max(14, track.height - 26) }}
      onPointerDown={(e) => {
        e.stopPropagation()
        selectTransition(transition.id)
      }}
      onContextMenu={(e) => {
        e.stopPropagation()
        selectTransition(transition.id)
        openContextMenu(e, [
          {
            label: 'Remove transition',
            danger: true,
            onSelect: () => {
              edit('Remove transition', (d) => removeTransition(d, transition.id))
              selectTransition(null)
            }
          }
        ])
      }}
    >
      <Blend size={11} />
    </button>
  )
}
