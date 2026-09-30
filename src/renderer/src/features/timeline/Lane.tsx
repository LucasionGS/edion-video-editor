import { useShallow } from 'zustand/react/shallow'
import { clipEnd, findClip } from '@core/index'
import type { Track } from '@core/index'
import { useEditor } from '@/store/editor'
import { ClipView } from './ClipView'
import { KeyframeMarkers } from './KeyframeMarkers'
import { TransitionBadge } from './TransitionBadge'
import { useTimelineView } from './view'

const OVERSCAN = 400

/** Clip elements for one track. Only clips near the viewport exist in the DOM. */
export function Lane({ track, width }: { track: Track; width: number }) {
  const zoom = useEditor((s) => s.zoom)
  const selection = useEditor((s) => s.selection)
  // Link ids of the selected clips, so their partners (which edits will include) are highlighted too.
  const selectedLinks = useEditor(
    useShallow((s) =>
      s.linkedSelection
        ? s.selection.flatMap((id) => {
            const linkId = findClip(s.project, id)?.clip.linkId
            return linkId ? [linkId] : []
          })
        : []
    )
  )
  const missingMedia = useEditor((s) => s.missingMedia)
  const scrollLeft = useTimelineView((s) => s.scrollLeft)
  const viewportWidth = useTimelineView((s) => s.viewportWidth)
  const from = (scrollLeft - OVERSCAN) / zoom
  const to = (scrollLeft + viewportWidth + OVERSCAN) / zoom

  return (
    <div
      data-track-lane={track.id}
      className={`relative shrink-0 border-b border-line ${track.locked ? 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,#ffffff06_6px_12px)]' : ''}`}
      style={{ width, height: track.height }}
    >
      {track.clips.map((clip) =>
        clipEnd(clip) < from || clip.start > to ? null : (
          <ClipView
            key={clip.id}
            clip={clip}
            zoom={zoom}
            height={track.height}
            selected={selection.includes(clip.id)}
            partnerSelected={clip.linkId !== undefined && selectedLinks.includes(clip.linkId)}
            locked={track.locked}
            missing={'mediaId' in clip && missingMedia.includes(clip.mediaId)}
          />
        )
      )}
      {track.clips.map((clip) =>
        clipEnd(clip) < from || clip.start > to ? null : (
          <KeyframeMarkers key={clip.id} clip={clip} zoom={zoom} locked={track.locked} />
        )
      )}
      {track.transitions.map((t) => (
        <TransitionBadge key={t.id} track={track} transition={t} zoom={zoom} />
      ))}
    </div>
  )
}
