import { describe, expect, it } from 'vitest'
import {
  applySpeedRamp,
  collectAudioSources,
  detachAudio,
  evaluateScene,
  framesForOffset,
  hasRamp,
  removeSourceRanges,
  sourceOffset,
  sourceSpan,
  sourceTimeAt,
  splitClip,
  trimClip,
  trimRange,
  upsertKeyframe
} from '@core/index'
import type { Layer, Project, VideoClip } from '@core/index'
import { projectWithClips } from './helpers'

/** A 90-frame clip whose ramp goes from 100 % at frame 0 to 300 % at frame 60 (linear), then stays. */
function ramped(): { project: Project; clip: VideoClip } {
  const { project, clips } = projectWithClips([0, 90])
  const clip = clips[0]!
  clip.sourceIn = 1
  clip.speedRamp = { value: 1 }
  upsertKeyframe(clip.speedRamp, 0, 1, 'linear')
  upsertKeyframe(clip.speedRamp, 60, 3, 'linear')
  return { project, clip }
}
const time = (project: Project, frame: number): number | undefined =>
  (evaluateScene(project, frame).nodes[0] as Layer | undefined)?.sourceTime

describe('speed ramps', () => {
  it('integrates the speed over the clip', () => {
    const { project, clip } = ramped()
    expect(hasRamp(clip)).toBe(true)
    // Frames 0-59 run at 1 + 2·k/60 on average 1.9833…; frames 60-89 at 3.
    const first = Array.from({ length: 60 }, (_, k) => 1 + (2 * k) / 60).reduce((a, b) => a + b, 0) / 30
    expect(sourceOffset(clip, 60, 30)).toBeCloseTo(first)
    expect(sourceSpan(clip, 30)).toBeCloseTo(first + 3)
    expect(time(project, 0)).toBeCloseTo(1)
    expect(time(project, 1)).toBeCloseTo(1 + 1 / 30)
    expect(time(project, 89)).toBeCloseTo(1 + first + (29 * 3) / 30)
    for (const s of [0.5, 2, 4]) expect(sourceOffset(clip, framesForOffset(clip, s, 30), 30)).toBeCloseTo(s)
  })

  it('a constant ramp value multiplies the speed; 1 is no ramp', () => {
    const { clips } = projectWithClips([0, 30])
    const clip = clips[0]!
    clip.speedRamp = { value: 1 }
    expect(hasRamp(clip)).toBe(false)
    clip.speedRamp.value = 2
    expect(sourceTimeAt(clip, 15, 30)).toBeCloseTo(1)
  })

  it('splits and trims without jumps in the picture', () => {
    const { project, clip } = ramped()
    const before = [10, 45, 70, 89].map((f) => time(project, f))
    splitClip(project, clip.id, 45)
    expect([10, 45, 70, 89].map((f) => time(project, f))).toEqual(before.map((t) => expect.closeTo(t!, 6)))
    const at30 = time(project, 30)
    trimClip(project, clip.id, 'start', 20)
    expect(time(project, 30)).toBeCloseTo(at30!)
    trimClip(project, clip.id, 'start', 5)
    expect(time(project, 30)).toBeCloseTo(at30!)
  })

  it('limits extending by the source at the edge speed', () => {
    const { project, clip } = ramped()
    // The 10 s source has 1 s before the clip, played at 100 %: 30 frames.
    // …but the timeline cannot go before frame 0.
    expect(trimRange(project, clip.id, 'start')![0]).toBe(0)
    const tailSeconds = 10 - sourceSpan(clip, 30) - 1
    expect(trimRange(project, clip.id, 'end')![1]).toBe(90 + Math.floor((tailSeconds * 30) / 3 + 1e-6))
  })

  it('is silent and keeps its sound attached', () => {
    const { project, clip } = ramped()
    expect(collectAudioSources(project)).toHaveLength(0)
    expect(detachAudio(project, clip.id)).toBeNull()
  })

  it('maps silences through the ramp', () => {
    const { project, clip } = ramped()
    // Cut the source used by frames 60-75 (3 s/s there): offset(60) … offset(75).
    const a = clip.sourceIn + sourceOffset(clip, 60, 30)
    const b = clip.sourceIn + sourceOffset(clip, 75, 30)
    expect(removeSourceRanges(project, clip.id, [[a, b]])).toBe(15)
  })
})

describe('speed ramp presets', () => {
  it('writes eased keyframes and removes them again', () => {
    const { project, clips } = projectWithClips([0, 101])
    applySpeedRamp(project, clips[0]!.id, 'slowMiddle')
    expect(clips[0]!.speedRamp!.keyframes!.map((k) => [k.frame, k.value])).toEqual([
      [0, 1],
      [30, 1],
      [42, 0.25],
      [58, 0.25],
      [70, 1],
      [100, 1]
    ])
    expect(sourceSpan(clips[0]!, 30)).toBeLessThan(101 / 30)
    applySpeedRamp(project, clips[0]!.id, 'none')
    expect(clips[0]!.speedRamp).toBeUndefined()
  })
})
