import { create } from 'zustand'
import { newId } from '@core/index'
import type { Effect } from '@core/index'
import type { EffectPreset } from '@shared/ipc'
import { toast } from './feedback'

/** Saved effect stacks, kept in the settings file so they are available in every project. */
export const usePresets = create<{ effects: EffectPreset[] }>(() => ({ effects: [] }))

export async function loadPresets(): Promise<void> {
  const settings = await window.edion.settings.get()
  usePresets.setState({ effects: settings.effectPresets ?? [] })
}

async function store(effects: EffectPreset[]): Promise<void> {
  usePresets.setState({ effects })
  await window.edion.settings.update({ effectPresets: effects })
}

/** Saves (or replaces, by name) a preset of the given effects. */
export async function saveEffectPreset(name: string, effects: readonly Effect[]): Promise<void> {
  const preset: EffectPreset = {
    name,
    effects: effects.map(({ type, enabled, params, resource }) => ({
      type,
      enabled,
      params: JSON.parse(JSON.stringify(params)) as Record<string, unknown>,
      ...(resource ? { resource } : {})
    }))
  }
  await store([...usePresets.getState().effects.filter((p) => p.name !== name), preset])
  toast(`Saved preset “${name}”.`, 'success')
}

export const deleteEffectPreset = (name: string): Promise<void> =>
  store(usePresets.getState().effects.filter((p) => p.name !== name))

/** Fresh copies of a preset's effects, ready to append to a clip. */
export const presetEffects = (preset: EffectPreset): Effect[] =>
  preset.effects.map((e) => ({ ...(JSON.parse(JSON.stringify(e)) as Omit<Effect, 'id'>), id: newId() }))
