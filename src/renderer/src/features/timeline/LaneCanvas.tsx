import { useEffect, useRef } from 'react'
import { clipEnd, findMedia, sourceTimeAt } from '@core/index'
import type { Clip, Project, Track } from '@core/index'
import { useEditor } from '@/store/editor'
import { getFilmstrip, getPeaks, getStill, HEADER_WIDTH, useTimelineView } from './view'

const WAVE_COLOR = 'rgba(255,255,255,0.55)'

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  project: Project,
  clip: Clip & { mediaId: string; sourceIn: number; speed: number; reversed?: boolean },
  x0: number,
  x1: number,
  clipX: number,
  top: number,
  height: number,
  zoom: number
): void {
  const media = findMedia(project, clip.mediaId)
  const peaks = media && getPeaks(media.path)
  if (!peaks) return
  const secondsPerPixel = clip.speed / (zoom * project.settings.fps)
  const mid = top + height / 2
  ctx.fillStyle = WAVE_COLOR
  const width = (clip.duration * zoom) | 0
  for (let x = Math.floor(x0); x < x1; x++) {
    // Reversed clips draw their waveform mirrored, like they sound.
    const offset = clip.reversed ? width - (x - clipX) - 1 : x - clipX
    const from = clip.sourceIn + offset * secondsPerPixel
    const a = Math.max(0, Math.floor(from * peaks.perSecond))
    const b = Math.min(
      peaks.data.length,
      Math.max(a + 1, Math.ceil((from + secondsPerPixel) * peaks.perSecond))
    )
    let max = 0
    for (let i = a; i < b; i++) max = Math.max(max, peaks.data[i]!)
    const h = Math.max(1, (max / 255) * height)
    ctx.fillRect(x, mid - h / 2, 1, h)
  }
}

function drawFilmstrip(
  ctx: CanvasRenderingContext2D,
  project: Project,
  clip: Clip & { mediaId: string },
  x0: number,
  x1: number,
  clipX: number,
  top: number,
  height: number,
  zoom: number
): void {
  const media = findMedia(project, clip.mediaId)
  const strip = media && media.kind === 'video' ? getFilmstrip(media.path) : null
  if (!strip) return
  const tileWidth = (height * strip.tileWidth) / strip.tileHeight
  const first = Math.max(0, Math.floor((x0 - clipX) / tileWidth))
  for (let i = first; clipX + i * tileWidth < x1; i++) {
    const x = clipX + i * tileWidth
    const local = Math.min(clip.duration - 1, Math.floor((i * tileWidth) / zoom))
    const time = 'sourceIn' in clip ? sourceTimeAt(clip, local, project.settings.fps) : 0
    const index = Math.max(0, Math.min(strip.count - 1, Math.round(time / strip.interval)))
    ctx.drawImage(
      strip.image,
      index * strip.tileWidth,
      0,
      strip.tileWidth,
      strip.tileHeight,
      x,
      top,
      tileWidth,
      height
    )
  }
}

/** Repeats the still along the clip, like a filmstrip of one picture. */
function drawStill(
  ctx: CanvasRenderingContext2D,
  project: Project,
  clip: Clip & { mediaId: string },
  x0: number,
  x1: number,
  clipX: number,
  top: number,
  height: number
): void {
  const media = findMedia(project, clip.mediaId)
  const image = media && getStill(media.path)
  if (!image || !image.naturalHeight) return
  const tileWidth = Math.max(8, (height * image.naturalWidth) / image.naturalHeight)
  const first = Math.max(0, Math.floor((x0 - clipX) / tileWidth))
  for (let i = first; clipX + i * tileWidth < x1; i++)
    ctx.drawImage(image, clipX + i * tileWidth, top, tileWidth, height)
}

/** One viewport-wide canvas per lane paints the filmstrips and waveforms of whatever clips are in view. */
export function LaneCanvas({ track }: { track: Track }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zoom = useEditor((s) => s.zoom)
  const project = useEditor((s) => s.project)
  const scrollLeft = useTimelineView((s) => s.scrollLeft)
  const width = useTimelineView((s) => s.viewportWidth)
  const visuals = useTimelineView((s) => s.visualsVersion)
  const height = track.height

  useEffect(() => {
    const canvas = canvasRef.current!
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.round(height * ratio)
    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.clearRect(0, 0, width, height)
    const inset = 2
    for (const clip of track.clips) {
      const clipX = clip.start * zoom - scrollLeft
      const right = clipEnd(clip) * zoom - scrollLeft
      if (right < 0 || clipX > width) continue
      const x0 = Math.max(0, clipX)
      const x1 = Math.min(width, right)
      ctx.save()
      ctx.beginPath()
      ctx.rect(x0, inset, x1 - x0, height - inset * 2)
      ctx.clip()
      if (clip.type === 'video') {
        const filmHeight = clip.audioMuted ? height - inset * 2 - 14 : (height - inset * 2 - 14) * 0.62
        drawFilmstrip(ctx, project, clip, x0, x1, clipX, inset + 14, filmHeight, zoom)
        if (!clip.audioMuted)
          drawWaveform(
            ctx,
            project,
            clip,
            x0,
            x1,
            clipX,
            inset + 14 + filmHeight,
            height - inset * 2 - 14 - filmHeight,
            zoom
          )
      } else if (clip.type === 'image') {
        drawStill(ctx, project, clip, x0, x1, clipX, inset + 14, height - inset * 2 - 14)
      } else if (clip.type === 'audio') {
        drawWaveform(ctx, project, clip, x0, x1, clipX, inset + 14, height - inset * 2 - 16, zoom)
      }
      ctx.restore()
    }
  }, [track.clips, project, zoom, scrollLeft, width, height, visuals])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none sticky z-[5] block"
      style={{ left: HEADER_WIDTH, width, height, marginBottom: -height }}
    />
  )
}
