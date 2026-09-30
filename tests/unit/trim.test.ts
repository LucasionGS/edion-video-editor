import { describe, expect, it } from 'vitest'
import {
  clipEnd,
  closeAllGaps,
  closeGap,
  detachAudio,
  findClip,
  gapAt,
  rippleTrim,
  rollEdit,
  slideClip,
  slipClip,
  upsertKeyframe
} from '@core/index'
import type { Project, VideoClip } from '@core/index'
import { assertTrackInvariants, projectWithClips } from './helpers'

const video = (project: Project, id: string): VideoClip => findClip(project, id)!.clip as VideoClip
/** The fixture source is 10 s at 30 fps = 300 frames; give clips room on both sides of their source. */
function withHandles(...spans: Array<[number, number]>) {
  const fixture = projectWithClips(...spans)
  for (const clip of fixture.clips) clip.sourceIn = 2
  return fixture
}

describe('ripple trim', () => {
  it('shortening the end pulls later clips along', () => {
    const { project, clips } = withHandles([0, 60], [60, 60], [150, 30])
    expect(rippleTrim(project, clips[0]!.id, 'end', 40)).toBe(40)
    expect(clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 40],
      [40, 60],
      [130, 30]
    ])
    assertTrackInvariants(project)
  })

  it('lengthening the end pushes later clips instead of overwriting them', () => {
    const { project, clips } = withHandles([0, 60], [60, 60])
    rippleTrim(project, clips[0]!.id, 'end', 90)
    expect(clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 90],
      [90, 60]
    ])
  })

  it('trimming the start keeps the clip in place and moves the content', () => {
    const { project, clips } = withHandles([30, 60], [90, 60])
    upsertKeyframe(clips[0]!.transform.opacity, 20, 0.5)
    expect(rippleTrim(project, clips[0]!.id, 'start', 45)).toBe(30)
    expect(clips[0]!.start).toBe(30)
    expect(clips[0]!.duration).toBe(45)
    expect(clips[0]!.sourceIn).toBeCloseTo(2.5)
    expect(clips[0]!.transform.opacity.keyframes![0]!.frame).toBe(5)
    expect(clips[1]!.start).toBe(75)
  })

  it('is limited by the source media', () => {
    const { project, clips } = withHandles([0, 60])
    // 2 s of head = 60 frames available before the in point.
    rippleTrim(project, clips[0]!.id, 'start', -500)
    expect(clips[0]!.duration).toBe(120)
    expect(clips[0]!.sourceIn).toBe(0)
  })

  it('ripples a linked audio clip on its own track', () => {
    const { project, clips } = withHandles([0, 60], [60, 60])
    const audioId = detachAudio(project, clips[0]!.id)!
    rippleTrim(project, clips[0]!.id, 'end', 30)
    expect(clipEnd(findClip(project, audioId)!.clip)).toBe(30)
    expect(clips[1]!.start).toBe(30)
  })
})

describe('roll', () => {
  it('moves the cut without moving anything else', () => {
    const { project, clips } = withHandles([0, 60], [60, 60], [120, 60])
    expect(rollEdit(project, clips[0]!.id, 80)).toBe(80)
    expect(clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 80],
      [80, 40],
      [120, 60]
    ])
    expect(clips[1]!.sourceIn).toBeCloseTo(2 + 20 / 30)
    assertTrackInvariants(project)
  })

  it('is limited by the right clip length and the left clip handles', () => {
    const { project, clips } = withHandles([0, 60], [60, 60])
    rollEdit(project, clips[0]!.id, 500)
    expect(clips[0]!.duration).toBe(119)
    expect(clips[1]!.duration).toBe(1)
    rollEdit(project, clips[0]!.id, -500)
    expect(clips[0]!.duration).toBe(1)
  })

  it('needs an adjacent clip on the right', () => {
    const { project, clips } = withHandles([0, 60], [70, 60])
    expect(rollEdit(project, clips[0]!.id, 65)).toBeNull()
  })
})

describe('slip', () => {
  it('changes the source range but not the timeline position', () => {
    const { project, clips } = withHandles([30, 60])
    expect(slipClip(project, clips[0]!.id, 15)).toBe(15)
    expect(video(project, clips[0]!.id).sourceIn).toBeCloseTo(2.5)
    expect([clips[0]!.start, clips[0]!.duration]).toEqual([30, 60])
    // Only 2.5 s (75 frames) of head are left.
    expect(slipClip(project, clips[0]!.id, -500)).toBe(-75)
    expect(clips[0]!.sourceIn).toBe(0)
  })
})

describe('slide', () => {
  it('moves the clip while its neighbours absorb the change', () => {
    const { project, clips } = withHandles([0, 60], [60, 30], [90, 60])
    expect(slideClip(project, clips[1]!.id, 10)).toBe(10)
    expect(clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 70],
      [70, 30],
      [100, 50]
    ])
    expect(clips[2]!.sourceIn).toBeCloseTo(2 + 10 / 30)
    assertTrackInvariants(project)
  })

  it('uses the free space when there is no neighbour', () => {
    const { project, clips } = withHandles([10, 30], [60, 30])
    expect(slideClip(project, clips[0]!.id, -50)).toBe(-10)
    expect(slideClip(project, clips[0]!.id, 100)).toBe(30)
    expect(clips[0]!.start).toBe(30)
  })
})

describe('gaps', () => {
  it('finds and closes the gap under a frame', () => {
    const { project, clips } = withHandles([0, 30], [50, 30], [100, 30])
    const track = project.tracks[0]!
    expect(gapAt(track, 40)).toEqual({ start: 30, end: 50 })
    expect(gapAt(track, 10)).toBeNull()
    expect(gapAt(track, 200)).toBeNull()
    expect(closeGap(project, track.id, 40)).toBe(20)
    expect(clips.map((c) => c.start)).toEqual([0, 30, 80])
    closeAllGaps(project, track.id)
    expect(clips.map((c) => c.start)).toEqual([0, 30, 60])
  })
})
