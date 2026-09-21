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
  it('is capped in time when zoomed out', () => {
    // 8 px at 0.1 px/frame would be 80 frames (1.3 s); the cap keeps it to a quarter second.
    expect(snapThreshold(settings, 0.1, 60)).toBe(15)
    expect(snapThreshold({ ...settings, maxSeconds: 0 }, 0.1, 60)).toBe(80)
  })
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
