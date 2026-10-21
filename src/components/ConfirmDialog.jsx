import { useEffect, useRef } from 'react'

export default function ConfirmDialog({
  open,
  title,
  description,
  children,
  cancelLabel = 'Voltar',
  confirmLabel,
  busy = false,
  error,
  onCancel,
  onConfirm,
}) {
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      cancelRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  function handleCancel(event) {
    if (busy) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    onCancel()
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      onCancel={handleCancel}
    >
      <div className="stack">
        <h2 id="confirm-dialog-title">{title}</h2>
        {description && <p className="muted">{description}</p>}
        {children && <div className="confirm-dialog-content">{children}</div>}
        {error && <div className="notice" data-tone="error" role="alert">{error}</div>}
        <div className="confirm-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-quiet"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Aguarde…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
