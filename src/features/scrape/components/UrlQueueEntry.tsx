import { useState, useEffect, useMemo } from 'react'
import { Reorder, motion, AnimatePresence } from 'framer-motion'
import {
  GripVertical, X, ChevronDown, ChevronUp,
  Upload, CheckCircle2, AlertCircle, Loader2, Maximize2, Library, Sparkles, BadgeCheck,
} from 'lucide-react'
import Badge from '../../../components/ui/Badge'
import Spinner from '../../../components/ui/Spinner'
import Button from '../../../components/ui/Button'
import Lightbox, { type LightboxImage } from '../../../components/ui/Lightbox'
import { groupPosters } from '../../../utils/posterGroups'
import { recordApplied, appliedKey, loadAppliedIndex, type AppliedIndex } from '../../../utils/appliedTracker'
import { useScrapeStore } from '../useScrapeStore'
import type { QueueEntry, PosterResult } from '../useScrapeStore'
import styles from './UrlQueueEntry.module.css'

// --- Props --------------------------------------------------------------------

interface Props {
  entry: QueueEntry
  isRunning: boolean
  patchPoster: (entryId: string, posterUrl: string, patch: Partial<PosterResult>) => void
}

// --- Helpers ------------------------------------------------------------------

function sourceFromUrl(url: string): 'posterdb' | 'mediux' | null {
  if (/theposterdb\.com/i.test(url)) return 'posterdb'
  if (/mediux\.pro/i.test(url)) return 'mediux'
  return null
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '') + u.pathname
  } catch {
    return url
  }
}

function posterLabel(p: PosterResult): string {
  if (p.season === 'Backdrop') return `${p.title} - Backdrop`
  if (p.season === 'Cover')    return `${p.title} - Cover`
  if (typeof p.season === 'number') return `${p.title} S${p.season}`
  if (p.episode != null)       return `${p.title} E${p.episode}`
  return p.title + (p.year ? ` (${p.year})` : '')
}

// --- Upload a single poster via Plex IPC --------------------------------------

async function uploadPoster(
  entryId: string,
  poster: PosterResult,
  patchPoster: Props['patchPoster'],
  setId?: string,
) {
  patchPoster(entryId, poster.url, { uploadStatus: 'matching' })
  try {
    const item = await window.api.plex.findItem(poster.title, poster.year)
    if (!item) {
      patchPoster(entryId, poster.url, { uploadStatus: 'no_match' })
      return
    }
    patchPoster(entryId, poster.url, { uploadStatus: 'uploading' })
    const res = await window.api.plex.uploadPoster(item.key, poster.url, poster.source, poster.season, poster.episode)
    if (res.success) {
      // Track it so it appears in Reset Posters and the "in library" marker.
      // Recording the setId keeps it interchangeable with the Library Browser.
      void recordApplied({
        itemKey: item.key,
        title: item.title,
        year: item.year,
        type: item.type === 'movie' ? 'movie' : 'show',
        source: poster.source,
        libraryTitle: item.libraryTitle,
        thumb: poster.thumbUrl ?? poster.url,
        setId,
        posterUrls: [poster.url],
        appliedAt: new Date().toISOString(),
      })
    }
    patchPoster(entryId, poster.url, {
      uploadStatus: res.success ? 'done' : 'error',
      uploadError: res.success ? undefined : res.error,
    })
  } catch (err) {
    patchPoster(entryId, poster.url, {
      uploadStatus: 'error',
      uploadError: err instanceof Error ? err.message : String(err),
    })
  }
}

// --- Poster thumbnail ---------------------------------------------------------

function PosterThumb({
  poster,
  entryId,
  patchPoster,
  onView,
  inLibrary,
  applied,
  setId,
}: {
  poster: PosterResult
  entryId: string
  patchPoster: Props['patchPoster']
  onView: () => void
  inLibrary?: boolean
  applied?: boolean
  setId?: string
}) {
  const [imgError, setImgError] = useState(false)
  const us = poster.uploadStatus

  const overlayIcon =
    us === 'matching' || us === 'uploading' ? <Loader2 size={14} className={styles.spin} /> :
    us === 'done'     ? <CheckCircle2 size={14} /> :
    us === 'error'    ? <AlertCircle size={14} /> :
    us === 'no_match' ? <AlertCircle size={14} /> :
    null

  const overlayClass =
    us === 'done'     ? styles.overlayDone :
    us === 'error' || us === 'no_match' ? styles.overlayError :
    us === 'matching' || us === 'uploading' ? styles.overlayPending :
    ''

  return (
    <div
      className={styles.thumb}
      title={posterLabel(poster)}
      onClick={() => {
        if (us === 'idle' || us === 'error' || us === 'no_match') {
          uploadPoster(entryId, poster, patchPoster, setId)
        }
      }}
    >
      {!imgError && poster.thumbUrl ? (
        <img
          src={poster.thumbUrl}
          alt={posterLabel(poster)}
          className={styles.thumbImg}
          onError={() => setImgError(true)}
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div className={styles.thumbFallback}>
          <span className={styles.thumbInitial}>
            {poster.title.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      {/* upload status overlay */}
      {overlayIcon && (
        <div className={[styles.overlay, overlayClass].filter(Boolean).join(' ')}>
          {overlayIcon}
        </div>
      )}

      {/* idle hover hint */}
      {us === 'idle' && (
        <div className={styles.overlayHover}>
          <Upload size={12} />
        </div>
      )}

      {/* applied indicator - exact poster (strong) vs same-title (soft) */}
      {applied ? (
        <div className={styles.appliedBadge} title="This poster is already applied to your library">
          <BadgeCheck size={11} /> Applied
        </div>
      ) : inLibrary ? (
        <div className={styles.inLibBadge} title="You've already applied art to this title">
          <Library size={10} />
        </div>
      ) : null}

      {/* zoom to view the full image (doesn't trigger upload) */}
      <button className={styles.zoomBtn} title="View full size" onClick={e => { e.stopPropagation(); onView() }}>
        <Maximize2 size={11} />
      </button>
    </div>
  )
}

// --- Main entry card ----------------------------------------------------------

export default function UrlQueueEntry({ entry, isRunning, patchPoster }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>({ setIds: new Set(), titles: new Set(), posterUrls: new Set() })
  const removeEntry = useScrapeStore(s => s.removeEntry)

  const doneCount = entry.posters.filter(p => p.uploadStatus === 'done').length

  // MediUX set id for this entry (only for /sets/ links) - recorded on upload so
  // the Library Browser recognises it, and used to flag a re-scraped applied set.
  const entrySetId = entry.url.match(/\/sets\/(\d+)/)?.[1]
  const setAlreadyApplied = !!entrySetId && appliedIdx.setIds.has(entrySetId)

  // Reloads when expanded and whenever an upload completes so it stays live.
  useEffect(() => {
    if (!expanded) return
    loadAppliedIndex().then(setAppliedIdx)
  }, [expanded, doneCount])

  // Grouped sections + a flat list (group order) for the lightbox
  const groups = useMemo(() => groupPosters(entry.posters), [entry.posters])
  const lightboxImages = useMemo<LightboxImage[]>(
    () => groups.flatMap(g => g.posters.map(p => ({
      url: p.url,
      label: g.label,
      caption: p.episode != null ? `Episode ${p.episode}` : (p.title || undefined),
    }))),
    [groups],
  )
  // A specific poster is "applied" if its exact image was uploaded before, or the
  // whole set was applied. (setAlreadyApplied/title give a softer fallback.)
  const isPosterApplied = (p: PosterResult) =>
    appliedIdx.posterUrls.has(p.url) || setAlreadyApplied
  const inLibrary = (p: PosterResult) =>
    isPosterApplied(p) || appliedIdx.titles.has(appliedKey(p.title, p.year))

  const source = entry.posters[0]?.source ?? sourceFromUrl(entry.url) ?? 'posterdb'

  const posterCount = entry.posters.length
  const errorCount  = entry.posters.filter(p =>
    p.uploadStatus === 'error' || p.uploadStatus === 'no_match'
  ).length

  const hasDone    = doneCount > 0
  const hasErrors  = errorCount > 0
  const allDone    = posterCount > 0 && doneCount === posterCount

  // Posters not yet applied (new title cards, changed art, etc.)
  const unappliedCount = entry.posters.filter(p => p.uploadStatus !== 'done' && !isPosterApplied(p)).length

  async function uploadAll() {
    for (const p of entry.posters) {
      if (p.uploadStatus === 'idle' || p.uploadStatus === 'no_match' || p.uploadStatus === 'error') {
        await uploadPoster(entry.id, p, patchPoster, entrySetId)
      }
    }
  }

  async function uploadUnapplied() {
    for (const p of entry.posters) {
      if (p.uploadStatus !== 'done' && !isPosterApplied(p)) {
        await uploadPoster(entry.id, p, patchPoster, entrySetId)
      }
    }
  }

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
      {/* -- Row ------------------------------------------------------------ */}
      <div className={styles.row}>

        {/* drag handle */}
        <div className={styles.dragHandle} title="Drag to reorder">
          <GripVertical size={14} />
        </div>

        {/* source badge */}
        <Badge variant={source} className={styles.sourceBadge}>
          {source === 'posterdb' ? 'PDB' : 'MX'}
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
          {entry.status === 'done' && posterCount === 0 && (
            <span className={styles.statusMuted}>No posters found</span>
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

      {/* -- Poster grid (expanded) ------------------------------------------ */}
      <AnimatePresence initial={false}>
        {expanded && entry.posters.length > 0 && (
          <motion.div
            className={styles.posterSection}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {(() => {
              let flat = -1
              return groups.map(g => (
                <div key={g.label} className={styles.posterGroup}>
                  <div className={styles.posterGroupLabel}>
                    {g.label}<span className={styles.posterGroupCount}>{g.posters.length}</span>
                  </div>
                  <div className={`${styles.posterGrid} ${g.kind === 'title_card' || g.kind === 'backdrop' ? styles.posterGridWide : ''}`}>
                    {g.posters.map(p => {
                      flat++
                      const idx = flat
                      return (
                        <PosterThumb
                          key={p.url}
                          poster={p}
                          entryId={entry.id}
                          patchPoster={patchPoster}
                          onView={() => setLightbox(idx)}
                          applied={isPosterApplied(p)}
                          inLibrary={inLibrary(p) && !isPosterApplied(p)}
                          setId={entrySetId}
                        />
                      )
                    })}
                  </div>
                </div>
              ))
            })()}
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
