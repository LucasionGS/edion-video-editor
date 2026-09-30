import { useEffect, useRef, useState } from 'react'
import { analyzeFrame, VECTORSCOPE_SIZE, WAVEFORM_LEVELS } from '@core/index'
import type { ScopeData } from '@core/index'
import { getPlayer } from '@/engine/playback/session'

export type ScopeKind = 'waveform' | 'vectorscope' | 'histogram'

const KINDS: ReadonlyArray<{ value: ScopeKind; label: string }> = [
  { value: 'waveform', label: 'Waveform' },
  { value: 'vectorscope', label: 'Vectorscope' },
  { value: 'histogram', label: 'Histogram' }
]

/** Scopes sample a small copy of the preview; plenty for judging exposure and colour. */
const SAMPLE_WIDTH = 256
const MIN_INTERVAL_MS = 120

/**
 * Luma waveform, vectorscope or RGB histogram of what the viewer shows. It samples the preview canvas
 * right after each repaint (the WebGL canvas is only readable until the frame is presented), at most a
 * few times per second.
 */
export function Scopes() {
  const [kind, setKind] = useState<ScopeKind>('waveform')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const kindRef = useRef(kind)
  kindRef.current = kind

  useEffect(() => {
    const player = getPlayer()
    if (!player) return
    const sample = document.createElement('canvas')
    const context = sample.getContext('2d', { willReadFrequently: true })!
    let last = 0
    let timer = 0
    let latest: ScopeData | null = null
    const listener = (source: HTMLCanvasElement): void => {
      const now = performance.now()
      if (now - last < MIN_INTERVAL_MS) {
        // Make sure the frame the viewer settles on is measured too.
        clearTimeout(timer)
        timer = window.setTimeout(() => player.invalidate(), MIN_INTERVAL_MS)
        return
      }
      last = now
      const width = SAMPLE_WIDTH
      const height = Math.max(1, Math.round((source.height / Math.max(1, source.width)) * width))
      if (sample.width !== width || sample.height !== height) Object.assign(sample, { width, height })
      context.drawImage(source, 0, 0, width, height)
      latest = analyzeFrame(context.getImageData(0, 0, width, height).data, width, height)
      if (canvasRef.current) paint(canvasRef.current, latest, kindRef.current)
    }
    player.drawListeners.add(listener)
    player.invalidate()
    return () => {
      clearTimeout(timer)
      player.drawListeners.delete(listener)
    }
  }, [])

  // Switching scopes repaints from the next frame.
  useEffect(() => getPlayer()?.invalidate(), [kind])

  return (
    <div className="pointer-events-auto absolute right-2 bottom-2 z-10 w-[272px] rounded-lg border border-line bg-bg/90 p-1.5 shadow-lg backdrop-blur">
      <div className="mb-1 flex gap-0.5">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            className={`h-5 flex-1 rounded text-2xs ${kind === k.value ? 'bg-raised text-fg' : 'text-faint hover:text-fg'}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        width={256}
        height={kind === 'vectorscope' ? 256 : 128}
        className="w-full rounded bg-black"
        aria-label={`${kind} scope`}
      />
    </div>
  )
}

function paint(canvas: HTMLCanvasElement, data: ScopeData, kind: ScopeKind): void {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  if (kind === 'waveform') paintWaveform(ctx, data, width, height)
  else if (kind === 'vectorscope') paintVectorscope(ctx, data, width, height)
  else paintHistogram(ctx, data, width, height)
}

/** Counts → brightness on a log scale, so faint traces stay visible next to dense ones. */
function intensity(counts: Uint32Array): (count: number) => number {
  let max = 1
  for (const c of counts) if (c > max) max = c
  const norm = Math.log1p(max)
  return (count) => Math.log1p(count) / norm
}

function paintWaveform(ctx: CanvasRenderingContext2D, data: ScopeData, width: number, height: number): void {
  const image = ctx.createImageData(data.width, WAVEFORM_LEVELS)
  const level = intensity(data.waveform)
  for (let row = 0; row < WAVEFORM_LEVELS; row++) {
    for (let x = 0; x < data.width; x++) {
      const count = data.waveform[row * data.width + x]!
      if (!count) continue
      // Even a single sample stays visible.
      const v = Math.min(1, 0.35 + level(count) * 1.2)
      // Row 0 is black, drawn at the bottom.
      const i = ((WAVEFORM_LEVELS - 1 - row) * data.width + x) * 4
      image.data.set([90 * v + 40, 255 * v, 120 * v + 40, 255], i)
    }
  }
  drawScaled(ctx, image, width, height)
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = '9px sans-serif'
  for (const percent of [0, 25, 50, 75, 100]) {
    const y = Math.round(height - 1 - (percent / 100) * (height - 1)) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
    ctx.fillText(String(percent), 2, Math.max(9, y - 2))
  }
}

function paintVectorscope(
  ctx: CanvasRenderingContext2D,
  data: ScopeData,
  width: number,
  height: number
): void {
  const image = ctx.createImageData(VECTORSCOPE_SIZE, VECTORSCOPE_SIZE)
  const level = intensity(data.vectorscope)
  for (let v = 0; v < VECTORSCOPE_SIZE; v++) {
    for (let u = 0; u < VECTORSCOPE_SIZE; u++) {
      const count = data.vectorscope[v * VECTORSCOPE_SIZE + u]!
      if (!count) continue
      const a = Math.min(1, 0.3 + level(count) * 1.3)
      // Cr grows upwards on a vectorscope.
      const i = ((VECTORSCOPE_SIZE - 1 - v) * VECTORSCOPE_SIZE + u) * 4
      image.data.set([220 * a + 35, 230 * a + 25, 220 * a + 35, 255], i)
    }
  }
  drawScaled(ctx, image, width, height)
  const cx = width / 2
  const cy = height / 2
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.beginPath()
  ctx.arc(cx, cy, width * 0.45, 0, Math.PI * 2)
  ctx.moveTo(cx, 0)
  ctx.lineTo(cx, height)
  ctx.moveTo(0, cy)
  ctx.lineTo(width, cy)
  ctx.stroke()
  // Where fully saturated primaries and secondaries land (75% bars), as small targets.
  const targets: Array<[string, [number, number, number]]> = [
    ['R', [191, 0, 0]],
    ['G', [0, 191, 0]],
    ['B', [0, 0, 191]],
    ['Cy', [0, 191, 191]],
    ['Mg', [191, 0, 191]],
    ['Yl', [191, 191, 0]]
  ]
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.font = '9px sans-serif'
  for (const [label, [r, g, b]] of targets) {
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const x = cx + ((b - luma) / 255 / 1.8556) * width
    const y = cy - ((r - luma) / 255 / 1.5748) * height
    ctx.strokeRect(x - 4, y - 4, 8, 8)
    ctx.fillText(label, x + 6, y + 3)
  }
}

function paintHistogram(ctx: CanvasRenderingContext2D, data: ScopeData, width: number, height: number): void {
  const { r, g, b } = data.histogram
  let max = 1
  // Ignore the extremes when scaling, or a clipped frame flattens everything else.
  for (const channel of [r, g, b]) for (let i = 1; i < 255; i++) max = Math.max(max, channel[i]!)
  ctx.globalCompositeOperation = 'lighter'
  const channels: Array<[Uint32Array, string]> = [
    [r, 'rgba(255,70,70,0.8)'],
    [g, 'rgba(70,255,70,0.8)'],
    [b, 'rgba(80,120,255,0.8)']
  ]
  for (const [channel, color] of channels) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, height)
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * width
      ctx.lineTo(x, height - Math.min(1, channel[i]! / max) * (height - 2))
    }
    ctx.lineTo(width, height)
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}

function drawScaled(ctx: CanvasRenderingContext2D, image: ImageData, width: number, height: number): void {
  const scratch = new OffscreenCanvas(image.width, image.height)
  scratch.getContext('2d')!.putImageData(image, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(scratch, 0, 0, width, height)
}
