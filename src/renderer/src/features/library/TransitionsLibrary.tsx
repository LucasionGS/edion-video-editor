import { TRANSITIONS } from '@core/index'
import { applyTransition } from '@/store/commands'
import { toast } from '@/store/feedback'

export function TransitionsLibrary() {
  return (
    <div className="flex flex-col gap-2 overflow-auto p-3">
      <p className="text-2xs leading-relaxed text-faint">
        Click a transition to put it on the cut next to the selected clip (or the cut nearest the playhead).
        The two clips must touch.
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
        {TRANSITIONS.map((t) => (
          <button
            key={t.type}
            className="group flex aspect-video flex-col items-center justify-center gap-1.5 rounded-md border border-line bg-raised text-muted transition-colors hover:border-accent hover:text-fg"
            onClick={() => {
              if (!applyTransition(t.type))
                toast('No cut found: place two clips next to each other on a video track first.')
            }}
          >
            <span className="flex h-4 w-9 overflow-hidden rounded-sm">
              <span className="h-full flex-1 bg-clip-video" />
              <span className="h-full flex-1 bg-gradient-to-r from-clip-video to-clip-image" />
              <span className="h-full flex-1 bg-clip-image" />
            </span>
            <span className="text-2xs">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
