/** Catalogue of effects and transitions. The compositor implements them; the UI builds its controls from this. */

export interface ParamSpec {
  label: string
  min: number
  max: number
  step: number
  default: number
  unit?: string
}

export interface EffectSpec {
  type: string
  label: string
  params: Record<string, ParamSpec>
}

const unit = (label: string, def = 0): ParamSpec => ({ label, min: -1, max: 1, step: 0.01, default: def })
const amount = (label: string, def = 1, max = 1): ParamSpec => ({
  label,
  min: 0,
  max,
  step: 0.01,
  default: def
})

export const EFFECTS: readonly EffectSpec[] = [
  {
    type: 'color',
    label: 'Colour adjust',
    params: {
      exposure: unit('Exposure'),
      contrast: unit('Contrast'),
      saturation: unit('Saturation'),
      temperature: unit('Temperature'),
      tint: unit('Tint'),
      hue: { label: 'Hue', min: -180, max: 180, step: 1, default: 0, unit: '°' }
    }
  },
  {
    type: 'blur',
    label: 'Blur',
    params: { radius: { label: 'Radius', min: 0, max: 100, step: 0.5, default: 12, unit: 'px' } }
  },
  { type: 'sharpen', label: 'Sharpen', params: { amount: amount('Amount', 0.5, 2) } },
  {
    type: 'vignette',
    label: 'Vignette',
    params: { amount: amount('Amount', 0.5), softness: amount('Softness', 0.5) }
  },
  { type: 'sepia', label: 'Sepia', params: { amount: amount('Amount') } },
  { type: 'invert', label: 'Invert', params: { amount: amount('Amount') } },
  {
    type: 'pixelate',
    label: 'Pixelate',
    params: { size: { label: 'Block size', min: 1, max: 120, step: 1, default: 16, unit: 'px' } }
  },
  {
    type: 'chromaKey',
    label: 'Chroma key',
    params: {
      hue: { label: 'Key hue', min: 0, max: 360, step: 1, default: 120, unit: '°' },
      tolerance: amount('Tolerance', 0.25),
      softness: amount('Softness', 0.1),
      spill: amount('Spill removal', 0.5)
    }
  }
]

export const effectSpec = (type: string): EffectSpec | undefined => EFFECTS.find((e) => e.type === type)

export interface TransitionSpec {
  type: string
  label: string
}

/** Order matters: the index is the shader's `u_type`. */
export const TRANSITIONS: readonly TransitionSpec[] = [
  { type: 'crossfade', label: 'Cross dissolve' },
  { type: 'dipBlack', label: 'Dip to black' },
  { type: 'dipWhite', label: 'Dip to white' },
  { type: 'wipeLeft', label: 'Wipe left' },
  { type: 'wipeRight', label: 'Wipe right' },
  { type: 'wipeUp', label: 'Wipe up' },
  { type: 'wipeDown', label: 'Wipe down' },
  { type: 'slideLeft', label: 'Push left' },
  { type: 'slideRight', label: 'Push right' },
  { type: 'slideUp', label: 'Push up' },
  { type: 'slideDown', label: 'Push down' },
  { type: 'zoom', label: 'Zoom' },
  { type: 'iris', label: 'Iris' }
]

export const DEFAULT_TRANSITION_SECONDS = 0.5
