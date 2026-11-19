import { motion } from 'framer-motion'
import { RotateCcw, Film, Tv2, Layers, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Spinner from '../../../components/ui/Spinner'
import { SOURCE_SHORT } from '../../../utils/posterGroups'
import { timeAgo, type TrackedItem } from '../resetText'
import type { ResetItemStatus } from '../ResetContext'
import styles from './TrackedRow.module.css'


interface TrackedRowProps {
  item: TrackedItem
  status: ResetItemStatus | 'idle'
  deleteUploads: boolean
  /** A Reset All is in progress, so single resets wait. */
  running: boolean
  onView: () => void
  onReset: () => void
}


/** One tracked item: its poster, title and where the art came from, and its Reset button or reset status. */
export default function TrackedRow({ item, status, deleteUploads, running, onView, onReset }: TrackedRowProps) {
  return (
    <motion.div
      className={[
        styles.itemRow,
        item.source === 'mediux' ? styles.rowMediux : styles.rowPosterdb,
        status === 'done' ? styles.itemDone : '',
      ].filter(Boolean).join(' ')}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24, scale: 0.97, transition: { duration: 0.22 } }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      layout
    >
      {/* thumb - click to view full size */}
      <button
        className={styles.thumb}
        onClick={onView}
        title="View poster"
        disabled={!item.thumb}
      >
        {item.thumb ? (
          <img
            src={item.thumb}
            alt={item.title}
            className={styles.thumbImg}
            loading="lazy"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className={styles.thumbFallback}>
            {item.type === 'movie' ? <Film size={14} /> : item.type === 'collection' ? <Layers size={14} /> : <Tv2 size={14} />}
          </div>
        )}
      </button>

      {/* info */}
      <div className={styles.itemInfo}>
        <span className={styles.itemTitle}>{item.title}</span>
        <div className={styles.itemMeta}>
          {item.year && <span className={styles.itemYear}>{item.year}</span>}
          <Badge variant={item.source}>{SOURCE_SHORT[item.source]}</Badge>
          <Badge variant={item.type === 'movie' ? 'movie' : 'show'}>
            {item.type === 'movie' ? 'Movie' : item.type === 'collection' ? 'Collection' : 'Show'}
          </Badge>
          <span className={styles.libraryName}>{item.libraryTitle}</span>
          {item.appliedAt && <span className={styles.appliedAt}>· applied {timeAgo(item.appliedAt)}</span>}
        </div>
      </div>

      {/* action */}
      <div className={styles.itemAction}>
        {status === 'resetting' && (
          <span className={styles.workingLabel}>
            <Spinner size="xs" /> {deleteUploads ? 'Deleting…' : 'Resetting…'}
          </span>
        )}
        {status === 'done' && (
          <span className={styles.doneLabel}>
            <CheckCircle2 size={13} /> {deleteUploads ? 'Cleared' : 'Reset'}
          </span>
        )}
        {status === 'error' && (
          <span className={styles.errorLabel}>
            <AlertTriangle size={13} /> Failed
          </span>
        )}
        {(status === 'idle' || status === 'error') && (
          <Button
            variant="ghost"
            size="sm"
            className={deleteUploads ? styles.dangerAction : undefined}
            icon={deleteUploads ? <Trash2 size={12} /> : <RotateCcw size={12} />}
            onClick={onReset}
            disabled={running}
            title={deleteUploads
              ? 'Reset to original art and delete the uploaded images from Plex'
              : 'Reset to original Plex art'}
          >
            {status === 'error' ? 'Retry' : 'Reset'}
          </Button>
        )}
      </div>
    </motion.div>
  )
}
