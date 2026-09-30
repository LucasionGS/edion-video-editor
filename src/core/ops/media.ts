import type { Id, Project } from '../model/types'

/** Media bookkeeping: what is used where, and moving files. */

/** How many clips use each media asset (assets that are not used are absent). */
export function mediaUsage(project: Pick<Project, 'tracks'>): Map<Id, number> {
  const usage = new Map<Id, number>()
  for (const track of project.tracks)
    for (const clip of track.clips)
      if ('mediaId' in clip) usage.set(clip.mediaId, (usage.get(clip.mediaId) ?? 0) + 1)
  return usage
}

/** Removes every asset no clip uses. Returns how many were removed. */
export function removeUnusedMedia(project: Project): number {
  const usage = mediaUsage(project)
  const before = project.media.length
  project.media = project.media.filter((m) => usage.has(m.id))
  return before - project.media.length
}

/** Points assets at new files (old path → new path), e.g. after collecting them into one folder. */
export function relinkPaths(project: Project, moved: Readonly<Record<string, string>>): number {
  let count = 0
  for (const asset of project.media) {
    const next = moved[asset.path]
    if (next && next !== asset.path) {
      asset.path = next
      count++
    }
  }
  return count
}
