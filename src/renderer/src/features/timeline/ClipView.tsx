import { memo } from 'react'
import {
  AudioLines,
  Captions,
  Film,
  ImageIcon,
  Layers,
  Link2,
  Pause,
  Rewind,
  Shapes,
  SlidersHorizontal,
  Type
} from 'lucide-react'
import type { Clip } from '@core/index'
import { clipMenuItems, selectForMenu } from '@/store/clipMenu'
import { useEditor } from '@/store/editor'
import { openContextMenu } from '@/ui/ContextMenu'
import { beginClipMove, beginClipTrim, beginSlipOrSlide, razorAt } from './clipDrag'
import { useTimelineView } from './view'

const look: Record<Clip['type'], { color: string; Icon: typeof Film }> = {
  video: { color: 'var(--color-clip-video)', Icon: Film },
  audio: { color: 'var(--color-clip-audio)', Icon: AudioLines },
  image: { color: 'var(--color-clip-image)', Icon: ImageIcon },
  text: { color: 'var(--color-clip-text)', Icon: Type },
  shape: { color: 'var(--color-clip-text)', Icon: Shapes },
  caption: { color: '#2b8a9e', Icon: Captions },
  adjustment: { color: '#8a6d3b', Icon: SlidersHorizontal },
  compound: { color: '#5d6b8a', Icon: Layers }
}

interface Props {
  clip: Clip
  zoom: number
  height: number
  selected: boolean
  /** A clip linked to this one is selected, so edits will include this clip too. */
  partnerSelected: boolean
  locked: boolean
  missing: boolean
}

export const ClipView = memo(function ClipView({
  clip,
  zoom,
  height,
  selected,
  partnerSelected,
  locked,
  missing
}: Props) {
  const { color: kindColor, Icon } = look[clip.type]
  const color = clip.color ?? kindColor
  const tool = useEditor((s) => s.tool)
  const bodyCursor =
    tool === 'razor' ? 'cursor-crosshair' : tool === 'slip' || tool === 'slide' ? 'cursor-ew-resize' : ''
  const edgeCursor = tool === 'roll' ? 'cursor-col-resize' : 'cursor-ew-resize'
  const width = Math.max(2, clip.duration * zoom)
  const frameAt = (e: React.PointerEvent | React.MouseEvent): number => {
    const left = e.currentTarget.getBoundingClientRect().left
    return clip.start + Math.round((e.clientX - left) / zoom)
  }

  return (
    <div
      data-clip-id={clip.id}
      className={`group/clip absolute top-0.5 overflow-hidden rounded-[5px] ${bodyCursor} ${locked ? 'opacity-60' : ''} ${clip.disabled ? 'opacity-35 grayscale' : ''} ${
        selected
          ? 'z-[3] ring-2 ring-white'
          : partnerSelected
            ? 'z-[3] ring-1 ring-white/80'
            : 'z-[2] ring-1 ring-black/40 hover:ring-white/50'
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
        const { tool } = useEditor.getState()
        if (tool === 'razor') return razorAt(clip.id, frameAt(e))
        if (tool === 'slip' || tool === 'slide') return beginSlipOrSlide(e, clip.id, tool)
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
        {width > 42 && clip.linkId && (
          <Link2 size={9} className="shrink-0 text-white/70" aria-label="Linked" />
        )}
        {width > 42 && 'reversed' in clip && clip.reversed && (
          <Rewind size={9} className="shrink-0 text-white/70" aria-label="Reversed" />
        )}
        {width > 42 && clip.type === 'video' && clip.hold && (
          <Pause size={9} className="shrink-0 text-white/70" aria-label="Frame hold" />
        )}
        {width > 56 && (
          <span className="truncate text-[10px] leading-none font-medium text-white/95">
            {missing ? 'Media missing · ' : ''}
            {clip.type === 'text' || clip.type === 'caption' ? clip.text : clip.name}
          </span>
        )}
      </div>
      {!locked && width > 14 && (
        <>
          <div
            className={`absolute inset-y-0 left-0 z-[4] w-1.5 ${edgeCursor} bg-white/0 ${tool === 'ripple' ? 'group-hover/clip:bg-amber-300/80' : 'group-hover/clip:bg-white/70'}`}
            onPointerDown={(e) => e.button === 0 && beginClipTrim(e, clip.id, 'start')}
          />
          <div
            className={`absolute inset-y-0 right-0 z-[4] w-1.5 ${edgeCursor} bg-white/0 ${tool === 'ripple' ? 'group-hover/clip:bg-amber-300/80' : 'group-hover/clip:bg-white/70'}`}
            onPointerDown={(e) => e.button === 0 && beginClipTrim(e, clip.id, 'end')}
          />
        </>
      )}
    </div>
  )
})
