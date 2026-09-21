import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  Captions,
  Film,
  MousePointer2,
  Music,
  Redo2,
  Scissors,
  SquareSplitHorizontal,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { addTrack, projectDuration } from '@core/index'
import { edit, MAX_ZOOM, MIN_ZOOM, redo, setZoom, undo, useEditor } from '@/store/editor'
import { addAssetToTimeline, importMedia } from '@/store/projectActions'
import { deleteSelection, splitAtPlayhead } from '@/store/commands'
import { IconButton } from '@/ui/IconButton'
import { MEDIA_DRAG_TYPE } from '@/features/library/MediaLibrary'
import { seek } from '@/engine/playback/session'
import { emptyAreaMenuItems } from '@/store/clipMenu'
import { openContextMenu } from '@/ui/ContextMenu'
import { Lane } from './Lane'
import { beginMarquee } from './marquee'
import { LaneCanvas } from './LaneCanvas'
import { Ruler } from './Ruler'
import { SnapMenu } from './SnapMenu'
import { TrackHeader } from './TrackHeader'
import { HEADER_WIDTH, RULER_HEIGHT, useTimelineView } from './view'

export function Timeline() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const tracks = useEditor((s) => s.project.tracks)
  const zoom = useEditor((s) => s.zoom)
  const duration = useEditor((s) => projectDuration(s.project))
  const viewportWidth = useTimelineView((s) => s.viewportWidth)
  const trackDrag = useTimelineView((s) => s.trackDrag)
  // Always leave room to drop clips after the end.
  const contentWidth = Math.max(viewportWidth, duration * zoom + viewportWidth * 0.6)

  useLayoutEffect(() => {
    const element = scrollRef.current!
    const measure = (): void =>
      useTimelineView.setState({ viewportWidth: Math.max(100, element.clientWidth - HEADER_WIDTH) })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Wheel: scroll through time. Shift+wheel (or the wheel over the track headers): scroll the tracks.
  // Ctrl+wheel: zoom around the pointer. Needs a non-passive listener to override the browser defaults.
  useEffect(() => {
    const element = scrollRef.current!
    const onWheel = (e: WheelEvent): void => {
      const x = e.clientX - element.getBoundingClientRect().left - HEADER_WIDTH
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        return zoomAround(element, useEditor.getState().zoom * Math.exp(-e.deltaY * 0.0025), x)
      }
      // Line-based wheels report tiny deltas; bring them to pixels.
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 40
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? element.clientHeight
            : 1
      if (e.shiftKey) {
        // Chromium already turns Shift+wheel into a horizontal delta; send it to the vertical axis instead.
        e.preventDefault()
        element.scrollTop += (e.deltaY || e.deltaX) * unit
        return
      }
      // A sideways gesture (trackpad, tilt wheel) and the wheel over the track headers keep their native meaning.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || x < 0) return
      e.preventDefault()
      element.scrollLeft += e.deltaY * unit
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  // Follow the playhead during playback.
  useEffect(
    () =>
      useEditor.subscribe((state, previous) => {
        const element = scrollRef.current
        if (!element || !state.playing || state.playhead === previous.playhead) return
        const x = state.playhead * state.zoom - element.scrollLeft
        const width = element.clientWidth - HEADER_WIDTH
        if (x > width - 40 || x < 0) element.scrollLeft = Math.max(0, state.playhead * state.zoom - 80)
      }),
    []
  )

  const frameFromEvent = (clientX: number): number => {
    const element = scrollRef.current!
    return Math.max(
      0,
      Math.round((clientX - element.getBoundingClientRect().left - HEADER_WIDTH + element.scrollLeft) / zoom)
    )
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    const frame = frameFromEvent(e.clientX)
    const lane = (e.target as HTMLElement).closest<HTMLElement>('[data-track-lane]')?.dataset['trackLane']
    const assetId = e.dataTransfer.getData(MEDIA_DRAG_TYPE)
    const assets = assetId
      ? useEditor.getState().project.media.filter((m) => m.id === assetId)
      : await importMedia([...e.dataTransfer.files].map((f) => window.edion.media.pathForFile(f)))
    let at = frame
    for (const asset of assets) {
      addAssetToTimeline(asset, at, lane)
      at += Math.max(1, Math.round((asset.duration || 5) * useEditor.getState().project.settings.fps))
    }
  }

  return (
    <section className="isolate flex h-full min-h-0 flex-col bg-surface">
      <Toolbar scrollRef={scrollRef} />
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto bg-bg"
        onScroll={(e) => useTimelineView.setState({ scrollLeft: e.currentTarget.scrollLeft })}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) || e.dataTransfer.types.includes('Files'))
            e.preventDefault()
        }}
        onDrop={(e) => void onDrop(e)}
      >
        <div
          ref={contentRef}
          style={{ width: HEADER_WIDTH + contentWidth }}
          className="relative min-h-full"
          onContextMenu={(e) => {
            // Clips and transitions open their own menus; this one is for empty lane space.
            if ((e.target as HTMLElement).closest('[data-ruler], button, input')) return e.preventDefault()
            if (e.clientX - scrollRef.current!.getBoundingClientRect().left < HEADER_WIDTH)
              return e.preventDefault()
            seek(frameFromEvent(e.clientX))
            openContextMenu(e, emptyAreaMenuItems())
          }}
          onPointerDown={(e) => {
            // Empty space only: clips, the ruler and the track headers handle their own presses.
            const target = e.target as HTMLElement
            if (e.button !== 0 || target.closest('[data-clip-id], [data-ruler], button, input')) return
            if (e.clientX - scrollRef.current!.getBoundingClientRect().left < HEADER_WIDTH) return
            if (useEditor.getState().tool === 'razor') return
            beginMarquee(e, scrollRef.current!, contentRef.current!, frameFromEvent(e.clientX))
          }}
        >
          <div
            data-ruler
            className="sticky top-0 z-30 flex border-b border-line bg-surface"
            style={{ height: RULER_HEIGHT }}
          >
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-line bg-surface"
              style={{ width: HEADER_WIDTH }}
            />
            <div className="sticky" style={{ left: HEADER_WIDTH }}>
              <Ruler />
            </div>
          </div>
          <div>
            {tracks.map((track) => (
              <div
                key={track.id}
                data-track-row
                className={`flex ${trackDrag?.trackId === track.id ? 'opacity-50' : ''}`}
              >
                <TrackHeader track={track} />
                <div className="relative">
                  <LaneCanvas track={track} />
                  <Lane track={track} width={contentWidth} />
                </div>
              </div>
            ))}
          </div>
          <TrackDropLine />
          <Guides />
        </div>
      </div>
    </section>
  )
}

function zoomAround(element: HTMLDivElement, nextZoom: number, anchorX: number): void {
  const { zoom } = useEditor.getState()
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom))
  const frame = (element.scrollLeft + anchorX) / zoom
  setZoom(clamped)
  // Content width updates on the next render; scroll after it.
  requestAnimationFrame(() => (element.scrollLeft = Math.max(0, frame * clamped - anchorX)))
}

/** Playhead, snap guide and razor line, drawn over all lanes. */
function Guides() {
  const playhead = useEditor((s) => s.playhead)
  const zoom = useEditor((s) => s.zoom)
  const snapGuide = useTimelineView((s) => s.snapGuide)
  const razorFrame = useTimelineView((s) => s.razorFrame)
  const marquee = useTimelineView((s) => s.marquee)
  const line = (frame: number): React.CSSProperties => ({ left: HEADER_WIDTH + frame * zoom })
  return (
    <>
      {marquee && (
        <div
          className="pointer-events-none absolute z-[26] rounded-[3px] border border-accent bg-accent-soft"
          style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
        />
      )}
      {snapGuide !== null && (
        <div
          className="pointer-events-none absolute inset-y-0 z-[25] w-px bg-accent"
          style={line(snapGuide)}
        />
      )}
      {razorFrame !== null && (
        <div
          className="pointer-events-none absolute inset-y-0 z-[25] w-px bg-danger"
          style={line(razorFrame)}
        />
      )}
      <div className="pointer-events-none absolute inset-y-0 z-[35] w-px bg-white" style={line(playhead)}>
        <div className="absolute -top-px -left-[5px] h-3 w-[11px] rounded-b-[3px] bg-white" />
      </div>
    </>
  )
}

function Toolbar({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const tool = useEditor((s) => s.tool)
  const ripple = useEditor((s) => s.ripple)
  const zoom = useEditor((s) => s.zoom)
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const hasSelection = useEditor((s) => s.selection.length > 0)
  const zoomBy = (factor: number): void => {
    const element = scrollRef.current
    if (element) zoomAround(element, zoom * factor, useEditor.getState().playhead * zoom - element.scrollLeft)
  }
  const fit = (): void => {
    const { project } = useEditor.getState()
    const width = useTimelineView.getState().viewportWidth
    setZoom((width * 0.92) / Math.max(1, projectDuration(project)))
    if (scrollRef.current) scrollRef.current.scrollLeft = 0
  }
  const divider = <span className="mx-1.5 h-4 w-px bg-line" />

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-2">
      <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        <Undo2 size={15} />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
        <Redo2 size={15} />
      </IconButton>
      {divider}
      <IconButton
        label="Select tool (V)"
        active={tool === 'select'}
        onClick={() => useEditor.setState({ tool: 'select' })}
      >
        <MousePointer2 size={15} />
      </IconButton>
      <IconButton
        label="Razor tool (C)"
        active={tool === 'razor'}
        onClick={() => useEditor.setState({ tool: 'razor' })}
      >
        <Scissors size={15} />
      </IconButton>
      {divider}
      <IconButton label="Split at playhead (S)" onClick={splitAtPlayhead}>
        <SquareSplitHorizontal size={15} />
      </IconButton>
      <IconButton
        label={ripple ? 'Ripple delete (Del)' : 'Delete (Del)'}
        disabled={!hasSelection}
        onClick={() => deleteSelection()}
      >
        <Trash2 size={15} />
      </IconButton>
      {divider}
      <SnapMenu />
      <button
        type="button"
        title="Ripple: deleting a clip closes the gap"
        aria-pressed={ripple}
        onClick={() => useEditor.setState({ ripple: !ripple })}
        className={`h-7 rounded-md px-2 text-2xs font-medium transition-colors ${ripple ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'}`}
      >
        Ripple
      </button>
      {divider}
      <IconButton label="Add video track" onClick={() => edit('Add track', (d) => void addTrack(d, 'video'))}>
        <Film size={15} />
      </IconButton>
      <IconButton label="Add audio track" onClick={() => edit('Add track', (d) => void addTrack(d, 'audio'))}>
        <Music size={15} />
      </IconButton>
      <IconButton
        label="Add caption track"
        onClick={() => edit('Add track', (d) => void addTrack(d, 'caption'))}
      >
        <Captions size={15} />
      </IconButton>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={fit}
          className="h-7 rounded-md px-2 text-2xs font-medium text-muted hover:bg-hover hover:text-fg"
          title="Fit timeline (Shift+Z)"
        >
          Fit
        </button>
        <IconButton label="Zoom out (-)" onClick={() => zoomBy(1 / 1.4)}>
          <ZoomOut size={15} />
        </IconButton>
        <input
          type="range"
          aria-label="Timeline zoom"
          min={Math.log(MIN_ZOOM)}
          max={Math.log(MAX_ZOOM)}
          step={0.01}
          value={Math.log(zoom)}
          onChange={(e) => zoomBy(Math.exp(Number(e.target.value)) / zoom)}
          className="w-28 accent-(--color-accent)"
        />
        <IconButton label="Zoom in (+)" onClick={() => zoomBy(1.4)}>
          <ZoomIn size={15} />
        </IconButton>
      </div>
    </div>
  )
}

/** The line showing where a dragged track will land. */
function TrackDropLine() {
  const drag = useTimelineView((s) => s.trackDrag)
  const tracks = useEditor((s) => s.project.tracks)
  if (!drag) return null
  // Same clamping as the core op: the line never leaves the group of the dragged track's kind.
  const kind = tracks.find((t) => t.id === drag.trackId)?.kind
  const others = tracks.filter((t) => t.id !== drag.trackId)
  const group = others.map((t, i) => (t.kind === kind ? i : -1)).filter((i) => i >= 0)
  const from = tracks.findIndex((t) => t.id === drag.trackId)
  const target = drag.toIndex > from ? drag.toIndex - 1 : drag.toIndex
  const clamped = group.length ? Math.max(group[0]!, Math.min(target, group[group.length - 1]! + 1)) : from
  // Back to a gap in the full list (which includes the dragged row) for positioning.
  const gap = clamped >= from ? clamped + 1 : clamped
  let top = RULER_HEIGHT
  for (const track of tracks.slice(0, gap)) top += track.height
  return (
    <div
      className="pointer-events-none absolute right-0 left-0 z-40 h-0.5 -translate-y-px bg-accent"
      style={{ top }}
    />
  )
}
