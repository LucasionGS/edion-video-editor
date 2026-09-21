import { describe, expect, it } from 'vitest'
import { DEFAULT_SNAP_SETTINGS, snap, snapPoints, snapThreshold } from '@core/index'
import { projectWithClips } from './helpers'

describe('snap points', () => {
  it('collects the enabled targets only', () => {
    const { project, clips } = projectWithClips([10, 50], [100, 20])
    project.markers.push({ id: 'm', frame: 77, label: '', color: '#fff' })
    expect(snapPoints(project, 33)).toEqual([0, 10, 33, 60, 77, 100, 120])
    expect(snapPoints(project, 33, new Set([clips[0]!.id]))).toEqual([0, 33, 77, 100, 120])
    const only = { clipEdges: false, playhead: false, markers: true }
    expect(snapPoints(project, 33, new Set(), only)).toEqual([0, 77])
  })
})

describe('snap threshold', () => {
  const settings = { ...DEFAULT_SNAP_SETTINGS, distance: 8, maxSeconds: 0.25 }
  it('follows the pixel radius when zoomed in', () => expect(snapThreshold(settings, 4, 60)).toBe(2))
  it('is capped in time when that still leaves something to aim at', () => {
    // 8 px at 1 px/frame is 8 frames; a 0.1 s cap at 60 fps trims it to 6.
    expect(snapThreshold({ ...settings, maxSeconds: 0.1 }, 1, 60)).toBe(6)
    expect(snapThreshold({ ...settings, maxSeconds: 0 }, 0.1, 60)).toBe(80)
  })
  it('never lets the cap shrink the pull below a few pixels', () => {
    // A 6-minute 60 fps timeline fitted to ~1000 px: one pixel is ~22 frames, far more than a quarter second.
    const zoom = 1000 / (6 * 60 * 60)
    const threshold = snapThreshold(settings, zoom, 60)
    expect(threshold * zoom).toBeCloseTo(3)
    expect(threshold).toBeGreaterThan(0.25 * 60)
  })
  it('does not cap by default', () => expect(DEFAULT_SNAP_SETTINGS.maxSeconds).toBe(0))
  it('never drops below one frame', () => expect(snapThreshold(settings, 40, 60)).toBe(1))
})

describe('snap', () => {
  it('picks the nearest point across all edges', () => {
    expect(snap([95, 145], [100, 150, 148], 10)).toEqual({ delta: 3, point: 148 })
    expect(snap([95], [120], 10)).toBeNull()
  })
  it('snaps to the time grid, but prefers a real target at equal distance', () => {
    expect(snap([58], [], 5, 30)).toEqual({ delta: 2, point: 60 })
    expect(snap([58], [56], 5, 30)).toEqual({ delta: -2, point: 56 })
    expect(snap([44], [], 5, 30)).toBeNull()
  })
  it('handles fractional grids (29.97 fps) by landing on whole frames', () => {
    expect(snap([31], [], 3, 29.97)?.point).toBe(30)
  })
})

describe('time display', () => {
  it('shows wall-clock time with milliseconds', async () => {
    const { formatPosition, formatClock, formatRulerLabel } = await import('@core/index')
    expect(formatPosition(24, 60, 'time')).toBe('0:00.400')
    expect(formatPosition(24, 60, 'timecode')).toBe('00:00:24')
    expect(formatPosition(24, 60, 'frames')).toBe('24')
    expect(formatPosition(60 * 365 + 9, 60, 'time')).toBe('6:05.150')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatClock(59.9996, 3)).toBe('1:00.000')
    expect(formatRulerLabel(30, 60, 'time')).toBe('0:00.5')
    expect(formatRulerLabel(120, 60, 'time')).toBe('0:02')
    expect(formatRulerLabel(600, 60, 'time')).toBe('0:10')
  })
})
