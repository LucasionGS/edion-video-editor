import { describe, expect, it } from 'vitest'
import {
  clipEnd,
  deleteClips,
  detachAudio,
  findClip,
  linkClips,
  linkedPartners,
  pasteClips,
  setClipSpeed,
  splitClip,
  trimClip,
  trimLinked,
  unlinkClips,
  withLinked
} from '@core/index'
import type { Clip } from '@core/index'
import { assertTrackInvariants, projectWithClips } from './helpers'

function detached() {
  const { project, clips } = projectWithClips([30, 90])
  const video = clips[0]!
  const audioId = detachAudio(project, video.id)!
  return { project, videoId: video.id, audioId }
}
const clipOf = (project: Parameters<typeof findClip>[0], id: string): Clip => findClip(project, id)!.clip

describe('linked clips', () => {
  it('links a detached audio clip to its video', () => {
    const { project, videoId, audioId } = detached()
    expect(clipOf(project, videoId).linkId).toBeDefined()
    expect(clipOf(project, audioId).linkId).toBe(clipOf(project, videoId).linkId)
    expect(withLinked(project, [videoId])).toEqual([videoId, audioId])
    expect(linkedPartners(project, audioId).map((c) => c.id)).toEqual([videoId])
  })

  it('trims linked clips together, stopping at the tightest limit', () => {
    const { project, videoId, audioId } = detached()
    trimLinked(project, videoId, 'end', 100)
    expect(clipEnd(clipOf(project, videoId))).toBe(100)
    expect(clipEnd(clipOf(project, audioId))).toBe(100)
    // The source is 300 frames long and starts at 0, so the start edge cannot go before frame 30 - 0.
    trimLinked(project, audioId, 'start', 0)
    expect(clipOf(project, videoId).start).toBe(30)
    trimLinked(project, audioId, 'start', 45)
    expect(clipOf(project, videoId).start).toBe(45)
    expect(clipOf(project, audioId).start).toBe(45)
    expect((clipOf(project, audioId) as { sourceIn: number }).sourceIn).toBeCloseTo(0.5)
    assertTrackInvariants(project)
  })

  it('leaves partners alone when their edge does not line up', () => {
    const { project, videoId, audioId } = detached()
    trimClip(project, audioId, 'end', 110)
    trimLinked(project, videoId, 'end', 90)
    expect(clipEnd(clipOf(project, videoId))).toBe(90)
    expect(clipEnd(clipOf(project, audioId))).toBe(110)
  })

  it('splits partners and links the right-hand halves to each other', () => {
    const { project, videoId, audioId } = detached()
    const rightVideo = splitClip(project, videoId, 60)!
    const rightAudio = project.tracks[1]!.clips.find((c) => c.start === 60)!
    expect(clipEnd(clipOf(project, audioId))).toBe(60)
    expect(clipOf(project, rightVideo).linkId).toBe(rightAudio.linkId)
    expect(rightAudio.linkId).not.toBe(clipOf(project, videoId).linkId)
    expect(clipOf(project, videoId).linkId).toBe(clipOf(project, audioId).linkId)
    // Splitting the partner at the same frame again is a no-op.
    expect(splitClip(project, audioId, 60)).toBeNull()
    assertTrackInvariants(project)
  })

  it('drops the link once a partner is deleted', () => {
    const { project, videoId, audioId } = detached()
    deleteClips(project, [audioId])
    expect(clipOf(project, videoId).linkId).toBeUndefined()
  })

  it('links copies to each other, never to the originals', () => {
    const { project, videoId, audioId } = detached()
    const video = clipOf(project, videoId)
    const audio = clipOf(project, audioId)
    const [v2, a2] = pasteClips(project, [{ clip: video }, { clip: audio }], 500)
    expect(clipOf(project, v2!).linkId).toBe(clipOf(project, a2!).linkId)
    expect(clipOf(project, v2!).linkId).not.toBe(video.linkId)
    // A lone copy is not linked to anything.
    const [lone] = pasteClips(project, [{ clip: video }], 900)
    expect(clipOf(project, lone!).linkId).toBeUndefined()
  })

  it('changes the speed of a linked partner covering the same span', () => {
    const { project, videoId, audioId } = detached()
    setClipSpeed(project, videoId, 2)
    expect(clipOf(project, videoId).duration).toBe(45)
    expect(clipOf(project, audioId).duration).toBe(45)
    expect((clipOf(project, audioId) as { speed: number }).speed).toBe(2)
  })

  it('links and unlinks arbitrary clips', () => {
    const { project, clips } = projectWithClips([0, 10], [20, 10], [40, 10])
    const [a, b, c] = clips.map((x) => x.id) as [string, string, string]
    expect(linkClips(project, [a])).toBe(false)
    linkClips(project, [a, b])
    linkClips(project, [b, c])
    expect(new Set(withLinked(project, [a]))).toEqual(new Set([a, b, c]))
    unlinkClips(project, [c])
    expect(withLinked(project, [c])).toEqual([c])
    expect(withLinked(project, [a])).toEqual([a])
  })
})
