import { clipFromMedia, createProject, insertClip, newId, addMedia } from '@core/index'
import type { MediaAsset, Project, VideoClip } from '@core/index'

export function videoAsset(duration = 10): MediaAsset {
  return {
    id: newId(), kind: 'video', name: 'clip.mp4', path: '/tmp/clip.mp4', size: 1,
    duration, width: 1920, height: 1080, fps: 30, hasAudio: true
  }
}

/** Project with one 10 s video asset and clips placed at the given [start, duration] frames on the video track. */
export function projectWithClips(...spans: Array<[number, number]>): { project: Project; clips: VideoClip[] } {
  const project = createProject()
  const asset = videoAsset()
  addMedia(project, asset)
  const trackId = project.tracks[0]!.id
  const clips = spans.map(([start, duration]) => {
    const clip = clipFromMedia(asset, start, 30) as VideoClip
    clip.duration = duration
    if (!insertClip(project, trackId, clip)) throw new Error('fixture clips overlap')
    return clip
  })
  return { project, clips }
}

export function assertTrackInvariants(project: Project): void {
  for (const track of project.tracks) {
    let cursor = 0
    for (const clip of track.clips) {
      if (clip.start < cursor) throw new Error(`overlap/unsorted on ${track.name} at ${clip.start}`)
      if (clip.duration < 1) throw new Error('empty clip')
      cursor = clip.start + clip.duration
    }
  }
}
