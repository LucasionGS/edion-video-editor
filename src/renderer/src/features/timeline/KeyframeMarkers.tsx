import { animatablesOf, findClip, moveKeyframe } from '@core/index'
import type { Clip } from '@core/index'
import { seek } from '@/engine/playback/session'
import {
  beginTransaction,
  commitTransaction,
  edit,
  rollbackTransaction,
  select,
  useEditor
} from '@/store/editor'
import { startDrag } from './drag'

/** Frames (clip-relative, inside the clip) that carry a keyframe on any property. */
export function keyframeFrames(clip: Clip): number[] {
  const frames = new Set<number>()
  for (const anim of animatablesOf(clip)) {
    for (const k of anim.keyframes ?? []) if (k.frame >= 0 && k.frame < clip.duration) frames.add(k.frame)
  }
  return [...frames]
}

/**
 * Keyframe diamonds of one clip, positioned in lane coordinates. They live in the lane rather than
 * inside the clip element so they sit above the filmstrip canvas. Click jumps to the keyframe and
 * selects the clip; dragging retimes every property keyed on that frame.
 */
export function KeyframeMarkers({ clip, zoom, locked }: { clip: Clip; zoom: number; locked: boolean }) {
  const playhead = useEditor((s) => s.playhead)
  const frames = keyframeFrames(clip)
  if (frames.length === 0) return null
  return (
    <>
      {frames.map((frame) => {
        const current = playhead === clip.start + frame
        return (
          <button
            key={frame}
            type="button"
            data-keyframe
            aria-label="Keyframe"
            title={locked ? 'Keyframe — click to jump here' : 'Keyframe — click to jump here, drag to move'}
            className={`absolute bottom-1 z-[7] size-[9px] -translate-x-1/2 rotate-45 rounded-[1px] border border-black/70 shadow-sm shadow-black/60 hover:scale-125 ${
              current ? 'bg-accent' : 'bg-white'
            } ${locked ? 'cursor-pointer' : 'cursor-ew-resize'}`}
            // Kept a few pixels inside the clip so keyframes on the first/last frame stay fully visible and clickable.
            style={{
              left: Math.min(
                Math.max((clip.start + frame) * zoom, clip.start * zoom + 6),
                Math.max(clip.start * zoom + 6, (clip.start + clip.duration) * zoom - 6)
              )
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              let at = frame
              startDrag(e, {
                onStart: () => !locked && beginTransaction('Move keyframe'),
                onMove: (dx) => {
                  if (locked) return
                  const target = Math.max(
                    0,
                    Math.min(clip.duration - 1, frame + Math.round(dx / useEditor.getState().zoom))
                  )
                  if (target === at) return
                  const from = at
                  at = target
                  edit('Move keyframe', (draft) => {
                    const found = findClip(draft, clip.id)
                    if (found) for (const anim of animatablesOf(found.clip)) moveKeyframe(anim, from, target)
                  })
                },
                onEnd: (moved, cancelled) => {
                  if (!moved || locked) {
                    select([clip.id])
                    return seek(clip.start + frame)
                  }
                  if (cancelled) rollbackTransaction()
                  else commitTransaction()
                }
              })
            }}
          />
        )
      })}
    </>
  )
}
