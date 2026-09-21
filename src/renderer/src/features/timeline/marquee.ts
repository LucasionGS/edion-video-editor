import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Id } from '@core/index'
import { seek } from '@/engine/playback/session'
import { select, useEditor } from '@/store/editor'
import { startDrag } from './drag'
import { HEADER_WIDTH, useTimelineView } from './view'

const EDGE = 28
const MAX_SCROLL_SPEED = 22

/**
 * Pointer-down on empty timeline space: a plain click deselects and moves the playhead, a drag
 * rubber-bands clips. Shift/Ctrl adds to (or toggles within) the existing selection.
 * Everything is measured in content coordinates, so it stays correct while the view auto-scrolls.
 */
export function beginMarquee(
  event: ReactPointerEvent,
  scroller: HTMLElement,
  content: HTMLElement,
  clickFrame: number
): void {
  const additive = event.shiftKey || event.ctrlKey || event.metaKey
  const base = additive ? useEditor.getState().selection : []
  const toContent = (clientX: number, clientY: number): [number, number] => {
    const rect = content.getBoundingClientRect()
    return [clientX - rect.left, clientY - rect.top]
  }
  const [x0, y0] = toContent(event.clientX, event.clientY)
  let pointer = { x: event.clientX, y: event.clientY }
  let raf = 0

  const update = (): void => {
    const [x1, y1] = toContent(pointer.x, pointer.y)
    const left = Math.max(HEADER_WIDTH, Math.min(x0, x1))
    const right = Math.max(HEADER_WIDTH, x0, x1)
    const top = Math.min(y0, y1)
    const bottom = Math.max(y0, y1)
    useTimelineView.setState({ marquee: { left, top, width: right - left, height: bottom - top } })

    const { project, zoom } = useEditor.getState()
    const fromFrame = (left - HEADER_WIDTH) / zoom
    const toFrame = (right - HEADER_WIDTH) / zoom
    const contentTop = content.getBoundingClientRect().top
    const hit = new Set<Id>()
    for (const lane of content.querySelectorAll<HTMLElement>('[data-track-lane]')) {
      const rect = lane.getBoundingClientRect()
      if (rect.bottom - contentTop <= top || rect.top - contentTop >= bottom) continue
      const track = project.tracks.find((t) => t.id === lane.dataset['trackLane'])
      if (!track || track.locked) continue
      for (const clip of track.clips) {
        if (clip.start < toFrame && clip.start + clip.duration > fromFrame) hit.add(clip.id)
      }
    }
    // Additive drags toggle, matching what Shift-click does to a single clip.
    const next = new Set(base)
    for (const id of hit) {
      if (next.has(id)) next.delete(id)
      else next.add(id)
    }
    select([...next])
  }

  /** Scrolls while the pointer rests near (or beyond) an edge, faster the further out it is. */
  const autoScroll = (): void => {
    raf = requestAnimationFrame(autoScroll)
    const rect = scroller.getBoundingClientRect()
    const speed = (distance: number): number =>
      Math.min(MAX_SCROLL_SPEED, Math.ceil((distance / EDGE) * MAX_SCROLL_SPEED))
    let dx = 0
    let dy = 0
    if (pointer.x > rect.right - EDGE) dx = speed(pointer.x - (rect.right - EDGE))
    else if (pointer.x < rect.left + HEADER_WIDTH + EDGE)
      dx = -speed(rect.left + HEADER_WIDTH + EDGE - pointer.x)
    if (pointer.y > rect.bottom - EDGE) dy = speed(pointer.y - (rect.bottom - EDGE))
    else if (pointer.y < rect.top + EDGE) dy = -speed(rect.top + EDGE - pointer.y)
    if (dx === 0 && dy === 0) return
    const before = [scroller.scrollLeft, scroller.scrollTop]
    scroller.scrollBy(dx, dy)
    if (scroller.scrollLeft !== before[0] || scroller.scrollTop !== before[1]) update()
  }

  startDrag(event, {
    onStart: () => (raf = requestAnimationFrame(autoScroll)),
    onMove: (_dx, _dy, e) => {
      pointer = { x: e.clientX, y: e.clientY }
      update()
    },
    onEnd: (moved, cancelled) => {
      cancelAnimationFrame(raf)
      useTimelineView.setState({ marquee: null })
      if (cancelled) return select(additive ? base : [])
      if (moved) return
      if (!additive) select([])
      seek(clickFrame)
    }
  })
}
