import { useEffect } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { dismissToast, useFeedback } from '@/store/feedback'
import { Button } from './Button'

const icons = {
  info: <Info size={14} className="text-accent" />,
  success: <CheckCircle2 size={14} className="text-ok" />,
  error: <AlertCircle size={14} className="text-danger" />
}

export function Toasts() {
  const toasts = useFeedback((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2" role="status">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2.5 text-xs shadow-xl shadow-black/40"
        >
          <span className="mt-px shrink-0">{icons[t.kind]}</span>
          <span className="min-w-0 flex-1 leading-relaxed break-words select-text">{t.message}</span>
          <button
            className="text-faint hover:text-fg"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function ConfirmDialog() {
  const request = useFeedback((s) => s.confirm)
  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') request.resolve('cancel')
      if (e.key === 'Enter') request.resolve('confirm')
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [request])
  if (!request) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal>
      <div className="w-96 rounded-xl border border-line bg-surface p-5 shadow-2xl shadow-black/60">
        <h2 className="text-sm font-semibold">{request.title}</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">{request.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          {request.alternateLabel && (
            <Button className="mr-auto" onClick={() => request.resolve('alternate')}>
              {request.alternateLabel}
            </Button>
          )}
          <Button onClick={() => request.resolve('cancel')}>Cancel</Button>
          <Button
            variant="primary"
            className={request.danger ? 'bg-danger hover:bg-danger/80' : ''}
            onClick={() => request.resolve('confirm')}
            autoFocus
          >
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
