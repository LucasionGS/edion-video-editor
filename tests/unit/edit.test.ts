import { describe, expect, it } from 'vitest'
import {
  addTrack,
  clipEnd,
  collectAudioSources,
  createCaptionClip,
  createTextClip,
  deleteClips,
  detachAudio,
  evaluate,
  evaluateScene,
  findClip,
  insertClip,
  insertClipAuto,
  moveClips,
  moveTrack,
  nearestFreeStart,
  nudgeClips,
  pasteClips,
  projectDuration,
  setClipSpeed,
  setTransition,
  splitClip,
  trimClip,
  upsertKeyframe
} from '@core/index'
import type { VideoClip } from '@core/index'
import { assertTrackInvariants, projectWithClips } from './helpers'

describe('tracks', () => {
  it('reorders within the same kind and never crosses into another kind', () => {
    const { project } = projectWithClips([0, 10])
    addTrack(project, 'video')
    addTrack(project, 'video')
    // [V3, V2, V1, A1]
    const names = () => project.tracks.map((t) => t.name)
    expect(moveTrack(project, project.tracks[0]!.id, 2)).toBe(true)
    expect(names()).toEqual(['Video 2', 'Video 1', 'Video 3', 'Audio 1'])
    // Trying to drop a video track below the audio track stops at the bottom of the video group.
    moveTrack(project, project.tracks[0]!.id, 4)
    expect(names()).toEqual(['Video 1', 'Video 3', 'Video 2', 'Audio 1'])
    expect(moveTrack(project, project.tracks[3]!.id, 0)).toBe(false)
    expect(names()[3]).toBe('Audio 1')
  })
})

describe('insert', () => {
  it('rejects overlaps and wrong track kinds', () => {
    const { project } = projectWithClips([0, 100])
    const video = project.tracks[0]!
    expect(insertClip(project, video.id, createTextClip(50, 30))).toBe(false)
    expect(insertClip(project, project.tracks[1]!.id, createTextClip(500, 30))).toBe(false)
    expect(insertClip(project, video.id, createTextClip(100, 30))).toBe(true)
    assertTrackInvariants(project)
  })
  it('creates a new track above when nothing fits', () => {
    const { project } = projectWithClips([0, 100])
    const trackId = insertClipAuto(project, createTextClip(10, 30))
    expect(project.tracks[0]!.id).toBe(trackId)
    expect(project.tracks.filter((t) => t.kind === 'video')).toHaveLength(2)
  })
  it('puts captions on a caption track at the top', () => {
    const { project } = projectWithClips([0, 100])
    insertClipAuto(project, createCaptionClip(0, 30, 'hi'))
    expect(project.tracks[0]!.kind).toBe('caption')
  })
  it('finds the nearest free gap', () => {
    const { project } = projectWithClips([0, 100], [150, 100])
    const track = project.tracks[0]!
    expect(nearestFreeStart(track, 90, 50)).toBe(100)
    expect(nearestFreeStart(track, 90, 60)).toBe(250)
    expect(nearestFreeStart(track, 400, 60)).toBe(400)
  })
})

describe('move', () => {
  it('moves atomically', () => {
    const { project, clips } = projectWithClips([0, 100], [100, 100], [300, 50])
    const trackId = project.tracks[0]!.id
    // Collides with the third clip → nothing moves.
    expect(moveClips(project, [{ clipId: clips[0]!.id, trackId, start: 280 }])).toBe(false)
    expect(clips[0]!.start).toBe(0)
    // Moving two together by +20 is fine even though they pass through each other's old space.
    expect(
      moveClips(project, [
        { clipId: clips[0]!.id, trackId, start: 20 },
        { clipId: clips[1]!.id, trackId, start: 120 }
      ])
    ).toBe(true)
    assertTrackInvariants(project)
  })
  it('refuses negative starts and locked tracks', () => {
    const { project, clips } = projectWithClips([10, 100])
    const track = project.tracks[0]!
    expect(moveClips(project, [{ clipId: clips[0]!.id, trackId: track.id, start: -5 }])).toBe(false)
    track.locked = true
    expect(moveClips(project, [{ clipId: clips[0]!.id, trackId: track.id, start: 50 }])).toBe(false)
  })
})

describe('trim', () => {
  it('clamps the start to the source head and adjusts sourceIn', () => {
    const { project, clips } = projectWithClips([60, 100])
    const clip = clips[0]!
    clip.sourceIn = 1 // 30 frames of head
    expect(trimClip(project, clip.id, 'start', 0)).toBe(30)
    expect(clip.sourceIn).toBeCloseTo(0)
    expect(clip.duration).toBe(130)
    expect(trimClip(project, clip.id, 'start', 90)).toBe(90)
    expect(clip.sourceIn).toBeCloseTo(2)
  })
  it('clamps the end to the source tail and the next clip', () => {
    const { project, clips } = projectWithClips([0, 100], [250, 50])
    expect(trimClip(project, clips[0]!.id, 'end', 1000)).toBe(250)
    const solo = projectWithClips([0, 100])
    expect(trimClip(solo.project, solo.clips[0]!.id, 'end', 1000)).toBe(300) // 10 s source
  })
  it('never collapses a clip', () => {
    const { project, clips } = projectWithClips([0, 100])
    expect(trimClip(project, clips[0]!.id, 'end', -50)).toBe(1)
  })
  it('keeps keyframes at the same timeline position', () => {
    const { project, clips } = projectWithClips([0, 100])
    const clip = clips[0]!
    upsertKeyframe(clip.transform.opacity, 50, 0.5)
    trimClip(project, clip.id, 'start', 20)
    expect(clip.transform.opacity.keyframes![0]!.frame).toBe(30)
  })
})

describe('split', () => {
  it('produces two clips covering the original', () => {
    const { project, clips } = projectWithClips([10, 100])
    const rightId = splitClip(project, clips[0]!.id, 40)!
    const left = clips[0]!
    const right = findClip(project, rightId)!.clip as VideoClip
    expect([left.start, left.duration, right.start, right.duration]).toEqual([10, 30, 40, 70])
    expect(right.sourceIn).toBeCloseTo(1)
    assertTrackInvariants(project)
  })
  it('ignores cuts on the edges', () => {
    const { project, clips } = projectWithClips([10, 100])
    expect(splitClip(project, clips[0]!.id, 10)).toBeNull()
    expect(splitClip(project, clips[0]!.id, 110)).toBeNull()
  })
  it('preserves animation across the cut', () => {
    const { project, clips } = projectWithClips([0, 100])
    const clip = clips[0]!
    upsertKeyframe(clip.transform.rotation, 0, 0, 'linear')
    upsertKeyframe(clip.transform.rotation, 100, 100, 'linear')
    const right = findClip(project, splitClip(project, clip.id, 25)!)!.clip as VideoClip
    expect(evaluate(clip.transform.rotation, 25)).toBeCloseTo(25)
    expect(evaluate(right.transform.rotation, 0)).toBeCloseTo(25)
    expect(evaluate(right.transform.rotation, 75)).toBeCloseTo(100)
  })
  it('hands the outgoing transition to the right part', () => {
    const { project, clips } = projectWithClips([0, 100], [100, 100])
    setTransition(project, clips[0]!.id, 'crossfade', 20)
    const rightId = splitClip(project, clips[0]!.id, 50)
    expect(project.tracks[0]!.transitions[0]!.leftClipId).toBe(rightId)
  })
})

describe('delete', () => {
  it('leaves a gap by default and closes it with ripple', () => {
    const a = projectWithClips([0, 100], [100, 50], [200, 50])
    deleteClips(a.project, [a.clips[1]!.id])
    expect(a.clips[2]!.start).toBe(200)

    const b = projectWithClips([0, 100], [100, 50], [200, 50])
    deleteClips(b.project, [b.clips[0]!.id, b.clips[1]!.id], true)
    expect(b.clips[2]!.start).toBe(50)
    expect(projectDuration(b.project)).toBe(100)
  })
  it('drops transitions that lost a clip', () => {
    const { project, clips } = projectWithClips([0, 100], [100, 100])
    setTransition(project, clips[0]!.id, 'crossfade', 20)
    deleteClips(project, [clips[1]!.id])
    expect(project.tracks[0]!.transitions).toHaveLength(0)
  })
})

describe('transitions', () => {
  it('needs touching clips', () => {
    const { project, clips } = projectWithClips([0, 100], [120, 100])
    expect(setTransition(project, clips[0]!.id, 'crossfade', 20)).toBeNull()
  })
  it('is limited by the shorter clip and removed when clips separate', () => {
    const { project, clips } = projectWithClips([0, 100], [100, 8])
    setTransition(project, clips[0]!.id, 'crossfade', 60)
    expect(project.tracks[0]!.transitions[0]!.duration).toBe(16)
    moveClips(project, [{ clipId: clips[1]!.id, trackId: project.tracks[0]!.id, start: 200 }])
    expect(project.tracks[0]!.transitions).toHaveLength(0)
  })
})

describe('speed, paste, detach', () => {
  it('doubles speed by halving the clip', () => {
    const { project, clips } = projectWithClips([0, 100])
    setClipSpeed(project, clips[0]!.id, 2)
    expect(clips[0]!.duration).toBe(50)
  })
  it('slowing down never runs into the next clip', () => {
    const { project, clips } = projectWithClips([0, 100], [120, 50])
    setClipSpeed(project, clips[0]!.id, 0.5)
    expect(clipEnd(clips[0]!)).toBe(120)
    assertTrackInvariants(project)
  })
  it('pastes with relative timing on free space', () => {
    const { project, clips } = projectWithClips([0, 50], [80, 50])
    const ids = pasteClips(
      project,
      clips.map((clip) => ({ clip, trackId: project.tracks[0]!.id })),
      500
    )
    expect(ids.map((id) => findClip(project, id)!.clip.start)).toEqual([500, 580])
    assertTrackInvariants(project)
  })
  it('detaches audio once', () => {
    const { project, clips } = projectWithClips([30, 100])
    const audioId = detachAudio(project, clips[0]!.id)!
    const audio = findClip(project, audioId)!
    expect(audio.track.kind).toBe('audio')
    expect(audio.clip.start).toBe(30)
    expect(clips[0]!.audioMuted).toBe(true)
    expect(detachAudio(project, clips[0]!.id)).toBeNull()
  })
})

describe('disable and nudge', () => {
  it('leaves disabled clips out of the picture and the sound', () => {
    const { project, clips } = projectWithClips([0, 30], [30, 30])
    clips[0]!.disabled = true
    expect(evaluateScene(project, 10).nodes).toHaveLength(0)
    expect(evaluateScene(project, 40).nodes).toHaveLength(1)
    expect(collectAudioSources(project).map((s) => s.clip.id)).toEqual([clips[1]!.id])
  })

  it('nudges only when there is room', () => {
    const { project, clips } = projectWithClips([0, 30], [40, 30])
    expect(nudgeClips(project, [clips[1]!.id], -5)).toBe(true)
    expect(clips[1]!.start).toBe(35)
    expect(nudgeClips(project, [clips[1]!.id], -6)).toBe(false)
    expect(nudgeClips(project, [clips[0]!.id, clips[1]!.id], 3)).toBe(true)
    expect([clips[0]!.start, clips[1]!.start]).toEqual([3, 38])
    expect(nudgeClips(project, [clips[0]!.id], -4)).toBe(false)
  })
})
