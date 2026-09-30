import { useState } from 'react'
import { closeDialog } from '@/store/dialogs'
import { Button } from './Button'
import { Modal } from './Modal'

export function PromptDialog({
  title,
  label,
  initial,
  confirmLabel,
  onSubmit
}: {
  title: string
  label: string
  initial: string
  confirmLabel: string
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState(initial)
  const submit = (): void => {
    const text = value.trim()
    if (!text) return
    closeDialog()
    onSubmit(text)
  }
  return (
    <Modal title={title} onClose={closeDialog} width={380}>
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          {label}
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            className="h-8 rounded-md border border-line bg-bg px-2 text-xs text-fg outline-none select-text focus:border-accent"
          />
        </label>
        <div className="flex justify-end gap-1.5">
          <Button type="button" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
