import { describe, expect, it } from 'vitest'
import { cloneClip, createTextClip, detachAudio, insertEdit, overwriteClip } from '@core/index'
import { assertTrackInvariants, projectWithClips } from './helpers'

describe('insert and overwrite', () => {
  it('overwrites whatever lies under the new clip', () => {
    const { project, clips } = projectWithClips([0, 60], [60, 60])
    const title = createTextClip(40, 30)
    title.duration = 40
    expect(overwriteClip(project, project.tracks[0]!.id, title)).toBe(true)
    expect(project.tracks[0]!.clips.map((c) => [c.type, c.start, c.duration])).toEqual([
      ['video', 0, 40],
      ['text', 40, 40],
      ['video', 80, 40]
    ])
    // The cut-off part of the second clip still starts in the right place in its source.
    const rest = project.tracks[0]!.clips[2]!
    expect('sourceIn' in rest && rest.sourceIn).toBeCloseTo(clips[1]!.sourceIn + 20 / 30)
    assertTrackInvariants(project)
  })

  it('inserts, cutting and pushing every unlocked track', () => {
    const { project, clips } = projectWithClips([0, 60], [60, 60])
    detachAudio(project, clips[0]!.id)
    const audio = project.tracks.find((t) => t.kind === 'audio')!
    const copy = cloneClip(clips[1]!)
    copy.duration = 30
    const [id] = insertEdit(project, [{ clip: copy, trackId: project.tracks[0]!.id }], 30)
    const video = project.tracks[0]!.clips
    expect(video.map((c) => [c.start, c.duration])).toEqual([
      [0, 30],
      [30, 30],
      [60, 30],
      [90, 60]
    ])
    expect(video[1]!.id).toBe(id)
    expect(audio.clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 30],
      [60, 30]
    ])
    assertTrackInvariants(project)
  })

  it('leaves locked tracks alone', () => {
    const { project } = projectWithClips([0, 60])
    project.tracks[0]!.locked = true
    const title = createTextClip(0, 30)
    insertEdit(project, [{ clip: title }], 10)
    expect(project.tracks.find((t) => t.clips.some((c) => c.type === 'video'))!.clips[0]!.start).toBe(0)
  })
})
