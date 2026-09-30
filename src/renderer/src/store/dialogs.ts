import { create } from 'zustand'
import type { Draft } from 'immer'
import type { Animatable, AnimValue, Clip, Id } from '@core/index'

/** Dialogs opened from menus and commands; the App renders whichever one is open. */
export type DialogRequest =
  | { kind: 'removeSilence'; clipId: Id }
  | {
      kind: 'curve'
      clipId: Id
      label: string
      get: (clip: Clip | Draft<Clip>) => Animatable<AnimValue> | undefined
    }
  | {
      kind: 'prompt'
      title: string
      label: string
      initial: string
      confirmLabel: string
      onSubmit: (value: string) => void
    }

export const useDialogs = create<{ open: DialogRequest | null }>(() => ({ open: null }))

export const openDialog = (request: DialogRequest): void => useDialogs.setState({ open: request })
export const closeDialog = (): void => useDialogs.setState({ open: null })

/** Asks for a line of text (a name, usually). */
export const promptText = (request: Omit<Extract<DialogRequest, { kind: 'prompt' }>, 'kind'>): void =>
  openDialog({ kind: 'prompt', ...request })
