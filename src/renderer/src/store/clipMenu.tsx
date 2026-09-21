import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FlipHorizontal2,
  FlipVertical2,
  Maximize,
  Move,
  RotateCcw,
  Scaling,
  Scissors,
  SquareSplitHorizontal,
  Trash2,
  Unlink
} from 'lucide-react'
import {
  alignedPosition,
  defaultTransform,
  detachAudio,
  evaluate,
  findClip,
  frameScale,
  isVisualClip,
  setValueAt
} from '@core/index'
import type { HorizontalAlign, Id, Project, VerticalAlign, VisualClip } from '@core/index'
import { COMMANDS, formatCombo, keysFor, useShortcutState } from '@/app/shortcuts'
import { naturalSize } from '@/engine/layerSize'
import type { MenuItem } from '@/ui/ContextMenu'
import { editClips, localFrame } from './clipEdits'
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  paste,
  selectAll,
  splitAtPlayhead
} from './commands'
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
  if (detachable.length > 0) {
    items.push(
      { type: 'separator' },
      {
        label: 'Detach audio',
        icon: <Unlink size={13} />,
        onSelect: () => edit('Detach audio', (draft) => detachable.forEach((c) => detachAudio(draft, c.id)))
      }
    )
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

/** Menu for empty timeline/viewer space. */
export function emptyAreaMenuItems(): MenuItem[] {
  const { clipboard } = useEditor.getState()
  return [
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

/** Right-click rule used everywhere: a clip outside the selection becomes the selection; inside keeps the group. */
export function selectForMenu(clipId: Id): void {
  if (!useEditor.getState().selection.includes(clipId)) select([clipId])
}
