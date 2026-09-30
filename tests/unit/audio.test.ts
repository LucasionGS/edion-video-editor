import { describe, expect, it } from 'vitest'
import {
  applyGain,
  AUDIO_EFFECTS,
  collectAudioSources,
  normalizationGain,
  parseEbur128,
  upsertKeyframe
} from '@core/index'
import { projectWithClips } from './helpers'

const LOG = `[Parsed_ebur128_0 @ 0x55] t: 1.1      TARGET:-23 LUFS    M: -18.6 S:-120.7     I: -18.6 LUFS
[Parsed_ebur128_0 @ 0x55] Summary:

  Integrated loudness:
    I:         -20.4 LUFS
    Threshold: -30.6 LUFS

  Loudness range:
    LRA:         0.0 LU

  True peak:
    Peak:       -3.2 dBFS`

describe('loudness', () => {
  it('parses the EBU R128 summary, not the running lines', () => {
    expect(parseEbur128(LOG)).toEqual({ integrated: -20.4, peak: -3.2 })
    expect(parseEbur128('nothing here')).toBeNull()
    expect(parseEbur128('Summary:\n I: -inf LUFS\n Peak: -inf dBFS')).toEqual({
      integrated: -Infinity,
      peak: -Infinity
    })
  })

  it('aims for -14 LUFS but keeps peaks below -1 dBFS', () => {
    // Quiet and clean: +6 dB.
    expect(normalizationGain({ integrated: -20, peak: -10 })).toBeCloseTo(10 ** (6 / 20))
    // Quiet but peaky: only up to the peak ceiling (+2 dB).
    expect(normalizationGain({ integrated: -20, peak: -3 })).toBeCloseTo(10 ** (2 / 20))
    // Too loud: turned down.
    expect(normalizationGain({ integrated: -8, peak: 0 })).toBeLessThan(1)
    // Silence stays as it is; huge boosts are capped.
    expect(normalizationGain({ integrated: -Infinity, peak: -Infinity })).toBe(1)
    expect(normalizationGain({ integrated: -60, peak: -50 })).toBe(4)
  })

  it('applies the gain, keeping the shape of keyframed volume', () => {
    const { project, clips } = projectWithClips([0, 60], [60, 60])
    applyGain(project, clips[0]!.id, 2)
    expect(clips[0]!.volume.value).toBe(2)
    upsertKeyframe(clips[1]!.volume, 0, 0.5)
    upsertKeyframe(clips[1]!.volume, 30, 1)
    applyGain(project, clips[1]!.id, 1.5)
    expect(clips[1]!.volume.keyframes!.map((k) => k.value)).toEqual([0.75, 1.5])
  })
})

describe('mixer data', () => {
  it('keeps defaults when tracks and clips have no mix settings', () => {
    const { project } = projectWithClips([0, 60])
    const [source] = collectAudioSources(project)
    expect(source?.clip.pan).toBeUndefined()
    expect(project.tracks[0]!.volume).toBeUndefined()
  })
  it('has defaults inside every parameter range', () => {
    for (const spec of AUDIO_EFFECTS)
      for (const p of Object.values(spec.params)) expect(p.default >= p.min && p.default <= p.max).toBe(true)
  })
})
