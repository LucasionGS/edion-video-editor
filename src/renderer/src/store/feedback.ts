import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  /** Optional third button, e.g. "Don't save". */
  alternateLabel?: string
  danger?: boolean
  resolve: (answer: 'confirm' | 'alternate' | 'cancel') => void
}

interface FeedbackState {
  toasts: Toast[]
  confirm: ConfirmRequest | null
}

export const useFeedback = create<FeedbackState>(() => ({ toasts: [], confirm: null }))

let nextId = 1

export function toast(message: string, kind: Toast['kind'] = 'info'): void {
  const id = nextId++
  useFeedback.setState((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
  setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : 3500)
}

export const dismissToast = (id: number): void =>
  useFeedback.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))

export function confirm(
  request: Omit<ConfirmRequest, 'resolve'>
): Promise<'confirm' | 'alternate' | 'cancel'> {
  return new Promise((resolve) => {
    useFeedback.setState({
      confirm: {
        ...request,
        resolve: (answer) => {
          useFeedback.setState({ confirm: null })
          resolve(answer)
        }
      }
    })
  })
}
