import { describe, expect, it } from 'vitest'
import {
  applyAnimationPreset,
  clipsToCues,
  createTextClip,
  cuesToClips,
  evaluate,
  parseSubtitles,
  serializeSrt,
  serializeVtt
} from '@core/index'

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello <i>world</i>

2
00:00:03,000 --> 00:00:05,000
Second line
wraps here

garbage block

3
00:01:00,250 --> 00:00:59,000
backwards, ignored
`

describe('subtitles', () => {
  it('parses SRT, strips markup, skips junk', () => {
    const cues = parseSubtitles(SRT)
    expect(cues).toHaveLength(2)
    expect(cues[0]).toEqual({ start: 1, end: 3.5, text: 'Hello world' })
    expect(cues[1]!.text).toBe('Second line\nwraps here')
  })
  it('parses WebVTT with short timestamps and CRLF', () => {
    const cues = parseSubtitles(
      'WEBVTT\r\n\r\nNOTE hi\r\n\r\nintro\r\n00:01.500 --> 00:02.000 align:start\r\nHey\r\n'
    )
    expect(cues).toEqual([{ start: 1.5, end: 2, text: 'Hey' }])
  })
  it('round-trips through both formats', () => {
    const cues = parseSubtitles(SRT)
    expect(parseSubtitles(serializeSrt(cues))).toEqual(cues)
    expect(parseSubtitles(serializeVtt(cues))).toEqual(cues)
  })
  it('makes non-overlapping clips', () => {
    const clips = cuesToClips(parseSubtitles(SRT), 30)
    expect(clips.map((c) => [c.start, c.duration])).toEqual([
      [30, 60],
      [90, 60]
    ])
    expect(clipsToCues(clips, 30)[1]).toMatchObject({ start: 3, end: 5 })
  })
})

describe('animation presets', () => {
  const canvas = { width: 1920, height: 1080 }
  it('fades in from zero to the resting opacity', () => {
    const clip = createTextClip(0, 30)
    applyAnimationPreset(clip, 'in', 'fade', 15, canvas)
    expect(evaluate(clip.transform.opacity, 0)).toBe(0)
    expect(evaluate(clip.transform.opacity, 15)).toBe(1)
    expect(evaluate(clip.transform.opacity, 100)).toBe(1)
  })
  it('combines an entrance and an exit, and slides relative to the resting position', () => {
    const clip = createTextClip(0, 30)
    clip.transform.position.value = [100, 50]
    applyAnimationPreset(clip, 'in', 'slideUp', 15, canvas)
    applyAnimationPreset(clip, 'out', 'fade', 15, canvas)
    expect(evaluate(clip.transform.position, 0)[1]).toBeGreaterThan(50)
    expect(evaluate(clip.transform.position, 15)).toEqual([100, 50])
    expect(evaluate(clip.transform.opacity, clip.duration - 1)).toBe(0)
    expect(evaluate(clip.transform.opacity, 60)).toBe(1)
  })
  it('replacing a preset leaves no stale keyframes, and none clears it', () => {
    const clip = createTextClip(0, 30)
    applyAnimationPreset(clip, 'in', 'pop', 15, canvas)
    applyAnimationPreset(clip, 'in', 'fade', 15, canvas)
    expect(clip.transform.scale.keyframes).toBeUndefined()
    applyAnimationPreset(clip, 'in', 'none', 15, canvas)
    expect(clip.transform.opacity.keyframes).toBeUndefined()
    expect(clip.transform.opacity.value).toBe(1)
  })
  it('never exceeds half of a short clip', () => {
    const clip = createTextClip(0, 30)
    clip.duration = 10
    applyAnimationPreset(clip, 'in', 'fade', 100, canvas)
    expect(clip.transform.opacity.keyframes!.map((k) => k.frame)).toEqual([0, 5])
  })
})
