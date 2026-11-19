import { useState } from 'react'
import { Reorder, motion, AnimatePresence } from 'framer-motion'
import { GripVertical, X, ChevronDown, ChevronUp, Upload, AlertCircle, Sparkles } from 'lucide-react'
import Badge from '../../../components/ui/Badge'
import Spinner from '../../../components/ui/Spinner'
import Button from '../../../components/ui/Button'
import Lightbox from '../../../components/ui/Lightbox'
import { SOURCE_SHORT, type FileType } from '../../../utils/posterGroups'
import { shortUrl, sourceFromUrl } from '../queueText'
import type { PatchPoster } from '../uploadPoster'
import { useScrapeStore } from '../hooks/useScrapeStore'
import type { QueueEntry } from '../hooks/useScrapeStore'
import { useEntryUploads } from '../hooks/useEntryUploads'
import EntryPosterGroups from './EntryPosterGroups'
import styles from './UrlQueueEntry.module.css'


interface Props
{
  entry: QueueEntry
  /** Artwork types shown and uploaded. */
  types: Set<FileType>
  isRunning: boolean
  patchPoster: PatchPoster
}


/** One scrape-queue row: URL, status, actions, and the expandable poster grid. */
export default function UrlQueueEntry({ entry, types, isRunning, patchPoster }: Props)
{
  const [expanded, setExpanded] = useState(false)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const removeEntry = useScrapeStore(s => s.removeEntry)
  const {
    shown, hiddenCount, doneCount, entrySetId, groups, lightboxImages, marks,
    posterCount, errorCount, hasDone, hasErrors, allDone, unappliedCount, uploadAll, uploadUnapplied,
  } = useEntryUploads(entry, types, patchPoster, expanded)

  const source = entry.posters[0]?.source ?? sourceFromUrl(entry.url) ?? 'posterdb'

  return (
    <Reorder.Item
      value={entry}
      className={styles.item}
      as="li"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      layout
    >
      {/* Row */}
      <div className={styles.row}>

        {/* drag handle */}
        <div className={styles.dragHandle} title="Drag to reorder">
          <GripVertical size={14} />
        </div>

        {/* source badge */}
        <Badge variant={source} className={styles.sourceBadge}>
          {SOURCE_SHORT[source]}
        </Badge>

        {/* URL */}
        <div className={styles.urlText} title={entry.url}>
          {shortUrl(entry.url)}
        </div>

        {/* status */}
        <div className={styles.statusArea}>
          {entry.status === 'scraping' && (
            <span className={styles.statusScraping}>
              <Spinner size="xs" />
              <span>Scraping…</span>
            </span>
          )}
          {entry.status === 'done' && posterCount > 0 && (
            <span className={styles.statusDone}>
              {posterCount} poster{posterCount !== 1 ? 's' : ''}
              {hasDone && ` · ${doneCount} uploaded`}
              {hasErrors && <span className={styles.errBit}> · {errorCount} failed</span>}
            </span>
          )}
          {entry.status === 'done' && posterCount > 0 && hiddenCount > 0 && (
            <span className={styles.statusMuted} title="Switched off in Types to apply">&nbsp;· {hiddenCount} hidden</span>
          )}
          {entry.status === 'done' && posterCount === 0 && (
            <span className={styles.statusMuted}>
              {hiddenCount > 0 ? `No posters of the types picked; ${hiddenCount} hidden` : 'No posters found'}
            </span>
          )}
          {entry.status === 'error' && (
            <span className={styles.statusError} title={entry.error}>
              <AlertCircle size={12} />
              {entry.error ? entry.error.slice(0, 60) : 'Scrape failed'}
            </span>
          )}
          {entry.status === 'idle' && (
            <span className={styles.statusMuted}>Waiting</span>
          )}
        </div>

        {/* actions */}
        <div className={styles.rowActions}>
          {entry.status === 'done' && posterCount > 0 && !allDone && unappliedCount > 0 && unappliedCount < posterCount && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Sparkles size={12} />}
              onClick={uploadUnapplied}
              disabled={isRunning}
              className={styles.uploadAllBtn}
              title="Upload only posters not already in your library (new title cards, changed art, etc.)"
            >
              Upload New ({unappliedCount})
            </Button>
          )}
          {entry.status === 'done' && posterCount > 0 && !allDone && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Upload size={12} />}
              onClick={uploadAll}
              disabled={isRunning}
              className={styles.uploadAllBtn}
            >
              Upload All
            </Button>
          )}
          {entry.status === 'done' && posterCount > 0 && (
            <button
              className={styles.expandBtn}
              onClick={() => setExpanded(v => !v)}
              title={expanded ? 'Collapse posters' : 'Show posters'}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          {!isRunning && (
            <button
              className={styles.removeBtn}
              onClick={() => removeEntry(entry.id)}
              title="Remove"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Poster grid (expanded) */}
      <AnimatePresence initial={false}>
        {expanded && shown.length > 0 && (
          <motion.div
            className={styles.posterSection}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <EntryPosterGroups
              groups={groups}
              entryId={entry.id}
              setId={entrySetId}
              patchPoster={patchPoster}
              marks={marks}
              onView={setLightbox}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lightbox !== null && (
          <Lightbox images={lightboxImages} index={lightbox} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}
