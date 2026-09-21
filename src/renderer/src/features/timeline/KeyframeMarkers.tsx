import { animatablesOf, findClip, moveKeyframe } from '@core/index'
import type { Clip } from '@core/index'
import { seek } from '@/engine/playback/session'
import { beginTransaction, commitTransaction, edit, rollbackTransaction, useEditor } from '@/store/editor'
import { startDrag } from './drag'

/** Diamonds along the bottom of a selected clip: one per frame that has any keyframe. Drag to retime, click to jump. */
export function KeyframeMarkers({ clip, zoom }: { clip: Clip; zoom: number }) {
  const frames = [...new Set(animatablesOf(clip).flatMap((a) => a.keyframes?.map((k) => k.frame) ?? []))]
  if (frames.length === 0) return null
  return (
    <>
      {frames.map((frame) => (
        <button
          key={frame}
          type="button"
          aria-label="Keyframe"
          title="Keyframe — drag to move, click to jump"
          className="absolute bottom-0.5 z-[6] size-2.5 -translate-x-1/2 rotate-45 cursor-ew-resize rounded-[1px] border border-black/60 bg-white hover:bg-accent"
          style={{ left: frame * zoom }}
          onPointerDown={(e) => {
            e.stopPropagation()
            let current = frame
            startDrag(e, {
              onStart: () => beginTransaction('Move keyframe'),
              onMove: (dx) => {
                const target = Math.max(
                  0,
                  Math.min(clip.duration - 1, frame + Math.round(dx / useEditor.getState().zoom))
                )
                if (target === current) return
                const from = current
                current = target
                edit('Move keyframe', (draft) => {
                  const found = findClip(draft, clip.id)
                  if (found) for (const anim of animatablesOf(found.clip)) moveKeyframe(anim, from, target)
                })
              },
              onEnd: (moved, cancelled) => {
                if (!moved) return seek(clip.start + frame)
                if (cancelled) rollbackTransaction()
                else commitTransaction()
              }
            })
          }}
        />
      ))}
    </>
  )
}
