/** Colour swatch + alpha. Colours are stored as #rrggbb or #rrggbbaa. */
export function ColorInput({
  value,
  onChange,
  label,
  alpha = false
}: {
  value: string
  onChange(value: string): void
  label: string
  alpha?: boolean
}) {
  const rgb = value.slice(0, 7)
  const a = value.length >= 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1
  const compose = (nextRgb: string, nextAlpha: number): string =>
    alpha && nextAlpha < 1
      ? `${nextRgb}${Math.round(nextAlpha * 255)
          .toString(16)
          .padStart(2, '0')}`
      : nextRgb
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={rgb}
        onChange={(e) => onChange(compose(e.target.value, a))}
        className="h-7 w-9 shrink-0 cursor-pointer rounded-md border border-line bg-raised p-0.5"
      />
      {alpha ? (
        <input
          type="range"
          aria-label={`${label} opacity`}
          title="Opacity"
          min={0}
          max={1}
          step={0.01}
          value={a}
          onChange={(e) => onChange(compose(rgb, Number(e.target.value)))}
          className="min-w-0 flex-1 accent-(--color-accent)"
        />
      ) : (
        <span className="font-mono text-2xs text-faint uppercase">{rgb}</span>
      )}
    </span>
  )
}
