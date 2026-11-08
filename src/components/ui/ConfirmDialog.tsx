import Button from './Button'
import Modal from './Modal'
import styles from './ConfirmDialog.module.css'

interface ConfirmDialogProps {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/** Asks before an action that cannot be undone from the page; focus starts on the safe choice. */
export default function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onCancel} autoFocus>{cancelLabel}</Button>
          <Button variant="destructive" size="md" onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p className={styles.body}>{body}</p>
    </Modal>
  )
}
