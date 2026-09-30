import { newId } from '../model/factory'
import type { Clip, Id, Project } from '../model/types'

/**
 * Linked clips: clips that share a `linkId` (typically a video and its detached audio) are edited as
 * one. Links are only a tag on the clips, so nothing needs updating when clips move between tracks.
 */

function allClips(project: Project): Clip[] {
  return project.tracks.flatMap((t) => t.clips)
}

/** `ids` plus every clip linked to one of them, in a stable order (the given ids first). */
export function withLinked(project: Project, ids: readonly Id[]): Id[] {
  const wanted = new Set(ids)
  const links = new Set<Id>()
  for (const clip of allClips(project)) if (wanted.has(clip.id) && clip.linkId) links.add(clip.linkId)
  const result = [...ids]
  for (const clip of allClips(project)) {
    if (clip.linkId && links.has(clip.linkId) && !wanted.has(clip.id)) {
      wanted.add(clip.id)
      result.push(clip.id)
    }
  }
  return result
}

/** Clips linked to `clipId`, excluding itself. */
export function linkedPartners(project: Project, clipId: Id): Clip[] {
  const clips = allClips(project)
  const linkId = clips.find((c) => c.id === clipId)?.linkId
  return linkId ? clips.filter((c) => c.linkId === linkId && c.id !== clipId) : []
}

/** Links the given clips into one group (merging any groups they were already part of). */
export function linkClips(project: Project, ids: readonly Id[]): boolean {
  const members = new Set(withLinked(project, ids))
  if (members.size < 2) return false
  const linkId = newId()
  for (const clip of allClips(project)) if (members.has(clip.id)) clip.linkId = linkId
  return true
}

/** Removes the given clips (and, for whole groups, their partners) from their link groups. */
export function unlinkClips(project: Project, ids: readonly Id[]): void {
  const members = new Set(withLinked(project, ids))
  for (const clip of allClips(project)) if (members.has(clip.id)) delete clip.linkId
}

/** Drops link ids that no longer connect anything (their partners were deleted). */
export function pruneLinks(project: Project): void {
  const counts = new Map<Id, number>()
  const clips = allClips(project)
  for (const clip of clips) if (clip.linkId) counts.set(clip.linkId, (counts.get(clip.linkId) ?? 0) + 1)
  for (const clip of clips) if (clip.linkId && counts.get(clip.linkId) === 1) delete clip.linkId
}

/** Gives copied clips fresh link ids, so copies link to each other but never to the originals. */
export function relinkCopies(clips: readonly Clip[]): void {
  const fresh = new Map<Id, Id>()
  for (const clip of clips) {
    if (!clip.linkId) continue
    let next = fresh.get(clip.linkId)
    if (!next) fresh.set(clip.linkId, (next = newId()))
    clip.linkId = next
  }
  // A lone copy (its partner was not copied) is not linked to anything.
  const counts = new Map<Id, number>()
  for (const clip of clips) if (clip.linkId) counts.set(clip.linkId, (counts.get(clip.linkId) ?? 0) + 1)
  for (const clip of clips) if (clip.linkId && counts.get(clip.linkId) === 1) delete clip.linkId
}
