import {
  applyGain,
  applyTextLook,
  audioOffset,
  breakApart,
  clipAtFrame,
  collectAudioSources,
  createCompound,
  duckClip,
  invertRanges,
  sourceRangesToLocal,
  splitAtSourceTimes,
  syncClip,
  cloneClip,
  closeGap,
  DEFAULT_TRANSITION_SECONDS,
  deleteClips,
  findClip,
  findMedia,
  isAudibleClip,
  normalizationGain,
  nudgeClips,
  relinkCopies,
  insertClipAuto,
  insertFrameHold,
  insertEdit,
  linkClips,
  pasteClips,
  removeTransition,
  rippleTrim,
  sourceSpan,
  setTransition,
  splitClip,
  unlinkClips,
  withLinked
} from '@core/index'
import type { Clip, Id, ProjectSettings, TextLook } from '@core/index'
import { editClips } from './clipEdits'
import { edit, editTargets, select, selectTransition, useEditor } from './editor'
import { toast } from './feedback'

/** User-level commands shared by buttons, menus and keyboard shortcuts. */

const state = useEditor.getState

/** Splits the selected clips under the playhead, or every unlocked clip under it when nothing is selected. */
export function splitAtPlayhead(): void {
  const { project, playhead, selection, linkedSelection } = state()
  const targets: Id[] = selection.length
    ? selection
    : project.tracks.flatMap((t) => (t.locked ? [] : (clipAtFrame(t, playhead)?.id ?? [])))
  edit('Split clips', (draft) => {
    for (const id of targets) splitClip(draft, id, playhead, linkedSelection)
  })
}

/**
 * Q / W: ripple-trims the clips under the playhead so they start (or end) there, closing the gap. Works on
 * the selected clips when there are any, otherwise on every unlocked track.
 */
export function rippleTrimToPlayhead(edge: 'start' | 'end'): void {
  const { project, playhead, selection, linkedSelection } = state()
  const under = project.tracks.flatMap((t) => {
    const clip = t.locked ? undefined : clipAtFrame(t, playhead)
    return clip && playhead > clip.start ? [clip.id] : []
  })
  const targets = selection.length ? under.filter((id) => selection.includes(id)) : under
  if (targets.length === 0) return
  let jumpTo: number | null = null
  edit(edge === 'start' ? 'Ripple trim start' : 'Ripple trim end', (draft) => {
    const done = new Set<Id>()
    for (const id of targets) {
      // A linked partner was already trimmed together with its clip.
      if (done.has(id)) continue
      for (const linked of linkedSelection ? withLinked(draft, [id]) : [id]) done.add(linked)
      const start = findClip(draft, id)?.clip.start ?? playhead
      rippleTrim(draft, id, edge, playhead, linkedSelection)
      if (edge === 'start') jumpTo = Math.min(jumpTo ?? Infinity, start)
    }
  })
  if (jumpTo !== null) useEditor.setState({ playhead: jumpTo })
}

/** Seconds a newly inserted frame hold lasts. */
export const FRAME_HOLD_SECONDS = 2

/** Inserts a frame hold at the playhead into a video clip and selects it. */
export function insertHoldAtPlayhead(clipId: Id): void {
  const { playhead, project } = state()
  const frames = Math.max(1, Math.round(FRAME_HOLD_SECONDS * project.settings.fps))
  let id: Id | null = null
  edit('Insert frame hold', (draft) => void (id = insertFrameHold(draft, clipId, playhead, frames)))
  if (id) select([id])
}

/** Removes the empty space at `frame` on a track. */
export function closeGapAt(trackId: Id, frame: number): void {
  edit('Close gap', (draft) => void closeGap(draft, trackId, frame))
}

export function deleteSelection(ripple = state().ripple): void {
  const { selection, selectedTransition } = state()
  if (selectedTransition) {
    edit('Remove transition', (draft) => removeTransition(draft, selectedTransition))
    return selectTransition(null)
  }
  if (selection.length === 0) return
  const targets = editTargets(selection)
  edit(ripple ? 'Ripple delete' : 'Delete clips', (draft) => deleteClips(draft, targets, ripple))
}

export function copySelection(): void {
  const { project, selection } = state()
  const clipboard = editTargets(selection).flatMap((id) => {
    const found = findClip(project, id)
    return found ? [{ clip: structuredClone(found.clip), trackId: found.track.id }] : []
  })
  if (clipboard.length > 0) useEditor.setState({ clipboard })
}

export function cutSelection(): void {
  copySelection()
  deleteSelection()
}

export function paste(): void {
  const { clipboard, playhead } = state()
  if (clipboard.length === 0) return
  let ids: Id[] = []
  edit('Paste', (draft) => void (ids = pasteClips(draft, clipboard, playhead)))
  select(ids)
}

/** Pastes at the playhead as an insert: everything after it moves later on all unlocked tracks. */
export function pasteInsert(): void {
  const { clipboard, playhead } = state()
  if (clipboard.length === 0) return
  let ids: Id[] = []
  edit('Paste insert', (draft) => {
    const copies = clipboard.map(({ clip, trackId }) => ({ clip: cloneClip(clip), trackId }))
    relinkCopies(copies.map((c) => c.clip))
    ids = insertEdit(draft, copies, playhead)
  })
  select(ids)
}

export function duplicateSelection(): void {
  const { project, selection } = state()
  const clips = editTargets(selection).flatMap((id) => {
    const found = findClip(project, id)
    return found ? [{ clip: found.clip, trackId: found.track.id }] : []
  })
  if (clips.length === 0) return
  const end = Math.max(...clips.map((c) => c.clip.start + c.clip.duration))
  let ids: Id[] = []
  edit('Duplicate', (draft) => void (ids = pasteClips(draft, clips, end)))
  select(ids)
}

/** Links the selected clips, or unlinks them when they already form one group. */
export function toggleLink(): void {
  const { project, selection } = state()
  if (selection.length === 0) return
  const clips = selection.flatMap((id) => findClip(project, id)?.clip ?? [])
  const linkId = clips[0]?.linkId
  const oneGroup = linkId !== undefined && clips.every((c) => c.linkId === linkId)
  if (oneGroup || clips.length === 1) edit('Unlink clips', (draft) => unlinkClips(draft, selection))
  else edit('Link clips', (draft) => void linkClips(draft, selection))
}

export function selectAll(): void {
  select(state().project.tracks.flatMap((t) => (t.locked ? [] : t.clips.map((c) => c.id))))
}

/** Marks the export range: I sets the in point, O the out point (exclusive), at the playhead. */
export function setRangeEdge(edge: 'in' | 'out'): void {
  const { project, playhead } = state()
  const end = Math.max(1, ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)))
  edit(edge === 'in' ? 'Set in point' : 'Set out point', (draft) => {
    const range = draft.range ?? { in: 0, out: end }
    if (edge === 'in') range.in = Math.min(playhead, end - 1)
    else range.out = Math.max(1, playhead)
    if (range.out <= range.in) {
      if (edge === 'in') range.out = end
      else range.in = 0
    }
    draft.range = range
  })
}

export const clearRange = (): void => edit('Clear range', (draft) => void (draft.range = null))

export function addMarker(): void {
  const { playhead } = state()
  edit('Add marker', (draft) => {
    if (draft.markers.some((m) => m.frame === playhead))
      draft.markers = draft.markers.filter((m) => m.frame !== playhead)
    else
      draft.markers.push({
        id: crypto.randomUUID().slice(0, 12),
        frame: playhead,
        label: '',
        color: '#f5c451'
      })
  })
}

// ── Titles, shapes, transitions, captions ─────────────────────────────────────────────────────────

/** Adds a generated clip (text, shape, caption) at the playhead and selects it. */
export function addGeneratedClip(
  label: string,
  make: (start: number, settings: ProjectSettings) => Clip
): void {
  const { playhead } = state()
  let id: Id | null = null
  edit(label, (draft) => {
    const clip = make(playhead, draft.settings)
    insertClipAuto(draft, clip)
    id = clip.id
  })
  if (id) select([id])
}

/**
 * Puts a transition on a cut: the one after the selected clip if it touches another clip,
 * otherwise the one before it, otherwise the cut nearest to the playhead.
 */
export function applyTransition(type: string): boolean {
  const { project, selection, playhead } = state()
  const frames = Math.max(2, Math.round(DEFAULT_TRANSITION_SECONDS * project.settings.fps))
  const candidates: Array<{ leftId: Id; distance: number }> = []
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.locked) continue
    track.clips.forEach((clip, i) => {
      const next = track.clips[i + 1]
      if (!next || next.start !== clip.start + clip.duration) return
      const selected = selection.includes(clip.id) ? 0 : selection.includes(next.id) ? 1 : 2
      candidates.push({ leftId: clip.id, distance: selected * 1e9 + Math.abs(next.start - playhead) })
    })
  }
  const best = candidates.sort((a, b) => a.distance - b.distance)[0]
  if (!best) return false
  let id: Id | null = null
  edit('Add transition', (draft) => void (id = setTransition(draft, best.leftId, type, frames)))
  if (id) selectTransition(id)
  return id !== null
}

/**
 * Measures the loudness of each clip's sound (EBU R128, through FFmpeg) and sets its volume so it lands
 * at about -14 LUFS without clipping.
 */
export async function normalizeLoudness(ids: readonly Id[]): Promise<void> {
  const { project } = state()
  const results: Array<{ id: Id; gain: number }> = []
  for (const id of ids) {
    const clip = findClip(project, id)?.clip
    if (!clip || !isAudibleClip(clip) || (clip.type === 'video' && (clip.audioMuted || clip.hold))) continue
    const media = findMedia(project, clip.mediaId)
    if (!media) continue
    const loudness = await window.edion.library.loudness(
      media.path,
      clip.sourceIn,
      sourceSpan(clip, project.settings.fps)
    )
    if (loudness) results.push({ id, gain: normalizationGain(loudness) })
  }
  if (results.length === 0) return toast('There is no sound to measure in the selection.', 'error')
  edit('Normalize loudness', (draft) => results.forEach(({ id, gain }) => applyGain(draft, id, gain)))
  const db = (gain: number): string => `${gain >= 1 ? '+' : ''}${(20 * Math.log10(gain)).toFixed(1)} dB`
  toast(
    results.length === 1
      ? `Loudness normalized (${db(results[0]!.gain)}).`
      : `Normalized ${results.length} clips.`
  )
}

/**
 * Lowers a clip (music, usually) wherever the other clips under it have sound: their pauses are found
 * with the same detector as "Remove silence", and the clip gets volume keyframes that dip around speech.
 */
export async function duckUnderSpeech(clipId: Id): Promise<void> {
  const { project } = state()
  const found = findClip(project, clipId)
  if (!found || !isAudibleClip(found.clip)) return
  const music = found.clip
  const { fps } = project.settings
  const voices = collectAudioSources(project).filter(
    ({ clip, trackId }) =>
      trackId !== found.track.id &&
      clip.start < music.start + music.duration &&
      clip.start + clip.duration > music.start
  )
  if (voices.length === 0) return toast('Nothing else plays under this clip.')
  toast('Listening for speech…')
  const speech: Array<[number, number]> = []
  for (const { clip } of voices) {
    const media = findMedia(project, clip.mediaId)
    if (!media?.hasAudio) continue
    const span = sourceSpan(clip, fps)
    const silences = await window.edion.library.silences(media.path, clip.sourceIn, span, -38, 0.35)
    const sound = invertRanges(silences, clip.sourceIn, clip.sourceIn + span)
    for (const [a, b] of sourceRangesToLocal(clip, sound, fps)) speech.push([clip.start + a, clip.start + b])
  }
  let dips = 0
  edit('Duck audio', (draft) => void (dips = duckClip(draft, clipId, speech)))
  toast(
    dips ? `Lowered the clip in ${dips} place${dips > 1 ? 's' : ''}.` : 'No speech found under this clip.',
    dips ? 'success' : 'info'
  )
}

/**
 * Cuts a video clip at every shot change FFmpeg detects in the part of the source it uses. `threshold` is
 * FFmpeg's scene score (0-1): cuts between similar-looking shots can score as low as 0.2.
 */
export async function splitAtScenes(clipId: Id, threshold = 0.3): Promise<void> {
  const { project } = state()
  const clip = findClip(project, clipId)?.clip
  if (!clip || clip.type !== 'video') return
  const media = findMedia(project, clip.mediaId)
  if (!media) return
  toast('Looking for scene changes…')
  const times = await window.edion.library.scenes(
    media.path,
    clip.sourceIn,
    sourceSpan(clip, project.settings.fps),
    threshold
  )
  let cuts = 0
  edit('Split at scene changes', (draft) => void (cuts = splitAtSourceTimes(draft, clipId, times)))
  toast(cuts ? `Split into ${cuts + 1} shots.` : 'No scene changes found.', cuts ? 'success' : 'info')
}

/** Switches the selected clips off (or back on): they stay on the timeline but are not seen or heard. */
export function toggleDisabled(): void {
  const { project, selection } = state()
  const clips = editTargets(selection).flatMap((id) => findClip(project, id)?.clip ?? [])
  if (clips.length === 0) return
  const disable = clips.some((c) => !c.disabled)
  edit(disable ? 'Disable clips' : 'Enable clips', (draft) => {
    for (const clip of clips) {
      const target = findClip(draft, clip.id)?.clip
      if (!target) continue
      if (disable) target.disabled = true
      else delete target.disabled
    }
  })
}

/** Moves the selection (with linked clips) by a few frames, if there is room. */
export function nudgeSelection(frames: number): void {
  const targets = editTargets(state().selection)
  if (targets.length > 0) edit('Nudge clips', (draft) => void nudgeClips(draft, targets, frames))
}

/** Turns the selection (with linked clips) into one compound clip. */
export function makeCompound(): void {
  const targets = editTargets(state().selection)
  if (targets.length === 0) return
  let id: Id | null = null
  edit('Create compound clip', (draft) => void (id = createCompound(draft, targets)))
  if (id) select([id])
}

/** Puts the clips of the selected compound clips back on the timeline. */
export function breakApartSelection(): void {
  const { project, selection } = state()
  const compounds = selection.filter((id) => findClip(project, id)?.clip.type === 'compound')
  if (compounds.length === 0) return
  let restored: Id[] = []
  edit('Break apart', (draft) => void (restored = compounds.flatMap((id) => breakApart(draft, id))))
  select(restored)
}

/**
 * Lines the selected clips up with the first one by their sound (e.g. a camera and a separate recorder).
 * Linked clips move along; one clip per link group is enough.
 */
export async function syncSelectionByAudio(): Promise<void> {
  const { project, selection } = state()
  const seen = new Set<Id>()
  const clips = selection.flatMap((id) => {
    const clip = findClip(project, id)?.clip
    if (!clip || !('sourceIn' in clip) || seen.has(clip.linkId ?? clip.id)) return []
    seen.add(clip.linkId ?? clip.id)
    return findMedia(project, clip.mediaId)?.hasAudio ? [clip] : []
  })
  if (clips.length < 2) return toast('Select two or more clips with sound to sync.')
  toast('Comparing the sound…')
  const peaksOf = (clip: (typeof clips)[number]) =>
    window.edion.library.peaks(findMedia(project, clip.mediaId)!.path)
  const [reference, ...others] = clips
  const base = await peaksOf(reference!)
  if (!base) return toast('Could not read the sound of the first clip.', 'error')
  const offsets: Array<{ id: Id; seconds: number; confidence: number }> = []
  for (const clip of others) {
    const peaks = await peaksOf(clip)
    if (peaks) offsets.push({ id: clip.id, ...audioOffset(base.data, peaks.data, base.perSecond) })
  }
  let moved = 0
  edit('Sync by audio', (draft) => {
    for (const { id, seconds } of offsets) if (syncClip(draft, reference!.id, id, seconds)) moved++
  })
  const weak = offsets.filter((o) => o.confidence < 0.25).length
  if (moved < offsets.length)
    toast(
      `Synced ${moved} of ${offsets.length}; the others would overlap clips or start before 0:00.`,
      'error'
    )
  else if (weak) toast(`Synced, but ${weak} match${weak > 1 ? 'es are' : ' is'} uncertain. Check by ear.`)
  else toast(`Synced ${moved} clip${moved > 1 ? 's' : ''} by audio.`, 'success')
}

/** Gives the selected text clips a saved look (their words and timing stay). */
export function applyTextStyle(look: TextLook, name: string): void {
  const { selection } = state()
  editClips(selection, `Text style: ${name}`, (clip) => {
    if (clip.type === 'text') applyTextLook(clip, look)
  })
}

/** Makes every caption use a saved look's style, and its type-on if it has one. */
export function applyStyleToCaptions(look: TextLook, name: string): void {
  edit(`Captions: ${name}`, (draft) => {
    draft.captionStyle = JSON.parse(JSON.stringify(look.style)) as typeof draft.captionStyle
    const animation = { ...draft.captionAnimation }
    if (look.reveal) animation.reveal = { ...look.reveal }
    else delete animation.reveal
    draft.captionAnimation = animation
  })
  toast(`Captions now use “${name}”.`, 'success')
}
