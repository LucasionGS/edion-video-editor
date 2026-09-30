import { describe, expect, it } from 'vitest'
import {
  setClipAnimation,
  createProject,
  evaluateScene,
  insertClipAuto,
  splitClip,
  trimClip,
  clipsToCues,
  createTextClip,
  cuesToClips,
  parseSubtitles,
  serializeSrt,
  serializeVtt
} from '@core/index'
import type { Layer, Project } from '@core/index'

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

describe('entrance and exit animations', () => {
  const canvas = { width: 1920, height: 1080 }
  const projectWith = (clip: ReturnType<typeof createTextClip>) => {
    const project = createProject()
    insertClipAuto(project, clip)
    return project
  }
  const layer = (project: Project, frame: number) => evaluateScene(project, frame).nodes[0] as Layer

  it("fades in from nothing to the clip's own opacity, without writing keyframes", () => {
    const clip = createTextClip(0, 30)
    clip.transform.opacity.value = 0.8
    setClipAnimation(clip, 'in', 'fade', 15)
    expect(clip.transform.opacity.keyframes).toBeUndefined()
    const project = projectWith(clip)
    expect(layer(project, 0).transform.opacity).toBe(0)
    expect(layer(project, 15).transform.opacity).toBeCloseTo(0.8)
  })

  it('pops from almost nothing past full size, and pops out as the exact reverse', () => {
    const clip = createTextClip(0, 30)
    clip.duration = 90
    setClipAnimation(clip, 'in', 'pop', 20)
    setClipAnimation(clip, 'out', 'pop', 20)
    const project = projectWith(clip)
    const scale = (f: number) => layer(project, f).transform.scaleX
    expect(scale(0)).toBeLessThan(0.05)
    expect(Math.max(...[10, 11, 12, 13, 14].map(scale))).toBeGreaterThan(1.05)
    expect(scale(20)).toBe(1)
    for (const f of [0, 5, 12, 18]) expect(scale(89 - f)).toBeCloseTo(scale(f), 5)
  })

  it('stays at the edges when the clip is trimmed, and removing it always works', () => {
    const clip = createTextClip(0, 30)
    clip.duration = 150
    setClipAnimation(clip, 'out', 'fade', 15)
    const project = projectWith(clip)
    trimClip(project, clip.id, 'end', 60)
    // The exit now ends at the new end…
    expect(layer(project, 59).transform.opacity).toBe(0)
    expect(layer(project, 40).transform.opacity).toBe(1)
    // …and "None" removes it however the clip was trimmed.
    setClipAnimation(project.tracks[0]!.clips[0] as typeof clip, 'out', 'none', 15)
    expect(layer(project, 59).transform.opacity).toBe(1)
    expect((project.tracks[0]!.clips[0] as typeof clip).animation).toBeUndefined()
  })

  it("slides relative to the clip's own position", () => {
    const clip = createTextClip(0, 30)
    clip.transform.position.value = [100, 50]
    setClipAnimation(clip, 'in', 'slideUp', 15)
    const project = projectWith(clip)
    expect(layer(project, 0).transform.y).toBeCloseTo(50 + 0.12 * canvas.height)
    expect(layer(project, 15).transform.y).toBe(50)
  })

  it('keeps the entrance on the first part of a split and the exit on the second', () => {
    const clip = createTextClip(0, 30)
    clip.duration = 100
    setClipAnimation(clip, 'in', 'pop', 10)
    setClipAnimation(clip, 'out', 'fade', 10)
    const project = projectWith(clip)
    const right = splitClip(project, clip.id, 50)!
    const parts = project.tracks[0]!.clips as Array<typeof clip>
    expect(parts[0]!.animation).toEqual({ in: { preset: 'pop', frames: 10 } })
    expect(parts.find((c) => c.id === right)!.animation).toEqual({ out: { preset: 'fade', frames: 10 } })
  })

  it('never takes more than half of a short clip', () => {
    const clip = createTextClip(0, 30)
    clip.duration = 10
    setClipAnimation(clip, 'in', 'fade', 100)
    const project = projectWith(clip)
    expect(layer(project, 5).transform.opacity).toBe(1)
    expect(layer(project, 2).transform.opacity).toBeGreaterThan(0)
  })
})
