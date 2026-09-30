import { useEffect } from 'react'
import { create } from 'zustand'
import { jumpSeconds, seek, seekToEnd, stepFrames, togglePlayback } from '@/engine/playback/session'
import {
  addMarker,
  clearRange,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  paste,
  rippleTrimToPlayhead,
  selectAll,
  setRangeEdge,
  splitAtPlayhead,
  toggleLink
} from '@/store/commands'
import { redo, select, setZoom, TOOLS, undo, useEditor } from '@/store/editor'
import { newProject, openProject, saveProject } from '@/store/projectActions'

export interface Command {
  id: string
  label: string
  group: 'Playback' | 'Editing' | 'Timeline' | 'Project'
  /** Combos are `[ctrl+][shift+][alt+]<key>`, lower-case; ctrl also matches ⌘ on macOS. */
  keys: string[]
  run(): void
}

export const COMMANDS: Command[] = [
  { id: 'play', label: 'Play / pause', group: 'Playback', keys: [' '], run: togglePlayback },
  {
    id: 'pause',
    label: 'Pause',
    group: 'Playback',
    keys: ['k'],
    run: () => useEditor.setState({ playing: false })
  },
  {
    id: 'forward',
    label: 'Play / jump forward 1 s',
    group: 'Playback',
    keys: ['l'],
    run: () => (useEditor.getState().playing ? jumpSeconds(1) : togglePlayback())
  },
  { id: 'back', label: 'Jump back 1 s', group: 'Playback', keys: ['j'], run: () => jumpSeconds(-1) },
  {
    id: 'prevFrame',
    label: 'Previous frame',
    group: 'Playback',
    keys: ['arrowleft'],
    run: () => stepFrames(-1)
  },
  { id: 'nextFrame', label: 'Next frame', group: 'Playback', keys: ['arrowright'], run: () => stepFrames(1) },
  {
    id: 'prev10',
    label: 'Back 10 frames',
    group: 'Playback',
    keys: ['shift+arrowleft'],
    run: () => stepFrames(-10)
  },
  {
    id: 'next10',
    label: 'Forward 10 frames',
    group: 'Playback',
    keys: ['shift+arrowright'],
    run: () => stepFrames(10)
  },
  { id: 'start', label: 'Go to start', group: 'Playback', keys: ['home'], run: () => seek(0) },
  { id: 'end', label: 'Go to end', group: 'Playback', keys: ['end'], run: seekToEnd },

  { id: 'split', label: 'Split at playhead', group: 'Editing', keys: ['s', 'ctrl+b'], run: splitAtPlayhead },
  {
    id: 'delete',
    label: 'Delete',
    group: 'Editing',
    keys: ['delete', 'backspace'],
    run: () => deleteSelection()
  },
  {
    id: 'rippleDelete',
    label: 'Ripple delete',
    group: 'Editing',
    keys: ['shift+delete'],
    run: () => deleteSelection(true)
  },
  { id: 'undo', label: 'Undo', group: 'Editing', keys: ['ctrl+z'], run: undo },
  { id: 'redo', label: 'Redo', group: 'Editing', keys: ['ctrl+shift+z', 'ctrl+y'], run: redo },
  { id: 'copy', label: 'Copy', group: 'Editing', keys: ['ctrl+c'], run: copySelection },
  { id: 'cut', label: 'Cut', group: 'Editing', keys: ['ctrl+x'], run: cutSelection },
  { id: 'paste', label: 'Paste at playhead', group: 'Editing', keys: ['ctrl+v'], run: paste },
  { id: 'duplicate', label: 'Duplicate', group: 'Editing', keys: ['ctrl+d'], run: duplicateSelection },
  { id: 'selectAll', label: 'Select all', group: 'Editing', keys: ['ctrl+a'], run: selectAll },
  { id: 'link', label: 'Link / unlink clips', group: 'Editing', keys: ['ctrl+l'], run: toggleLink },
  {
    id: 'deselect',
    label: 'Deselect / select tool',
    group: 'Editing',
    keys: ['escape'],
    run: () => {
      select([])
      useEditor.setState({ tool: 'select' })
    }
  },

  ...TOOLS.map((tool): Command => ({
    id: tool.id === 'select' ? 'toolSelect' : tool.id === 'razor' ? 'toolRazor' : `tool:${tool.id}`,
    label: tool.label,
    group: 'Timeline',
    keys: [tool.key],
    run: () => useEditor.setState({ tool: tool.id })
  })),
  {
    id: 'rippleTrimStart',
    label: 'Ripple trim start to playhead',
    group: 'Editing',
    keys: ['q'],
    run: () => rippleTrimToPlayhead('start')
  },
  {
    id: 'rippleTrimEnd',
    label: 'Ripple trim end to playhead',
    group: 'Editing',
    keys: ['w'],
    run: () => rippleTrimToPlayhead('end')
  },
  {
    id: 'linkedSelection',
    label: 'Toggle linked selection',
    group: 'Timeline',
    keys: ['shift+l'],
    run: () => useEditor.setState((s) => ({ linkedSelection: !s.linkedSelection }))
  },
  {
    id: 'snapping',
    label: 'Toggle snapping',
    group: 'Timeline',
    keys: ['n'],
    run: () => useEditor.setState((s) => ({ snapping: !s.snapping }))
  },
  { id: 'marker', label: 'Add / remove marker', group: 'Timeline', keys: ['m'], run: addMarker },
  { id: 'rangeIn', label: 'Set in point', group: 'Timeline', keys: ['i'], run: () => setRangeEdge('in') },
  { id: 'rangeOut', label: 'Set out point', group: 'Timeline', keys: ['o'], run: () => setRangeEdge('out') },
  { id: 'rangeClear', label: 'Clear in / out', group: 'Timeline', keys: ['alt+x'], run: clearRange },
  {
    id: 'zoomIn',
    label: 'Zoom in',
    group: 'Timeline',
    keys: ['=', '+'],
    run: () => setZoom(useEditor.getState().zoom * 1.4)
  },
  {
    id: 'zoomOut',
    label: 'Zoom out',
    group: 'Timeline',
    keys: ['-'],
    run: () => setZoom(useEditor.getState().zoom / 1.4)
  },

  { id: 'save', label: 'Save', group: 'Project', keys: ['ctrl+s'], run: () => void saveProject() },
  {
    id: 'saveAs',
    label: 'Save as…',
    group: 'Project',
    keys: ['ctrl+shift+s'],
    run: () => void saveProject(true)
  },
  { id: 'open', label: 'Open…', group: 'Project', keys: ['ctrl+o'], run: () => void openProject() },
  { id: 'new', label: 'New project', group: 'Project', keys: ['ctrl+n'], run: () => void newProject() },
  // Bound by the App, which owns the dialog.
  {
    id: 'export',
    label: 'Export…',
    group: 'Project',
    keys: ['ctrl+e'],
    run: () => useShortcutState.getState().onExport?.()
  }
]

/** User overrides (from the settings file) and the export hook. */
export const useShortcutState = create<{
  overrides: Record<string, string[]>
  onExport: (() => void) | null
}>(() => ({
  overrides: {},
  onExport: null
}))

export const keysFor = (command: Command, overrides: Record<string, string[]>): string[] =>
  overrides[command.id] ?? command.keys

export function comboOf(e: KeyboardEvent): string {
  return `${e.ctrlKey || e.metaKey ? 'ctrl+' : ''}${e.shiftKey ? 'shift+' : ''}${e.altKey ? 'alt+' : ''}${e.key.toLowerCase()}`
}

/** Human-readable form of a combo, e.g. `ctrl+shift+z` → `Ctrl + Shift + Z`. */
export function formatCombo(combo: string): string {
  const names: Record<string, string> = {
    ' ': 'Space',
    arrowleft: '←',
    arrowright: '→',
    arrowup: '↑',
    arrowdown: '↓',
    escape: 'Esc',
    delete: 'Del'
  }
  return combo
    .split(/\+(?!$)/)
    .map(
      (part) =>
        names[part] ?? (part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1))
    )
    .join(' + ')
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function useShortcuts(onExport: () => void): void {
  useEffect(() => {
    useShortcutState.setState({ onExport })
    void window.edion.settings.get().then((s) => useShortcutState.setState({ overrides: s.shortcuts ?? {} }))
  }, [onExport])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const combo = comboOf(e)
      // Text fields keep plain typing and the native clipboard/undo keys.
      if (isTyping(e.target) && (!combo.startsWith('ctrl+') || /^ctrl\+[zycxva]$/.test(combo))) return
      const { overrides } = useShortcutState.getState()
      const command = COMMANDS.find((c) => keysFor(c, overrides).includes(combo))
      if (!command) return
      e.preventDefault()
      command.run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
