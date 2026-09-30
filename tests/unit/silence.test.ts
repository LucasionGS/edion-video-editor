import { describe, expect, it } from 'vitest'
import { detachAudio, padSilences, parseSilences, removeSourceRanges, setReversed } from '@core/index'
import { assertTrackInvariants, projectWithClips } from './helpers'

const LOG = `[silencedetect @ 0x1] silence_start: 1.2
[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.3
[silencedetect @ 0x1] silence_start: 4.75`

describe('silence', () => {
  it('parses silencedetect output, closing a trailing silence', () => {
    expect(parseSilences(LOG, 10, 6)).toEqual([
      [11.2, 12.5],
      [14.75, 16]
    ])
    expect(parseSilences('', 0, 5)).toEqual([])
  })

  it('pads silences and drops the ones that vanish', () => {
    expect(
      padSilences(
        [
          [1, 2],
          [3, 3.1]
        ],
        0.1
      )
    ).toEqual([[1.1, 1.9]])
  })

  it('cuts silences out of a clip and closes the gaps, with linked audio', () => {
    const { project, clips } = projectWithClips([30, 150], [180, 30])
    const clip = clips[0]!
    clip.sourceIn = 1
    const audioId = detachAudio(project, clip.id)!
    // Source 2-3 s and 4-4.5 s are silent: timeline frames 60-90 and 120-135 of the clip at 30 fps.
    const removed = removeSourceRanges(project, clip.id, [
      [2, 3],
      [4, 4.5]
    ])
    expect(removed).toBe(45)
    const video = project.tracks[0]!.clips
    expect(video.map((c) => [c.start, c.duration])).toEqual([
      [30, 30],
      [60, 30],
      [90, 45],
      [135, 30]
    ])
    expect(video.map((c) => ('sourceIn' in c ? Number(c.sourceIn.toFixed(3)) : null))).toEqual([1, 3, 4.5, 0])
    const audio = project.tracks.find((t) => t.kind === 'audio')!.clips
    expect(audio.map((c) => [c.start, c.duration])).toEqual([
      [30, 30],
      [60, 30],
      [90, 45]
    ])
    expect(audio[0]!.id).toBe(audioId)
    assertTrackInvariants(project)
  })

  it('handles silence at the very start and reversed clips', () => {
    const { project, clips } = projectWithClips([0, 90])
    const clip = clips[0]!
    expect(removeSourceRanges(project, clip.id, [[0, 1]])).toBe(30)
    expect(project.tracks[0]!.clips.map((c) => [c.start, c.duration])).toEqual([[0, 60]])

    const reversed = projectWithClips([0, 90])
    setReversed(reversed.project, reversed.clips[0]!.id, true)
    // The last source second plays first when reversed.
    removeSourceRanges(reversed.project, reversed.clips[0]!.id, [[2, 3]])
    expect(reversed.project.tracks[0]!.clips.map((c) => [c.start, c.duration])).toEqual([[0, 60]])
    const rest = reversed.project.tracks[0]!.clips[0]!
    expect('sourceIn' in rest && rest.sourceIn).toBe(0)
  })
})
