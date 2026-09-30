import { shiftKeyframes, splitAnimatable } from '../keyframes/animatable'
import { createTrack, newId } from '../model/factory'
import type { AudioClip, Clip, Id, MediaAsset, Project, Track, TrackKind } from '../model/types'
import { isAudibleClip, isVisualClip, trackKindFor } from '../model/types'
import { linkedPartners, pruneLinks, relinkCopies } from './link'
import { animatablesOf, clipEnd, findClip, findTrack, isFree, sourceHandles } from './query'

/**
 * Timeline edit operations. They mutate their `project` argument, so call them on an Immer draft
 * (see History). Every op leaves each track sorted, overlap-free and with only valid transitions.
 */

const EPSILON = 1e-6

function normalizeTrack(track: Track): void {
  track.clips.sort((a, b) => a.start - b.start)
  track.transitions = track.transitions.filter((t) => {
    const left = track.clips.find((c) => c.id === t.leftClipId)
    const right = track.clips.find((c) => c.id === t.rightClipId)
    if (!left || !right || clipEnd(left) !== right.start) return false
    // Each clip contributes half of the transition.
    const max = Math.min(left.duration, right.duration) * 2
    t.duration = Math.max(2, Math.min(t.duration, max - (max % 2)))
    return true
  })
}

function clampFades(clip: Clip): void {
  if (!isAudibleClip(clip)) return
  clip.fadeIn = Math.min(clip.fadeIn, clip.duration)
  clip.fadeOut = Math.min(clip.fadeOut, clip.duration - clip.fadeIn)
}

// ── Tracks ────────────────────────────────────────────────────────────────────────────────────────

/** Adds a track where users expect it: new video tracks on top, audio at the bottom, captions above everything. */
export function addTrack(project: Project, kind: TrackKind): Track {
  const count = project.tracks.filter((t) => t.kind === kind).length
  const label = kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Captions'
  const track = createTrack(kind, kind === 'caption' && count === 0 ? label : `${label} ${count + 1}`)
  if (kind === 'audio') project.tracks.push(track)
  else if (kind === 'caption') project.tracks.unshift(track)
  else {
    const firstVideo = project.tracks.findIndex((t) => t.kind === 'video')
    project.tracks.splice(firstVideo < 0 ? project.tracks.length : firstVideo, 0, track)
  }
  return track
}

export function removeTrack(project: Project, trackId: Id): void {
  project.tracks = project.tracks.filter((t) => t.id !== trackId)
}

/**
 * Moves a track to `toIndex` (its position in the list after the move). Tracks stay grouped by kind
 * (captions above video above audio), so the target is clamped to the group of the same kind.
 */
export function moveTrack(project: Project, trackId: Id, toIndex: number): boolean {
  const from = project.tracks.findIndex((t) => t.id === trackId)
  if (from < 0) return false
  const [track] = project.tracks.splice(from, 1)
  const sameKind = project.tracks.map((t, i) => (t.kind === track!.kind ? i : -1)).filter((i) => i >= 0)
  const min = sameKind.length ? sameKind[0]! : from
  const max = sameKind.length ? sameKind[sameKind.length - 1]! + 1 : from
  const to = Math.max(min, Math.min(toIndex, max))
  project.tracks.splice(to, 0, track!)
  return to !== from
}

// ── Media ─────────────────────────────────────────────────────────────────────────────────────────

export function addMedia(project: Project, asset: MediaAsset): void {
  if (!project.media.some((m) => m.id === asset.id)) project.media.push(asset)
}

export function removeMedia(project: Project, mediaId: Id): void {
  project.media = project.media.filter((m) => m.id !== mediaId)
  for (const track of project.tracks) {
    track.clips = track.clips.filter((c) => !('mediaId' in c) || c.mediaId !== mediaId)
    normalizeTrack(track)
  }
  pruneLinks(project)
}

// ── Insert / move ─────────────────────────────────────────────────────────────────────────────────

export function insertClip(project: Project, trackId: Id, clip: Clip): boolean {
  const track = findTrack(project, trackId)
  if (!track || track.locked || track.kind !== trackKindFor(clip.type)) return false
  if (!isFree(track, clip.start, clip.duration)) return false
  track.clips.push(clip)
  normalizeTrack(track)
  return true
}

/** Inserts on `preferredTrackId` when it fits, else on the first compatible track with room, else on a new track. */
export function insertClipAuto(project: Project, clip: Clip, preferredTrackId?: Id): Id {
  const kind = trackKindFor(clip.type)
  const compatible = project.tracks.filter((t) => t.kind === kind && !t.locked)
  // Bottom-most video track first, so new layers stack upwards like in every other editor.
  if (kind === 'video') compatible.reverse()
  const preferred = compatible.find((t) => t.id === preferredTrackId)
  const ordered = preferred ? [preferred, ...compatible.filter((t) => t !== preferred)] : compatible
  const target = ordered.find((t) => isFree(t, clip.start, clip.duration)) ?? addTrack(project, kind)
  insertClip(project, target.id, clip)
  return target.id
}

export interface ClipMove {
  clipId: Id
  trackId: Id
  start: number
}

/** Moves clips atomically: either every target position is valid, or nothing changes. */
export function moveClips(project: Project, moves: readonly ClipMove[]): boolean {
  const moving = new Set(moves.map((m) => m.clipId))
  const resolved = moves.map((move) => ({
    move,
    from: findClip(project, move.clipId),
    to: findTrack(project, move.trackId)
  }))
  for (const { move, from, to } of resolved) {
    if (!from || !to || to.locked || from.track.locked) return false
    if (to.kind !== trackKindFor(from.clip.type)) return false
    if (!isFree(to, move.start, from.clip.duration, moving)) return false
  }
  // Moved clips must not collide with each other either.
  for (const a of resolved) {
    for (const b of resolved) {
      if (a === b || a.move.trackId !== b.move.trackId) continue
      const aEnd = a.move.start + a.from!.clip.duration
      const bEnd = b.move.start + b.from!.clip.duration
      if (a.move.start < bEnd && b.move.start < aEnd) return false
    }
  }
  for (const { move, from, to } of resolved) {
    const clip = from!.clip
    from!.track.clips = from!.track.clips.filter((c) => c.id !== clip.id)
    clip.start = move.start
    to!.clips.push(clip)
  }
  for (const track of project.tracks) normalizeTrack(track)
  return true
}

// ── Trim / split ──────────────────────────────────────────────────────────────────────────────────

/** Frames the given edge of a clip can be trimmed to: bounded by neighbours, source media and a 1-frame minimum. */
export function trimRange(project: Project, clipId: Id, edge: 'start' | 'end'): [number, number] | null {
  const found = findClip(project, clipId)
  if (!found) return null
  const { clip, track, index } = found
  const { fps } = project.settings
  const speed = 'speed' in clip ? clip.speed : 1
  const handles = sourceHandles(project, clip)
  const handleFrames = (seconds: number): number =>
    seconds === Infinity ? Infinity : Math.floor((seconds * fps) / speed + EPSILON)
  if (edge === 'start') {
    const previous = track.clips[index - 1]
    return [
      Math.max(previous ? clipEnd(previous) : 0, clip.start - handleFrames(handles.head)),
      clipEnd(clip) - 1
    ]
  }
  const following = track.clips[index + 1]
  return [
    clip.start + 1,
    Math.min(following ? following.start : Infinity, clipEnd(clip) + handleFrames(handles.tail))
  ]
}

/** Trims an edge to `frame`, clamped by `trimRange`. Returns the frame used. */
export function trimClip(project: Project, clipId: Id, edge: 'start' | 'end', frame: number): number | null {
  const found = findClip(project, clipId)
  const range = trimRange(project, clipId, edge)
  if (!found || !range || found.track.locked) return null
  const { clip, track } = found
  const { fps } = project.settings
  const next = Math.max(range[0], Math.min(frame, range[1]))
  if (edge === 'start') {
    const speed = 'speed' in clip ? clip.speed : 1
    const delta = next - clip.start
    if ('sourceIn' in clip) clip.sourceIn = Math.max(0, clip.sourceIn + (delta / fps) * speed)
    clip.duration -= delta
    clip.start = next
    // Keyframes are clip-relative; keep them at the same timeline position.
    for (const anim of animatablesOf(clip)) shiftKeyframes(anim, -delta)
  } else {
    clip.duration = next - clip.start
  }
  clampFades(clip)
  normalizeTrack(track)
  return next
}

/**
 * Trims a clip together with the linked clips whose same edge lines up with it, so a video and its
 * audio stay in sync. The group stops where its most constrained member has to stop.
 */
export function trimLinked(
  project: Project,
  clipId: Id,
  edge: 'start' | 'end',
  frame: number
): number | null {
  const found = findClip(project, clipId)
  if (!found || found.track.locked) return null
  const edgeOf = (clip: Clip): number => (edge === 'start' ? clip.start : clipEnd(clip))
  const origin = edgeOf(found.clip)
  const group = [
    found.clip,
    ...linkedPartners(project, clipId).filter(
      (c) => edgeOf(c) === origin && !findClip(project, c.id)!.track.locked
    )
  ]
  let [min, max] = [-Infinity, Infinity]
  for (const clip of group) {
    const range = trimRange(project, clip.id, edge)!
    min = Math.max(min, range[0])
    max = Math.min(max, range[1])
  }
  const target = Math.max(min, Math.min(frame, max))
  let result: number | null = null
  for (const clip of group) {
    const used = trimClip(project, clip.id, edge, target)
    if (clip.id === clipId) result = used
  }
  return result
}

/**
 * Cuts a clip in two at a timeline frame, together with the linked clips under that frame. The right-hand
 * parts are linked to each other. Returns the id of the new right-hand clip.
 */
export function splitClip(project: Project, clipId: Id, frame: number, linked = true): Id | null {
  const partners = linked ? linkedPartners(project, clipId) : []
  const right = splitOne(project, clipId, frame)
  if (!right) return null
  const rights = [right, ...partners.flatMap((p) => splitOne(project, p.id, frame) ?? [])]
  const linkId = rights.length > 1 ? newId() : undefined
  for (const id of rights) {
    const clip = findClip(project, id)!.clip
    if (linkId) clip.linkId = linkId
    else delete clip.linkId
  }
  pruneLinks(project)
  return right
}

function splitOne(project: Project, clipId: Id, frame: number): Id | null {
  const found = findClip(project, clipId)
  if (!found || found.track.locked) return null
  const { clip, track } = found
  if (frame <= clip.start || frame >= clipEnd(clip)) return null
  const local = frame - clip.start

  const right = JSON.parse(JSON.stringify(clip)) as Clip
  right.id = newId()
  right.start = frame
  right.duration = clip.duration - local
  clip.duration = local

  if ('sourceIn' in right && 'speed' in right) right.sourceIn += (local / project.settings.fps) * right.speed
  if (isVisualClip(right)) for (const effect of right.effects) effect.id = newId()

  const leftAnims = animatablesOf(clip)
  const rightAnims = animatablesOf(right)
  leftAnims.forEach((anim, i) => {
    const target = rightAnims[i]!
    const part = splitAnimatable(anim, local)
    target.value = part.value
    if (part.keyframes) target.keyframes = part.keyframes
    else delete target.keyframes
  })

  if (isAudibleClip(clip) && isAudibleClip(right)) {
    clip.fadeOut = 0
    right.fadeIn = 0
    clampFades(clip)
    clampFades(right)
  }
  // A transition at the old out point now belongs to the right-hand part.
  for (const t of track.transitions) if (t.leftClipId === clip.id) t.leftClipId = right.id

  track.clips.push(right)
  normalizeTrack(track)
  return right.id
}

// ── Delete / duplicate ────────────────────────────────────────────────────────────────────────────

/** Deletes clips. With `ripple`, later clips on the same track close the gap. */
export function deleteClips(project: Project, clipIds: readonly Id[], ripple = false): void {
  const ids = new Set(clipIds)
  for (const track of project.tracks) {
    if (track.locked) continue
    const removed = track.clips.filter((c) => ids.has(c.id))
    if (removed.length === 0) continue
    track.clips = track.clips.filter((c) => !ids.has(c.id))
    if (ripple) {
      for (const clip of track.clips) {
        clip.start -= removed.filter((r) => r.start < clip.start).reduce((sum, r) => sum + r.duration, 0)
      }
    }
    normalizeTrack(track)
  }
  pruneLinks(project)
}

/** Deep-copies a clip with fresh ids, ready to be inserted elsewhere. */
export function cloneClip(clip: Clip, start = clip.start): Clip {
  const copy = JSON.parse(JSON.stringify(clip)) as Clip
  copy.id = newId()
  copy.start = start
  if (isVisualClip(copy)) for (const effect of copy.effects) effect.id = newId()
  return copy
}

/** Pastes clips so that the earliest starts at `atFrame`, keeping their relative timing. Returns the new ids. */
export function pasteClips(
  project: Project,
  clips: ReadonlyArray<{ clip: Clip; trackId?: Id }>,
  atFrame: number
): Id[] {
  if (clips.length === 0) return []
  const origin = Math.min(...clips.map((c) => c.clip.start))
  const copies = clips.map(({ clip, trackId }) => ({
    copy: cloneClip(clip, atFrame + (clip.start - origin)),
    trackId
  }))
  relinkCopies(copies.map((c) => c.copy))
  return copies.map(({ copy, trackId }) => {
    insertClipAuto(project, copy, trackId)
    return copy.id
  })
}

// ── Speed / audio ─────────────────────────────────────────────────────────────────────────────────

/**
 * Changes playback speed, keeping the same source range (so the clip gets shorter or longer). Linked clips
 * covering exactly the same span change with it, so sound stays in sync with picture.
 */
export function setClipSpeed(project: Project, clipId: Id, speed: number): void {
  const found = findClip(project, clipId)
  if (!found) return
  const { start, duration } = found.clip
  const partners = linkedPartners(project, clipId).filter((c) => c.start === start && c.duration === duration)
  for (const id of [clipId, ...partners.map((p) => p.id)]) setSpeedOne(project, id, speed)
}

function setSpeedOne(project: Project, clipId: Id, speed: number): void {
  const found = findClip(project, clipId)
  if (!found || found.track.locked || !('speed' in found.clip)) return
  const { clip, track, index } = found
  const next = Math.max(0.05, Math.min(speed, 100))
  const ratio = clip.speed / next
  const following = track.clips[index + 1]
  const room = following ? following.start - clip.start : Infinity
  const duration = Math.max(1, Math.min(Math.round(clip.duration * ratio), room))
  for (const anim of animatablesOf(clip)) {
    for (const k of anim.keyframes ?? []) k.frame = Math.round(k.frame * ratio)
  }
  clip.speed = next
  clip.duration = duration
  clampFades(clip)
  normalizeTrack(track)
}

/** Moves a video clip's sound into its own audio clip. Returns the audio clip's id. */
export function detachAudio(project: Project, clipId: Id): Id | null {
  const found = findClip(project, clipId)
  if (!found || found.clip.type !== 'video' || found.clip.audioMuted) return null
  const video = found.clip
  const audio: AudioClip = {
    id: newId(),
    type: 'audio',
    name: video.name,
    start: video.start,
    duration: video.duration,
    mediaId: video.mediaId,
    sourceIn: video.sourceIn,
    speed: video.speed,
    volume: JSON.parse(JSON.stringify(video.volume)) as AudioClip['volume'],
    fadeIn: video.fadeIn,
    fadeOut: video.fadeOut
  }
  video.audioMuted = true
  video.linkId ??= newId()
  audio.linkId = video.linkId
  insertClipAuto(project, audio)
  return audio.id
}

// ── Transitions ───────────────────────────────────────────────────────────────────────────────────

/** Adds (or replaces) the transition on the cut after `leftClipId`. Returns its id, or null if there is no cut. */
export function setTransition(project: Project, leftClipId: Id, type: string, duration: number): Id | null {
  const found = findClip(project, leftClipId)
  if (!found || found.track.locked) return null
  const { track, clip, index } = found
  const right = track.clips[index + 1]
  if (!right || right.start !== clipEnd(clip) || !isVisualClip(clip) || !isVisualClip(right)) return null
  track.transitions = track.transitions.filter((t) => t.leftClipId !== clip.id)
  const transition = {
    id: newId(),
    type,
    duration: Math.max(2, duration - (duration % 2)),
    leftClipId: clip.id,
    rightClipId: right.id
  }
  track.transitions.push(transition)
  normalizeTrack(track)
  return track.transitions.some((t) => t.id === transition.id) ? transition.id : null
}

export function removeTransition(project: Project, transitionId: Id): void {
  for (const track of project.tracks)
    track.transitions = track.transitions.filter((t) => t.id !== transitionId)
}
