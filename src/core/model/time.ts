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
