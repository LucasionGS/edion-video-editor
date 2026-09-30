import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AudioLines,
  AudioWaveform,
  BetweenHorizontalStart,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FlipHorizontal2,
  FlipVertical2,
  Gauge,
  Link2,
  Maximize,
  Move,
  Pause,
  Rewind,
  RotateCcw,
  Scaling,
  Scissors,
  SquareSplitHorizontal,
  Trash2,
  Unlink
} from 'lucide-react'
import {
  alignedPosition,
  closeAllGaps,
  defaultTransform,
  detachAudio,
  evaluate,
  findClip,
  frameScale,
  gapAt,
  isAudibleClip,
  isVisualClip,
  setReversed,
  setValueAt
} from '@core/index'
import type { HorizontalAlign, Id, Project, VerticalAlign, VisualClip } from '@core/index'
import { COMMANDS, formatCombo, keysFor, useShortcutState } from '@/app/shortcuts'
import { naturalSize } from '@/engine/layerSize'
import type { MenuItem } from '@/ui/ContextMenu'
import { editClips, localFrame } from './clipEdits'
import {
  closeGapAt,
  copySelection,
  FRAME_HOLD_SECONDS,
  insertHoldAtPlayhead,
  normalizeLoudness,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  paste,
  selectAll,
  splitAtPlayhead,
  toggleLink
} from './commands'
import { openDialog } from './dialogs'
import { edit, select, useEditor } from './editor'

const shortcut = (id: string): string | undefined => {
  const command = COMMANDS.find((c) => c.id === id)
  const combo = command && keysFor(command, useShortcutState.getState().overrides)[0]
  return combo ? formatCombo(combo) : undefined
}

function selectedVisualIds(): Id[] {
  const { project, selection } = useEditor.getState()
  return selection.filter((id) => {
    const found = findClip(project, id)
    return found && isVisualClip(found.clip)
  })
}

/** Runs `change` on every selected visual clip, writing through keyframes at the playhead when animated. */
function transformSelection(
  label: string,
  change: (clip: VisualClip, frame: number, project: Project) => void
): void {
  editClips(selectedVisualIds(), label, (clip, project) => {
    if (isVisualClip(clip)) change(clip, localFrame(clip), project as Project)
  })
}

function setScale(label: string, scaleFor: (clip: VisualClip, project: Project) => number): void {
  transformSelection(label, (clip, frame, project) => {
    const [sx, sy] = evaluate(clip.transform.scale, frame)
    const s = scaleFor(clip, project)
    // Keep flips: only the magnitude is a preset.
    setValueAt(clip.transform.scale, frame, [Math.sign(sx || 1) * s, Math.sign(sy || 1) * s])
  })
}

function fitToFrame(mode: 'fit' | 'fill'): void {
  transformSelection(mode === 'fit' ? 'Fit to frame' : 'Fill frame', (clip, frame, project) => {
    const [sx, sy] = evaluate(clip.transform.scale, frame)
    const crop = 'crop' in clip ? clip.crop : undefined
    const size = naturalSize(project, clip)
    const s = frameScale(size, project.settings, mode, crop)
    const scale: [number, number] = [Math.sign(sx || 1) * s, Math.sign(sy || 1) * s]
    setValueAt(clip.transform.scale, frame, scale)
    setValueAt(clip.transform.rotation, frame, 0)
    const placement = { size, scale, rotation: 0, anchor: clip.transform.anchor, crop }
    setValueAt(
      clip.transform.position,
      frame,
      alignedPosition(placement, [0, 0], project.settings, 'center', 'center')
    )
  })
}

function align(label: string, horizontal: HorizontalAlign | null, vertical: VerticalAlign | null): void {
  transformSelection(label, (clip, frame, project) => {
    const placement = {
      size: naturalSize(project, clip),
      scale: evaluate(clip.transform.scale, frame),
      rotation: evaluate(clip.transform.rotation, frame),
      anchor: clip.transform.anchor,
      crop: 'crop' in clip ? clip.crop : undefined
    }
    const current = evaluate(clip.transform.position, frame)
    setValueAt(
      clip.transform.position,
      frame,
      alignedPosition(placement, current, project.settings, horizontal, vertical)
    )
  })
}

function flip(axis: 0 | 1): void {
  transformSelection(axis === 0 ? 'Flip horizontally' : 'Flip vertically', (clip, frame) => {
    const scale = evaluate(clip.transform.scale, frame)
    const next: [number, number] = [scale[0], scale[1]]
    next[axis] = -next[axis]
    setValueAt(clip.transform.scale, frame, next)
  })
}

const SCALE_PRESETS = [25, 50, 75, 100, 150, 200]
const POSITIONS: Array<[string, HorizontalAlign, VerticalAlign] | null> = [
  ['Top left', 'left', 'top'],
  ['Top', 'center', 'top'],
  ['Top right', 'right', 'top'],
  null,
  ['Left', 'left', 'center'],
  ['Right', 'right', 'center'],
  null,
  ['Bottom left', 'left', 'bottom'],
  ['Bottom', 'center', 'bottom'],
  ['Bottom right', 'right', 'bottom']
]

/** Menu for the current selection (the caller selects the right-clicked clip first). */
export function clipMenuItems(): MenuItem[] {
  const { project, selection, clipboard, playhead } = useEditor.getState()
  const clips = selection.flatMap((id) => findClip(project, id)?.clip ?? [])
  if (clips.length === 0) return emptyAreaMenuItems()
  const visual = clips.some(isVisualClip)
  const underPlayhead = clips.some((c) => playhead > c.start && playhead < c.start + c.duration)
  const detachable = clips.filter((c) => c.type === 'video' && !c.audioMuted)
  const count = clips.length > 1 ? ` ${clips.length} clips` : ''

  const items: MenuItem[] = [
    { label: 'Cut', icon: <Scissors size={13} />, shortcut: shortcut('cut'), onSelect: cutSelection },
    { label: 'Copy', icon: <Copy size={13} />, shortcut: shortcut('copy'), onSelect: copySelection },
    {
      label: 'Paste at playhead',
      icon: <ClipboardPaste size={13} />,
      shortcut: shortcut('paste'),
      disabled: clipboard.length === 0,
      onSelect: paste
    },
    {
      label: 'Duplicate',
      icon: <CopyPlus size={13} />,
      shortcut: shortcut('duplicate'),
      onSelect: duplicateSelection
    },
    { type: 'separator' },
    {
      label: 'Split at playhead',
      icon: <SquareSplitHorizontal size={13} />,
      shortcut: shortcut('split'),
      disabled: !underPlayhead,
      onSelect: splitAtPlayhead
    }
  ]
  if (visual) {
    items.push(
      { type: 'separator' },
      { label: 'Fit to frame', icon: <Maximize size={13} />, onSelect: () => fitToFrame('fit') },
      { label: 'Fill frame', onSelect: () => fitToFrame('fill') },
      {
        type: 'submenu',
        label: 'Scale',
        icon: <Scaling size={13} />,
        items: SCALE_PRESETS.map((percent) => ({
          label: `${percent}%`,
          onSelect: () => setScale(`Scale to ${percent}%`, () => percent / 100)
        }))
      },
      {
        type: 'submenu',
        label: 'Position',
        icon: <Move size={13} />,
        items: [
          { label: 'Center', onSelect: () => align('Center', 'center', 'center') },
          {
            label: 'Center horizontally',
            icon: <AlignCenterHorizontal size={13} />,
            onSelect: () => align('Center horizontally', 'center', null)
          },
          {
            label: 'Center vertically',
            icon: <AlignCenterVertical size={13} />,
            onSelect: () => align('Center vertically', null, 'center')
          },
          { type: 'separator' },
          ...POSITIONS.map((p): MenuItem =>
            p
              ? { label: p[0], onSelect: () => align(`Move to ${p[0].toLowerCase()}`, p[1], p[2]) }
              : { type: 'separator' }
          )
        ]
      },
      {
        type: 'submenu',
        label: 'Flip',
        icon: <FlipHorizontal2 size={13} />,
        items: [
          { label: 'Horizontally', icon: <FlipHorizontal2 size={13} />, onSelect: () => flip(0) },
          { label: 'Vertically', icon: <FlipVertical2 size={13} />, onSelect: () => flip(1) }
        ]
      },
      {
        label: 'Reset transform',
        icon: <RotateCcw size={13} />,
        onSelect: () =>
          editClips(
            selectedVisualIds(),
            'Reset transform',
            (c) => isVisualClip(c) && void (c.transform = defaultTransform())
          )
      }
    )
  }
  const timed = clips.filter(
    (c): c is Extract<typeof c, { sourceIn: number }> => 'sourceIn' in c && !(c.type === 'video' && c.hold)
  )
  const holdTarget = clips.length === 1 && clips[0]!.type === 'video' && !clips[0]!.hold && underPlayhead
  if (timed.length > 0) {
    const reverse = !timed.every((c) => c.reversed)
    items.push(
      { type: 'separator' },
      {
        label: reverse ? 'Reverse' : 'Play forward',
        icon: <Rewind size={13} />,
        onSelect: () =>
          edit(reverse ? 'Reverse clip' : 'Play forward', (draft) =>
            timed.forEach((c) => setReversed(draft, c.id, reverse))
          )
      }
    )
  }
  const audible = clips.filter((c) => isAudibleClip(c) && !(c.type === 'video' && (c.audioMuted || c.hold)))
  if (audible.length > 0) {
    items.push({
      label: 'Normalize loudness',
      icon: <Gauge size={13} />,
      onSelect: () => void normalizeLoudness(audible.map((c) => c.id))
    })
  }
  const only = clips.length === 1 ? clips[0]! : undefined
  const silenceTarget = only && 'sourceIn' in only && !(only.type === 'video' && only.hold) ? only : undefined
  if (silenceTarget) {
    items.push({
      label: 'Remove silence…',
      icon: <AudioWaveform size={13} />,
      onSelect: () => openDialog({ kind: 'removeSilence', clipId: silenceTarget.id })
    })
  }
  if (holdTarget) {
    items.push({
      label: `Insert frame hold (${FRAME_HOLD_SECONDS} s)`,
      icon: <Pause size={13} />,
      onSelect: () => insertHoldAtPlayhead(clips[0]!.id)
    })
  }
  const linkId = clips[0]!.linkId
  const oneGroup = linkId !== undefined && clips.every((c) => c.linkId === linkId)
  items.push({ type: 'separator' })
  if (detachable.length > 0) {
    items.push({
      label: 'Detach audio',
      icon: <AudioLines size={13} />,
      onSelect: () => edit('Detach audio', (draft) => detachable.forEach((c) => detachAudio(draft, c.id)))
    })
  }
  if (clips.some((c) => c.linkId)) {
    items.push({
      label: 'Unlink',
      icon: <Unlink size={13} />,
      shortcut: shortcut('link'),
      onSelect: toggleLink
    })
  }
  if (clips.length > 1 && !oneGroup) {
    items.push({ label: 'Link', icon: <Link2 size={13} />, shortcut: shortcut('link'), onSelect: toggleLink })
  }
  items.push(
    { type: 'separator' },
    {
      label: `Delete${count}`,
      icon: <Trash2 size={13} />,
      shortcut: shortcut('delete'),
      danger: true,
      onSelect: () => deleteSelection(false)
    },
    {
      label: 'Ripple delete',
      shortcut: shortcut('rippleDelete'),
      danger: true,
      onSelect: () => deleteSelection(true)
    }
  )
  return items
}

/** Menu for empty timeline/viewer space; `trackId`/`frame` locate a click on a timeline lane. */
export function emptyAreaMenuItems(trackId?: Id, frame?: number): MenuItem[] {
  const { clipboard, project } = useEditor.getState()
  const track = trackId ? project.tracks.find((t) => t.id === trackId) : undefined
  const gap = track && frame !== undefined && !track.locked ? gapAt(track, frame) : null
  return [
    ...(gap && track
      ? [
          {
            label: `Close gap (${formatFrames(gap.end - gap.start, project.settings.fps)})`,
            icon: <BetweenHorizontalStart size={13} />,
            onSelect: () => closeGapAt(track.id, frame!)
          },
          {
            label: 'Close all gaps on this track',
            onSelect: () => edit('Close gaps', (draft) => closeAllGaps(draft, track.id))
          },
          { type: 'separator' as const }
        ]
      : []),
    {
      label: 'Paste at playhead',
      icon: <ClipboardPaste size={13} />,
      shortcut: shortcut('paste'),
      disabled: clipboard.length === 0,
      onSelect: paste
    },
    { label: 'Select all', shortcut: shortcut('selectAll'), onSelect: selectAll },
    {
      label: 'Split all at playhead',
      icon: <SquareSplitHorizontal size={13} />,
      onSelect: () => (select([]), splitAtPlayhead())
    }
  ]
}

const formatFrames = (frames: number, fps: number): string => `${(frames / fps).toFixed(2)} s`

/** Right-click rule used everywhere: a clip outside the selection becomes the selection; inside keeps the group. */
export function selectForMenu(clipId: Id): void {
  if (!useEditor.getState().selection.includes(clipId)) select([clipId])
}
