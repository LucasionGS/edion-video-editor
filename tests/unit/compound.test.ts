import { describe, expect, it } from 'vitest'
import {
  allLayers,
  breakApart,
  collectAudioSources,
  createCompound,
  createTextClip,
  evaluateScene,
  findClip,
  insertClipAuto,
  mediaUsage,
  removeUnusedMedia,
  sourceGainAt,
  splitClip,
  trimClip,
  trimRange
} from '@core/index'
import type { CompoundClip, Layer, Project } from '@core/index'
import { assertTrackInvariants, projectWithClips } from './helpers'

/** Video clips at 30-90 and 90-150, plus a title over 40-70 on a track above. */
function fixture(): { project: Project; ids: string[] } {
  const { project, clips } = projectWithClips([30, 60], [90, 60])
  clips[1]!.sourceIn = 3
  const title = createTextClip(40, 30)
  title.duration = 30
  insertClipAuto(project, title)
  return { project, ids: [...clips.map((c) => c.id), title.id] }
}
const compoundOf = (project: Project, id: string): CompoundClip => findClip(project, id)!.clip as CompoundClip

describe('compound clips', () => {
  it('replaces the clips with one clip that shows them', () => {
    const { project, ids } = fixture()
    const before = [45, 100].map((f) => evaluateScene(project, f))
    const id = createCompound(project, ids)!
    const compound = compoundOf(project, id)
    expect([compound.start, compound.duration, compound.offset]).toEqual([30, 120, 0])
    expect(project.tracks.flatMap((t) => t.clips).map((c) => c.id)).toEqual([id])
    expect(project.sequences![0]!.tracks.map((t) => t.clips.length)).toEqual([1, 2])

    const scene = evaluateScene(project, 45)
    const layer = scene.nodes[0] as Layer
    expect(layer.clip.id).toBe(id)
    expect(layer.nested!.background).toBe('transparent')
    // The same clips, at the same source times, now one level down.
    const nested = allLayers(scene).slice(1)
    expect(nested.map((l) => [l.clip.type, l.sourceTime])).toEqual(
      allLayers(before[0]!).map((l) => [l.clip.type, l.sourceTime])
    )
    expect(
      allLayers(evaluateScene(project, 100))
        .slice(1)
        .map((l) => l.sourceTime)
    ).toEqual(allLayers(before[1]!).map((l) => l.sourceTime))
    assertTrackInvariants(project)
  })

  it('plays the sound inside it, placed and limited to what it shows', () => {
    const { project, ids } = fixture()
    const id = createCompound(project, ids)!
    const compound = compoundOf(project, id)
    compound.volume = 0.5
    trimClip(project, id, 'end', 120)
    const sources = collectAudioSources(project)
    expect(sources.map((s) => [s.clip.start, s.clip.duration, s.bounds])).toEqual([
      [30, 60, [30, 120]],
      [90, 60, [30, 120]]
    ])
    expect(sourceGainAt(sources[1]!, 10)).toBeCloseTo(0.5)
    // Past the trimmed end of the compound the second clip is silent.
    expect(sourceGainAt(sources[1]!, 40)).toBe(0)
  })

  it('trims into its sequence and splits like any clip', () => {
    const { project, ids } = fixture()
    const id = createCompound(project, ids)!
    expect(trimRange(project, id, 'start')).toEqual([30, 149])
    trimClip(project, id, 'start', 60)
    expect(compoundOf(project, id).offset).toBe(30)
    expect(trimRange(project, id, 'start')![0]).toBe(30)
    const right = splitClip(project, id, 100)!
    expect(compoundOf(project, right).offset).toBe(70)
    expect(compoundOf(project, right).sequenceId).toBe(compoundOf(project, id).sequenceId)
    // Both halves still show the second video clip at the right source time.
    const layer = allLayers(evaluateScene(project, 110)).find((l) => l.clip.type === 'video')!
    expect(layer.sourceTime).toBeCloseTo(3 + 20 / 30)
  })

  it('breaks apart into the part it shows, trimmed', () => {
    const { project, ids } = fixture()
    const id = createCompound(project, ids)!
    trimClip(project, id, 'start', 50)
    trimClip(project, id, 'end', 120)
    const restored = breakApart(project, id)
    expect(restored).toHaveLength(3)
    const clips = project.tracks.flatMap((t) => t.clips).sort((a, b) => a.start - b.start)
    expect(clips.map((c) => [c.type, c.start, c.duration])).toEqual([
      ['video', 50, 40],
      ['text', 50, 20],
      ['video', 90, 30]
    ])
    expect(project.sequences).toEqual([])
    assertTrackInvariants(project)
  })

  it('keeps the media it uses', () => {
    const { project, ids } = fixture()
    createCompound(project, ids)
    expect(mediaUsage(project).get(project.media[0]!.id)).toBe(2)
    expect(removeUnusedMedia(project)).toBe(0)
  })
})
