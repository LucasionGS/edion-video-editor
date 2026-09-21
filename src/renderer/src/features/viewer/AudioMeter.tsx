import { useEffect, useRef } from 'react'
import { getPlayer } from '@/engine/playback/session'
import { useEditor } from '@/store/editor'

/** Peak level of the master bus, in dBFS mapped to a small bar. */
export function AudioMeter() {
  const barRef = useRef<HTMLSpanElement>(null)
  const playing = useEditor((s) => s.playing)

  useEffect(() => {
    const bar = barRef.current
    const analyser = getPlayer()?.audio.analyser
    if (!bar || !analyser || !playing) {
      if (bar) bar.style.width = '0%'
      return
    }
    const samples = new Float32Array(analyser.fftSize)
    let level = 0
    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      analyser.getFloatTimeDomainData(samples)
      let peak = 0
      for (const s of samples) peak = Math.max(peak, Math.abs(s))
      // Fast attack, slow release, like a hardware meter.
      level = Math.max(peak, level * 0.92)
      const db = 20 * Math.log10(Math.max(level, 1e-4))
      bar.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`
      bar.style.background =
        db > -1 ? 'var(--color-danger)' : db > -9 ? 'var(--color-clip-text)' : 'var(--color-ok)'
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [playing])

  return (
    <span
      className="h-1.5 w-16 overflow-hidden rounded-full bg-raised"
      role="meter"
      aria-label="Output level"
      title="Output level"
    >
      <span ref={barRef} className="block h-full w-0 rounded-full" />
    </span>
  )
}
