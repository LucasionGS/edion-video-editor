import { create } from 'zustand'
import type { Id } from '@core/index'

/** Dialogs opened from menus and commands; the App renders whichever one is open. */
export type DialogRequest = { kind: 'removeSilence'; clipId: Id }

export const useDialogs = create<{ open: DialogRequest | null }>(() => ({ open: null }))

export const openDialog = (request: DialogRequest): void => useDialogs.setState({ open: request })
export const closeDialog = (): void => useDialogs.setState({ open: null })
