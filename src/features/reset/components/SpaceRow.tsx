import { AlertTriangle, CheckCircle2, HardDrive } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Spinner from '../../../components/ui/Spinner'
import Switch from '../../../components/ui/Switch'
import type { CleanBundles } from '../hooks/useCleanBundles'
import styles from './SpaceRow.module.css'


interface SpaceRowProps
{
  /** Anything is tracked, so the delete toggle has something to act on. */
  hasItems: boolean
  plexConnected: boolean
  deleteUploads: boolean
  onDeleteUploadsChange: (on: boolean) => void
  running: boolean
  clean: CleanBundles
}


/** Disk space: the toggle to delete uploaded images on reset, and Plex's Clean Bundles task. */
export default function SpaceRow({ hasItems, plexConnected, deleteUploads, onDeleteUploadsChange, running, clean }: SpaceRowProps)
{
  const { cleanState, cleanBusy, cleanLabel, cleanBundles } = clean

  return (
    <div className={`${styles.spaceRow} ${deleteUploads && hasItems ? styles.spaceRowArmed : ''}`}>
      {hasItems ? (
        <Switch
          checked={deleteUploads}
          onChange={onDeleteUploadsChange}
          disabled={running}
          label="Delete uploaded images"
          description="On reset, also remove the poster & background files from your Plex server to free space"
        />
      ) : (
        <div className={styles.spaceHint}>
          <HardDrive size={15} className={styles.spaceHintIcon} />
          <div className={styles.spaceHintText}>
            <span className={styles.spaceHintTitle}>Reclaim disk space</span>
            <span className={styles.spaceHintSub}>Clear unused poster &amp; art data left on your Plex server</span>
          </div>
        </div>
      )}
      <div className={styles.spaceActions}>
        {cleanState === 'cleaning' && (
          <span className={styles.spaceNote}>Reclaiming space…</span>
        )}
        {cleanState === 'done' && (
          <span className={`${styles.spaceNote} ${styles.spaceNoteOk}`}>Space reclaimed</span>
        )}
        {cleanState === 'error' && (
          <span className={`${styles.spaceNote} ${styles.spaceNoteErr}`}>Could not start the task</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={
            cleanState === 'error' ? <AlertTriangle size={13} />
            : cleanState === 'done' ? <CheckCircle2 size={13} />
            : cleanBusy ? <Spinner size="xs" color="current" />
            : <HardDrive size={13} />
          }
          onClick={cleanBundles}
          disabled={cleanBusy || !plexConnected}
          title="Run Plex's Clean Bundles task to reclaim disk space from deleted images"
        >
          {cleanLabel}
        </Button>
      </div>
    </div>
  )
}
