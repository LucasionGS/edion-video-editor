import type { ShapeClip, TextStyle } from '@core/index'

/** A 2D-canvas rendering of text or a shape, plus its size in project pixels. */
export interface Raster {
  canvas: OffscreenCanvas
  width: number
  height: number
}

const fontOf = (style: TextStyle, scale: number): string =>
  `${style.italic ? 'italic ' : ''}${style.fontWeight} ${style.fontSize * scale}px "${style.fontFamily}", "Inter Variable", system-ui, sans-serif`

function wrapLines(ctx: OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (maxWidth <= 0) {
      lines.push(paragraph)
      continue
    }
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (line && ctx.measureText(line + word).width > maxWidth) {
        lines.push(line.trimEnd())
        line = word.trimStart()
      } else line += word
    }
    lines.push(line.trimEnd())
  }
  return lines
}

/**
 * `scale` is raster pixels per project pixel, so text stays crisp when zoomed or rendered at low preview
 * quality. `reveal` limits how many letters (spaces not counted) are drawn, for text that types on; the
 * layout is always that of the whole text, so nothing moves as letters appear.
 */
export function rasterizeText(
  text: string,
  style: TextStyle,
  boxWidth: number,
  scale: number,
  reveal = Infinity
): Raster {
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!
  measure.font = fontOf(style, 1)
  measure.letterSpacing = `${style.letterSpacing}px`
  const lines = wrapLines(measure, text || ' ', boxWidth)
  const lineHeight = style.fontSize * style.lineHeight
  const textWidth = Math.max(1, ...lines.map((l) => measure.measureText(l).width))
  const hasBackground = !style.backgroundColor.endsWith('00') || style.backgroundColor.length < 9
  const pad =
    Math.ceil(
      style.strokeWidth +
        style.shadowBlur +
        Math.max(Math.abs(style.shadowOffset[0]), Math.abs(style.shadowOffset[1]))
    ) +
    (hasBackground ? style.backgroundPadding : 0) +
    Math.ceil(style.fontSize * 0.15)
  const width = Math.ceil((boxWidth > 0 ? boxWidth : textWidth) + pad * 2)
  const height = Math.ceil(lines.length * lineHeight + pad * 2)

  const canvas = new OffscreenCanvas(
    Math.max(1, Math.ceil(width * scale)),
    Math.max(1, Math.ceil(height * scale))
  )
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  if (hasBackground) {
    const inset = pad - style.backgroundPadding
    ctx.fillStyle = style.backgroundColor
    ctx.beginPath()
    ctx.roundRect(inset, inset, width - inset * 2, height - inset * 2, style.backgroundRadius)
    ctx.fill()
  }
  ctx.font = fontOf(style, 1)
  ctx.letterSpacing = `${style.letterSpacing}px`
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  // Partially revealed lines are drawn from their left edge, where the whole line would start.
  ctx.textAlign = reveal === Infinity ? style.align : 'left'
  let budget = reveal
  lines.forEach((full, i) => {
    let line = full
    if (budget !== Infinity) {
      let end = 0
      for (const char of full) {
        if (budget <= 0) break
        if (!/\s/.test(char)) budget--
        end += char.length
      }
      line = full.slice(0, end)
      if (!line) return
    }
    const lineWidth = measure.measureText(full).width
    const x =
      reveal === Infinity
        ? style.align === 'left'
          ? pad
          : style.align === 'right'
            ? width - pad
            : width / 2
        : style.align === 'left'
          ? pad
          : style.align === 'right'
            ? width - pad - lineWidth
            : (width - lineWidth) / 2
    const y = pad + lineHeight * (i + 0.5)
    if (style.shadowBlur > 0 || style.shadowOffset[0] !== 0 || style.shadowOffset[1] !== 0) {
      ctx.shadowColor = style.shadowColor
      ctx.shadowBlur = style.shadowBlur * scale
      ctx.shadowOffsetX = style.shadowOffset[0] * scale
      ctx.shadowOffsetY = style.shadowOffset[1] * scale
    }
    if (style.strokeWidth > 0) {
      ctx.strokeStyle = style.strokeColor
      ctx.lineWidth = style.strokeWidth * 2
      ctx.strokeText(line, x, y)
      ctx.shadowColor = 'transparent'
    }
    ctx.fillStyle = style.color
    ctx.fillText(line, x, y)
    ctx.shadowColor = 'transparent'
  })
  return { canvas, width, height }
}

export function rasterizeShape(clip: ShapeClip, scale: number): Raster {
  const stroke = clip.strokeWidth
  const width = Math.max(1, clip.size[0] + stroke)
  const height = Math.max(1, clip.size[1] + stroke)
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.ceil(width * scale)),
    Math.max(1, Math.ceil(height * scale))
  )
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.beginPath()
  if (clip.shape === 'ellipse') {
    ctx.ellipse(width / 2, height / 2, clip.size[0] / 2, clip.size[1] / 2, 0, 0, Math.PI * 2)
  } else {
    ctx.roundRect(stroke / 2, stroke / 2, clip.size[0], clip.size[1], clip.cornerRadius)
  }
  ctx.fillStyle = clip.fill
  ctx.fill()
  if (stroke > 0) {
    ctx.strokeStyle = clip.strokeColor
    ctx.lineWidth = stroke
    ctx.stroke()
  }
  return { canvas, width, height }
}
