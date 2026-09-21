import { create } from 'zustand'
import type { Filmstrip, Peaks } from '@shared/ipc'

export const HEADER_WIDTH = 176
export const RULER_HEIGHT = 26
export const SNAP_PIXELS = 8

interface TimelineView {
  scrollLeft: number
  /** Width of the lane viewport (scroll container minus the track headers). */
  viewportWidth: number
  snapGuide: number | null
  /** Frame under the razor tool, for its guide line. */
  razorFrame: number | null
  /** Rubber-band selection rectangle, in timeline content coordinates. */
  marquee: { left: number; top: number; width: number; height: number } | null
  /** Bumped when a filmstrip or waveform finished loading, to repaint lanes. */
  visualsVersion: number
}

export const useTimelineView = create<TimelineView>(() => ({
  scrollLeft: 0,
  viewportWidth: 800,
  snapGuide: null,
  razorFrame: null,
  marquee: null,
  visualsVersion: 0
}))

// ── Filmstrips and waveforms, loaded lazily per media file ─────────────────────────────────────────

export interface LoadedFilmstrip extends Filmstrip {
  image: HTMLImageElement
}

const filmstrips = new Map<string, LoadedFilmstrip | 'loading' | 'none'>()
const peaks = new Map<string, Peaks | 'loading' | 'none'>()
const bump = (): void => useTimelineView.setState((s) => ({ visualsVersion: s.visualsVersion + 1 }))

export function getFilmstrip(path: string): LoadedFilmstrip | null {
  const cached = filmstrips.get(path)
  if (!cached) {
    filmstrips.set(path, 'loading')
    void window.edion.library
      .filmstrip(path)
      .then(async (strip) => {
        if (!strip) return void filmstrips.set(path, 'none')
        const image = new Image()
        image.src = strip.url
        await image.decode()
        filmstrips.set(path, { ...strip, image })
        bump()
      })
      .catch(() => filmstrips.set(path, 'none'))
  }
  return typeof cached === 'object' ? cached : null
}

export function getPeaks(path: string): Peaks | null {
  const cached = peaks.get(path)
  if (!cached) {
    peaks.set(path, 'loading')
    void window.edion.library
      .peaks(path)
      .then((result) => {
        peaks.set(path, result ?? 'none')
        if (result) bump()
      })
      .catch(() => peaks.set(path, 'none'))
  }
  return typeof cached === 'object' ? cached : null
}

/** Picks ruler tick spacing (in frames) so labels stay ~90px apart at any zoom. */
export function rulerStep(zoom: number, fps: number): { major: number; minor: number } {
  const base = Math.round(fps)
  const steps = [
    1,
    2,
    5,
    10,
    base / 2,
    base,
    base * 2,
    base * 5,
    base * 10,
    base * 30,
    base * 60,
    base * 120,
    base * 300,
    base * 600,
    base * 1800,
    base * 3600
  ]
    .map(Math.round)
    .filter((s, i, all) => s >= 1 && all.indexOf(s) === i)
  const major = steps.find((s) => s * zoom >= 90) ?? steps[steps.length - 1]!
  const minor = major >= base ? major / (major % 5 === 0 ? 5 : 4) : Math.max(1, major / 5)
  return { major, minor: Math.max(1, Math.round(minor)) }
}
