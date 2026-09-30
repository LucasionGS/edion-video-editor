import { describe, expect, it } from 'vitest'
import { addMedia, mediaUsage, relinkPaths, removeUnusedMedia } from '@core/index'
import { projectWithClips, videoAsset } from './helpers'

describe('media bookkeeping', () => {
  it('counts uses and removes only unused assets', () => {
    const { project } = projectWithClips([0, 10], [20, 10])
    const used = project.media[0]!.id
    const spare = videoAsset()
    addMedia(project, spare)
    expect(mediaUsage(project).get(used)).toBe(2)
    expect(mediaUsage(project).has(spare.id)).toBe(false)
    expect(removeUnusedMedia(project)).toBe(1)
    expect(project.media.map((m) => m.id)).toEqual([used])
  })

  it('relinks moved files', () => {
    const { project } = projectWithClips([0, 10])
    expect(relinkPaths(project, { '/tmp/clip.mp4': '/archive/clip.mp4', '/other': '/x' })).toBe(1)
    expect(project.media[0]!.path).toBe('/archive/clip.mp4')
  })
})
