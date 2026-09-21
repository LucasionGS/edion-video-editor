export const framesToSeconds = (frames: number, fps: number): number => frames / fps
export const secondsToFrames = (seconds: number, fps: number): number => Math.round(seconds * fps)

/** `HH:MM:SS:FF` (hours omitted when zero). */
export function formatTimecode(frame: number, fps: number): string {
  const base = Math.round(fps)
  const f = Math.max(0, Math.round(frame))
  const totalSeconds = Math.floor(f / base)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const parts = [pad(Math.floor(totalSeconds / 60) % 60), pad(totalSeconds % 60), pad(f % base)]
  const hours = Math.floor(totalSeconds / 3600)
  if (hours > 0) parts.unshift(pad(hours))
  return parts.join(':')
}

/** Common broadcast rates expressed exactly, for FFmpeg's `-r`. */
export function fpsToRational(fps: number): string {
  for (const base of [24, 30, 60, 120]) {
    if (Math.abs(fps - (base * 1000) / 1001) < 0.005) return `${base * 1000}/1001`
  }
  return Number.isInteger(fps) ? `${fps}/1` : String(fps)
}

/**
 * How positions are shown. 'time' is wall-clock (`1:05.400`); 'timecode' is the editor's classic
 * minutes:seconds:frames (`01:05:24`, where the last field counts frames, not seconds); 'frames' is the raw frame number.
 */
export type TimeDisplay = 'time' | 'timecode' | 'frames'

export const TIME_DISPLAYS: ReadonlyArray<{ value: TimeDisplay; label: string }> = [
  { value: 'time', label: 'Time (min:sec.ms)' },
  { value: 'timecode', label: 'Timecode (min:sec:frame)' },
  { value: 'frames', label: 'Frame number' }
]

/** `M:SS` with `decimals` fractional digits (hours added when needed). */
export function formatClock(seconds: number, decimals = 0): string {
  const scale = 10 ** decimals
  const total = Math.max(0, Math.round(seconds * scale)) / scale
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const rest = (total % 60).toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

export function formatPosition(frame: number, fps: number, display: TimeDisplay): string {
  if (display === 'frames') return String(Math.max(0, Math.round(frame)))
  if (display === 'timecode') return formatTimecode(frame, fps)
  return formatClock(frame / fps, 3)
}

/** Ruler label: like `formatPosition`, but without digits that are zero on every tick. */
export function formatRulerLabel(frame: number, fps: number, display: TimeDisplay): string {
  if (display !== 'time') return formatPosition(frame, fps, display)
  const clock = formatClock(frame / fps, 3)
  return clock.includes('.') ? clock.replace(/\.?0+$/, '') : clock
}
