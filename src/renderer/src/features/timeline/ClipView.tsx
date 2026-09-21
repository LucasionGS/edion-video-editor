import { memo } from 'react'
import { AudioLines, Captions, Film, ImageIcon, Shapes, Type } from 'lucide-react'
import type { Clip } from '@core/index'
import { clipMenuItems, selectForMenu } from '@/store/clipMenu'
import { useEditor } from '@/store/editor'
import { openContextMenu } from '@/ui/ContextMenu'
import { KeyframeMarkers } from './KeyframeMarkers'
import { beginClipMove, beginClipTrim, razorAt } from './clipDrag'
import { useTimelineView } from './view'

const look: Record<Clip['type'], { color: string; Icon: typeof Film }> = {
  video: { color: 'var(--color-clip-video)', Icon: Film },
  audio: { color: 'var(--color-clip-audio)', Icon: AudioLines },
  image: { color: 'var(--color-clip-image)', Icon: ImageIcon },
  text: { color: 'var(--color-clip-text)', Icon: Type },
  shape: { color: 'var(--color-clip-text)', Icon: Shapes },
  caption: { color: '#2b8a9e', Icon: Captions }
}

interface Props {
  clip: Clip
  zoom: number
  height: number
  selected: boolean
  locked: boolean
  missing: boolean
}

export const ClipView = memo(function ClipView({ clip, zoom, height, selected, locked, missing }: Props) {
  const { color, Icon } = look[clip.type]
  const width = Math.max(2, clip.duration * zoom)
  const frameAt = (e: React.PointerEvent | React.MouseEvent): number => {
    const left = e.currentTarget.getBoundingClientRect().left
    return clip.start + Math.round((e.clientX - left) / zoom)
  }

  return (
    <div
      data-clip-id={clip.id}
      className={`group/clip absolute top-0.5 overflow-hidden rounded-[5px] ${locked ? 'opacity-60' : ''} ${
        selected ? 'z-[3] ring-2 ring-white' : 'z-[2] ring-1 ring-black/40 hover:ring-white/50'
      }`}
      style={{
        left: clip.start * zoom,
        width,
        height: height - 4,
        background: `color-mix(in srgb, ${missing ? 'var(--color-danger)' : color} ${selected ? 55 : 38}%, var(--color-bg))`
      }}
      onContextMenu={(e) => {
        e.stopPropagation()
        if (locked) return e.preventDefault()
        selectForMenu(clip.id)
        openContextMenu(e, clipMenuItems())
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 || locked) return
        e.stopPropagation()
        if (useEditor.getState().tool === 'razor') return razorAt(clip.id, frameAt(e))
        beginClipMove(e, clip.id)
      }}
      onPointerMove={(e) => {
        if (useEditor.getState().tool === 'razor') useTimelineView.setState({ razorFrame: frameAt(e) })
      }}
      onPointerLeave={() =>
        useTimelineView.getState().razorFrame !== null && useTimelineView.setState({ razorFrame: null })
      }
    >
      <div
        className="relative z-[2] flex h-3.5 items-center gap-1 px-1.5"
        style={{ background: `color-mix(in srgb, ${color} 75%, transparent)` }}
      >
        {width > 28 && <Icon size={9} className="shrink-0 text-white/90" />}
        {width > 56 && (
          <span className="truncate text-[10px] leading-none font-medium text-white/95">
            {missing ? 'Media missing · ' : ''}
            {clip.type === 'text' || clip.type === 'caption' ? clip.text : clip.name}
          </span>
        )}
      </div>
      {selected && !locked && <KeyframeMarkers clip={clip} zoom={zoom} />}
      {!locked && width > 14 && (
        <>
          <div
            className="absolute inset-y-0 left-0 z-[4] w-1.5 cursor-ew-resize bg-white/0 group-hover/clip:bg-white/70"
            onPointerDown={(e) => e.button === 0 && beginClipTrim(e, clip.id, 'start')}
          />
          <div
            className="absolute inset-y-0 right-0 z-[4] w-1.5 cursor-ew-resize bg-white/0 group-hover/clip:bg-white/70"
            onPointerDown={(e) => e.button === 0 && beginClipTrim(e, clip.id, 'end')}
          />
        </>
      )}
    </div>
  )
})
