import { ChevronDown, Magnet } from 'lucide-react'
import { DEFAULT_SNAP_SETTINGS } from '@core/index'
import { setSnapSettings, useEditor } from '@/store/editor'
import { Select } from '@/ui/Field'
import { IconButton } from '@/ui/IconButton'
import { Popover } from '@/ui/Popover'

const LIMITS = [
  { value: 0, label: 'No limit' },
  { value: 1, label: '1 second' },
  { value: 0.5, label: '½ second' },
  { value: 0.25, label: '¼ second' },
  { value: 0.1, label: '0.1 second' }
]
const GRIDS = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'Every second' },
  { value: 0.5, label: 'Every ½ second' },
  { value: 0.25, label: 'Every ¼ second' },
  { value: 0.1, label: 'Every 0.1 second' }
]

/** Magnet toggle plus the precision settings behind it. */
export function SnapMenu() {
  const snapping = useEditor((s) => s.snapping)
  const snap = useEditor((s) => s.snap)
  const fps = useEditor((s) => s.project.settings.fps)
  // Per-frame options depend on the project's frame rate.
  const limits = [...LIMITS, { value: 2 / fps, label: '2 frames' }]

  const check = (key: 'clipEdges' | 'playhead' | 'markers', label: string) => (
    <label className="flex h-6 items-center gap-2 text-xs">
      <input
        type="checkbox"
        className="accent-(--color-accent)"
        checked={snap[key]}
        onChange={(e) => setSnapSettings({ [key]: e.target.checked })}
      />
      {label}
    </label>
  )

  return (
    <Popover
      label="Snapping settings"
      trigger={(toggle, open) => (
        <span className="flex items-center">
          <IconButton
            label="Snapping (N)"
            active={snapping}
            onClick={() => useEditor.setState({ snapping: !snapping })}
          >
            <Magnet size={15} />
          </IconButton>
          <IconButton label="Snapping settings" active={open} className="w-4" onClick={toggle}>
            <ChevronDown size={11} />
          </IconButton>
        </span>
      )}
    >
      <div className="flex flex-col gap-2.5">
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Pull distance</span>
            <span className="font-mono text-2xs text-faint">{snap.distance} px</span>
          </div>
          <input
            type="range"
            aria-label="Snap pull distance"
            min={2}
            max={24}
            step={1}
            value={snap.distance}
            onChange={(e) => setSnapSettings({ distance: Number(e.target.value) })}
            className="w-full accent-(--color-accent)"
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-muted">Never pull over</span>
          <Select
            value={limits.find((l) => Math.abs(l.value - snap.maxSeconds) < 1e-6)?.value ?? snap.maxSeconds}
            onChange={(e) => setSnapSettings({ maxSeconds: Number(e.target.value) })}
          >
            {limits.map((l) => (
              <option key={l.label} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-muted">Time grid</span>
          <Select
            value={snap.gridSeconds}
            onChange={(e) => setSnapSettings({ gridSeconds: Number(e.target.value) })}
          >
            {GRIDS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </Select>
        </label>
        <div className="border-t border-line pt-2">
          <p className="mb-0.5 text-2xs font-semibold tracking-wider text-faint uppercase">Snap to</p>
          {check('clipEdges', 'Clip edges')}
          {check('playhead', 'Playhead')}
          {check('markers', 'Markers')}
        </div>
        <div className="flex items-center justify-between border-t border-line pt-2">
          <p className="text-2xs leading-relaxed text-faint">
            Hold Alt while dragging to ignore snapping. Zoom in for finer control: the limit never shrinks the
            pull below 3 px.
          </p>
          <button
            className="shrink-0 text-2xs text-muted hover:text-fg"
            onClick={() => setSnapSettings(DEFAULT_SNAP_SETTINGS)}
          >
            Reset
          </button>
        </div>
      </div>
    </Popover>
  )
}
