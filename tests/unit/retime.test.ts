import { describe, expect, it } from 'vitest'
import {
  clipEnd,
  detachAudio,
  evaluate,
  evaluateScene,
  findClip,
  insertFrameHold,
  parseSceneTimes,
  splitAtSourceTimes,
  rippleTrim,
  setClipSpeed,
  setReversed,
  slipClip,
  sourceHandles,
  sourceTimeAt,
  splitClip,
  trimClip,
  upsertKeyframe
} from '@core/index'
import type { AudioClip, Layer, Project, VideoClip } from '@core/index'
import { assertTrackInvariants, projectWithClips } from './helpers'

const video = (project: Project, id: string): VideoClip => findClip(project, id)!.clip as VideoClip
const layerTime = (project: Project, frame: number): number | undefined =>
  (evaluateScene(project, frame).nodes[0] as Layer | undefined)?.sourceTime

describe('reverse', () => {
  it('plays the same source range backwards', () => {
    const { project, clips } = projectWithClips([0, 60])
    clips[0]!.sourceIn = 1
    setReversed(project, clips[0]!.id, true)
    expect(layerTime(project, 0)).toBeCloseTo(1 + 59 / 30)
    expect(layerTime(project, 59)).toBeCloseTo(1)
  })

  it('trims the start of a reversed clip from the end of its source range', () => {
    const { project, clips } = projectWithClips([0, 60])
    const clip = clips[0]!
    clip.sourceIn = 1
    setReversed(project, clip.id, true)
    trimClip(project, clip.id, 'start', 15)
    // Still ends on source second 1; the first 15 frames (the latest source) are gone.
    expect(clip.sourceIn).toBeCloseTo(1)
    expect(sourceTimeAt(clip, 0, 30)).toBeCloseTo(1 + 44 / 30)
    trimClip(project, clip.id, 'end', 45)
    expect(clip.sourceIn).toBeCloseTo(1.5)
  })

  it('swaps the handles', () => {
    const { project, clips } = projectWithClips([0, 60])
    const clip = clips[0]!
    clip.sourceIn = 1
    expect(sourceHandles(project, clip)).toEqual({ head: 1, tail: 7 })
    setReversed(project, clip.id, true)
    expect(sourceHandles(project, clip)).toEqual({ head: 7, tail: 1 })
  })

  it('splits so that both halves keep playing backwards seamlessly', () => {
    const { project, clips } = projectWithClips([0, 60])
    const clip = clips[0]!
    setReversed(project, clip.id, true)
    const before = [0, 19, 20, 59].map((f) => layerTime(project, f))
    const rightId = splitClip(project, clip.id, 20)!
    expect([0, 19, 20, 59].map((f) => layerTime(project, f))).toEqual(before)
    expect(video(project, rightId).reversed).toBe(true)
  })

  it('reverses the linked audio too, and detached audio inherits it', () => {
    const { project, clips } = projectWithClips([0, 60])
    const audioId = detachAudio(project, clips[0]!.id)!
    setReversed(project, clips[0]!.id, true)
    expect((findClip(project, audioId)!.clip as AudioClip).reversed).toBe(true)
    setReversed(project, audioId, false)
    expect(clips[0]!.reversed).toBeUndefined()
  })
})

describe('frame hold', () => {
  it('holds the frame under the playhead and pushes the rest later', () => {
    const { project, clips } = projectWithClips([0, 60], [60, 30])
    const clip = clips[0]!
    clip.sourceIn = 2
    upsertKeyframe(clip.transform.opacity, 0, 0)
    upsertKeyframe(clip.transform.opacity, 40, 1)
    const holdId = insertFrameHold(project, clip.id, 20, 45)!
    const hold = video(project, holdId)
    expect([hold.start, hold.duration, hold.hold, hold.audioMuted]).toEqual([20, 45, true, true])
    expect(hold.sourceIn).toBeCloseTo(2 + 20 / 30)
    expect(hold.transform.opacity.keyframes).toBeUndefined()
    expect(evaluate(hold.transform.opacity, 0)).toBeCloseTo(0.5)
    // The rest of the clip continues after the hold.
    const rest = project.tracks[0]!.clips.find((c) => c.start === 65)!
    expect((rest as VideoClip).sourceIn).toBeCloseTo(2 + 20 / 30)
    expect(clips[1]!.start).toBe(105)
    expect(layerTime(project, 30)).toBeCloseTo(2 + 20 / 30)
    expect(layerTime(project, 64)).toBeCloseTo(2 + 20 / 30)
    assertTrackInvariants(project)
  })

  it('keeps linked audio in sync with a gap', () => {
    const { project, clips } = projectWithClips([0, 60])
    const audioId = detachAudio(project, clips[0]!.id)!
    insertFrameHold(project, clips[0]!.id, 30, 15)
    const audio = project.tracks.find((t) => t.kind === 'audio')!.clips
    expect(audio.map((c) => [c.start, c.duration])).toEqual([
      [0, 30],
      [45, 30]
    ])
    expect(audio[0]!.id).toBe(audioId)
  })

  it('stretches freely, ignores speed and slips to another frame', () => {
    const { project, clips } = projectWithClips([0, 60])
    const holdId = insertFrameHold(project, clips[0]!.id, 0, 30)!
    // The rest of the clip follows right after, so only a ripple trim can lengthen it.
    expect(trimClip(project, holdId, 'end', 400)).toBe(30)
    expect(rippleTrim(project, holdId, 'end', 1000)).toBe(1000)
    setClipSpeed(project, holdId, 2)
    expect(video(project, holdId).speed).toBe(1)
    const start = video(project, holdId).sourceIn
    expect(slipClip(project, holdId, 30)).toBe(30)
    expect(video(project, holdId).sourceIn).toBeCloseTo(start + 1)
    expect(clipEnd(video(project, holdId))).toBe(1000)
  })
})

describe('scene detection', () => {
  it('parses showinfo times and splits the clip there, linked audio included', () => {
    const log = `[Parsed_showinfo_1 @ 0x1] n:   0 pts:  48000 pts_time:1.6     duration: 512
[Parsed_showinfo_1 @ 0x1] n:   1 pts: 105000 pts_time:3.5 ...`
    expect(parseSceneTimes(log, 2)).toEqual([3.6, 5.5])
    const { project, clips } = projectWithClips([0, 150])
    const clip = clips[0]!
    clip.sourceIn = 2
    detachAudio(project, clip.id)
    // 3.6 s is 1.6 s into the clip (frame 48); 5.5 s is 3.5 s in (frame 105); 9 s lies outside the clip.
    expect(splitAtSourceTimes(project, clip.id, [3.6, 5.5, 9])).toBe(2)
    expect(project.tracks[0]!.clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 48],
      [48, 57],
      [105, 45]
    ])
    expect(project.tracks.find((t) => t.kind === 'audio')!.clips).toHaveLength(3)
    assertTrackInvariants(project)
  })
})
