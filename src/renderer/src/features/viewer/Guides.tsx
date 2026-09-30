export type GuideMode = 'off' | 'safe' | 'thirds' | 'all'

export const GUIDE_MODES: ReadonlyArray<{ value: GuideMode; label: string }> = [
  { value: 'off', label: 'No guides' },
  { value: 'safe', label: 'Safe areas' },
  { value: 'thirds', label: 'Rule of thirds' },
  { value: 'all', label: 'All guides' }
]

/** Overlay lines on the picture: action-safe (93%) and title-safe (90%) boxes, thirds, and the centre. */
export function Guides({ mode }: { mode: GuideMode }) {
  if (mode === 'off') return null
  const safe = mode === 'safe' || mode === 'all'
  const thirds = mode === 'thirds' || mode === 'all'
  const box = (percent: number) => {
    const inset = (100 - percent) / 2
    return <rect x={`${inset}%`} y={`${inset}%`} width={`${percent}%`} height={`${percent}%`} />
  }
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
      <g fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1} vectorEffect="non-scaling-stroke">
        {safe && (
          <>
            {box(93)}
            <g strokeDasharray="4 3">{box(90)}</g>
            <svg x="50%" y="50%" overflow="visible">
              <path d="M -8 0 L 8 0 M 0 -8 L 0 8" />
            </svg>
          </>
        )}
        {thirds && (
          <g stroke="rgba(255,255,255,0.35)">
            {[33.333, 66.667].map((p) => (
              <g key={p}>
                <line x1={`${p}%`} x2={`${p}%`} y1="0" y2="100%" />
                <line y1={`${p}%`} y2={`${p}%`} x1="0" x2="100%" />
              </g>
            ))}
          </g>
        )}
      </g>
    </svg>
  )
}
