import { defaultTransform, newId } from '../model/factory'
import type { Clip, CompoundClip, Id, Project, Sequence, Track } from '../model/types'
import { trackKindFor } from '../model/types'
import { cutHead, cutTail, insertClip, insertClipAuto, normalizeTrack } from './edit'
import { pruneLinks } from './link'
import { allTracks, clipEnd, findClip } from './query'

/**
 * Compound clips: a group of clips turned into one clip that plays a nested sequence. It moves, trims,
 * splits and takes effects like any clip; "break apart" puts the clips back on the timeline.
 */

/** Moves the given clips into a new sequence and puts a compound clip in their place. Returns its id. */
export function createCompound(project: Project, clipIds: readonly Id[], name = 'Compound clip'): Id | null {
  const found = clipIds
    .map((id) => findClip(project, id))
    .filter((f): f is NonNullable<typeof f> => !!f && !f.track.locked && f.clip.type !== 'caption')
  if (found.length === 0) return null
  const start = Math.min(...found.map((f) => f.clip.start))
  const end = Math.max(...found.map((f) => clipEnd(f.clip)))
  const moving = new Set(found.map((f) => f.clip.id))

  // One sequence track per timeline track involved, in timeline order, keeping transitions between moved clips.
  const tracks: Track[] = []
  for (const track of project.tracks) {
    const clips = track.clips.filter((c) => moving.has(c.id))
    if (clips.length === 0) continue
    tracks.push({
      ...JSON.parse(JSON.stringify(track)),
      id: newId(),
      clips: clips.map((c) => ({ ...JSON.parse(JSON.stringify(c)), start: c.start - start })),
      transitions: track.transitions.filter((t) => moving.has(t.leftClipId) && moving.has(t.rightClipId)),
      muted: false,
      solo: false,
      hidden: false,
      locked: false
    })
    track.clips = track.clips.filter((c) => !moving.has(c.id))
    normalizeTrack(track)
  }
  // Links between a moved clip and one left behind no longer mean anything.
  for (const clip of tracks.flatMap((t) => t.clips)) if (clip.linkId) delete clip.linkId
  pruneLinks(project)

  const sequence: Sequence = { id: newId(), name, tracks }
  ;(project.sequences ??= []).push(sequence)
  const compound: CompoundClip = {
    id: newId(),
    name,
    type: 'compound',
    start,
    duration: end - start,
    sequenceId: sequence.id,
    offset: 0,
    volume: 1,
    transform: defaultTransform(),
    blendMode: 'normal',
    effects: []
  }
  // Where the top-most moved video clip was, if that track is free now; otherwise a new track.
  const top = project.tracks.find((t) => t.kind === 'video' && found.some((f) => f.track.id === t.id))
  if (!top || !insertClip(project, top.id, compound)) insertClipAuto(project, compound)
  return compound.id
}

/**
 * Replaces a compound clip with the part of its sequence it shows, trimmed to it, back on the timeline.
 * Returns the ids of the restored clips.
 */
export function breakApart(project: Project, compoundId: Id): Id[] {
  const found = findClip(project, compoundId)
  if (!found || found.track.locked || found.clip.type !== 'compound') return []
  const compound = found.clip
  const sequence = project.sequences?.find((s) => s.id === compound.sequenceId)
  if (!sequence) return []
  const from = compound.offset
  const to = compound.offset + compound.duration
  found.track.clips = found.track.clips.filter((c) => c.id !== compound.id)
  normalizeTrack(found.track)

  const restored: Id[] = []
  // Bottom sequence track first, so layers stack up in the same order they had.
  for (const track of [...sequence.tracks].reverse()) {
    for (const original of track.clips) {
      if (clipEnd(original) <= from || original.start >= to) continue
      const clip = JSON.parse(JSON.stringify(original)) as Clip
      clip.id = newId()
      const head = Math.max(0, from - clip.start)
      const tail = Math.max(0, clipEnd(clip) - to)
      if (head) cutHead(project, clip, head)
      if (tail) cutTail(project, clip, tail)
      // An edge that was cut off no longer has its entrance or exit.
      if ((head || tail) && 'animation' in clip && clip.animation) {
        if (head) delete clip.animation.in
        if (tail) delete clip.animation.out
        if (!clip.animation.in && !clip.animation.out) delete clip.animation
      }
      clip.start = compound.start + Math.max(clip.start, from) - from
      delete clip.linkId
      const target = found.track.kind === trackKindFor(clip.type) && insertClip(project, found.track.id, clip)
      if (!target) insertClipAuto(project, clip)
      restored.push(clip.id)
    }
  }
  // The sequence goes once nothing uses it any more.
  const used = allTracks(project).some((t) =>
    t.clips.some((c) => c.type === 'compound' && c.sequenceId === sequence.id)
  )
  if (!used) project.sequences = project.sequences!.filter((s) => s.id !== sequence.id)
  return restored
}
