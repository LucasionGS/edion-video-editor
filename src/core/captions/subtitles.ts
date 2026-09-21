import { createCaptionClip } from '../model/factory'
import type { CaptionClip } from '../model/types'

export interface Cue {
  /** Seconds. */
  start: number
  end: number
  text: string
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/

function parseTime(value: string): number | null {
  const m = TIME.exec(value)
  if (!m) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]!.padEnd(3, '0')) / 1000
}

/** Parses SRT or WebVTT. Unknown blocks (headers, notes, styles) are skipped, markup is stripped. */
export function parseSubtitles(source: string): Cue[] {
  const cues: Cue[] = []
  for (const block of source
    .replace(/^﻿/, '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const timing = lines.findIndex((l) => l.includes('-->'))
    if (timing < 0) continue
    const [from, to] = lines[timing]!.split('-->')
    const start = parseTime(from ?? '')
    const end = parseTime(to ?? '')
    const text = lines
      .slice(timing + 1)
      .join('\n')
      .replace(/<[^>]+>|\{\\[^}]+\}/g, '')
      .trim()
    if (start === null || end === null || end <= start || !text) continue
    cues.push({ start, end, text })
  }
  return cues.sort((a, b) => a.start - b.start)
}

function formatTime(seconds: number, separator: ',' | '.'): string {
  const ms = Math.round(seconds * 1000)
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${separator}${pad(ms % 1000, 3)}`
}

export function serializeSrt(cues: readonly Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${formatTime(c.start, ',')} --> ${formatTime(c.end, ',')}\n${c.text}\n`)
    .join('\n')
}

export function serializeVtt(cues: readonly Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${formatTime(c.start, '.')} --> ${formatTime(c.end, '.')}\n${c.text}\n`).join('\n')}`
}

/** Cues → caption clips that never overlap (a cue is cut short if the next one starts early). */
export function cuesToClips(cues: readonly Cue[], fps: number, offsetFrames = 0): CaptionClip[] {
  const clips: CaptionClip[] = []
  cues.forEach((cue, i) => {
    const start = Math.round(cue.start * fps) + offsetFrames
    const next = cues[i + 1]
    const end =
      Math.min(Math.round(cue.end * fps), next ? Math.round(next.start * fps) : Infinity) + offsetFrames
    const previous = clips[clips.length - 1]
    const from = previous ? Math.max(start, previous.start + previous.duration) : Math.max(0, start)
    if (end - from >= 1) clips.push(createCaptionClip(from, end - from, cue.text))
  })
  return clips
}

export const clipsToCues = (clips: readonly CaptionClip[], fps: number): Cue[] =>
  [...clips]
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ start: c.start / fps, end: (c.start + c.duration) / fps, text: c.text }))
