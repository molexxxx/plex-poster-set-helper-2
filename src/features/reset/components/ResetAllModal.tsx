import { RotateCcw, Trash2 } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import styles from './ResetAllModal.module.css'


interface ResetAllModalProps {
  open: boolean
  onClose: () => void
  /** Items the reset covers: those the filters let through. */
  count: number
  deleteUploads: boolean
  onConfirm: () => void
}


/** Confirms a Reset All, saying how many items it covers and whether their uploads are deleted too. */
export default function ResetAllModal({ open, onClose, count, deleteUploads, onConfirm }: ResetAllModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={deleteUploads ? 'Reset & Delete All?' : 'Reset All Posters?'}
      size="sm"
    >
      <p className={styles.confirmText}>
        This will reset <strong>{count} item{count !== 1 ? 's' : ''}</strong> to
        their original Plex artwork and remove MediUX / ThePosterDB labels. This cannot be undone.
        {deleteUploads && (
          <> Uploaded poster and background images will also be <strong>deleted from your Plex server</strong>.</>
        )}
      </p>
      <div className={styles.confirmActions}>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          variant="destructive"
          size="sm"
          icon={deleteUploads ? <Trash2 size={13} /> : <RotateCcw size={13} />}
          onClick={onConfirm}
        >
          {deleteUploads ? 'Reset & Delete' : 'Reset All'}
        </Button>
      </div>
    </Modal>
  )
}
