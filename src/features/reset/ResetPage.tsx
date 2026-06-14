import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  RotateCcw, RefreshCw, Film, Tv2, Layers, AlertTriangle,
  CheckCircle2, HardDrive, Trash2,
} from 'lucide-react'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Spinner from '../../components/ui/Spinner'
import Switch from '../../components/ui/Switch'
import EmptyState from '../../components/ui/EmptyState'
import Modal from '../../components/ui/Modal'
import Lightbox, { type LightboxImage } from '../../components/ui/Lightbox'
import PlexConnectBanner from '../../components/ui/PlexConnectBanner'
import { useAppContext } from '../../app/AppContext'
import { useReset, type ResetItemStatus } from './ResetContext'
import type { AppliedRecord } from '../../../electron/ipc/types'
import styles from './ResetPage.module.css'

/**
 * Bumps the width/height params on a thumb URL so the lightbox shows it larger.
 *
 * @param url - Transcode thumb URL.
 * @returns The same URL at 700x1050, or undefined when absent.
 */
function enlarge(url?: string): string | undefined {
  if (!url) return undefined
  return url.replace(/width=\d+/i, 'width=700').replace(/height=\d+/i, 'height=1050')
}

/**
 * "3 days ago" style relative time.
 *
 * @param iso - ISO timestamp.
 * @returns A short label, or an empty string when absent.
 */
function timeAgo(iso?: string): string {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}


type SourceFilter = 'all' | 'mediux' | 'posterdb'
type TypeFilter   = 'all' | 'movie' | 'show'
type CleanState   = 'idle' | 'cleaning' | 'done' | 'error'

interface TrackedItem extends AppliedRecord {
  /** itemKey alias for existing markup. */
  key: string
}

interface Stats {
  total: number
  mediux: number
  posterdb: number
  movies: number
  shows: number
}


/** Summary chips of applied-poster counts by source and type. */
function StatStrip({ stats }: { stats: Stats }) {
  return (
    <div className={styles.statsStrip}>
      <span className={styles.stripStat}>
        <Layers size={13} className={styles.stripIcon} />
        <strong>{stats.total}</strong>
        <span>tracked</span>
      </span>
      <span className={styles.stripDiv} />
      <span className={styles.stripStat}>
        <span className={`${styles.sourceChip} ${styles.sourceChipMx}`}>MX</span>
        <strong>{stats.mediux}</strong>
      </span>
      <span className={styles.stripStat}>
        <span className={`${styles.sourceChip} ${styles.sourceChipPdb}`}>PDB</span>
        <strong>{stats.posterdb}</strong>
      </span>
      <span className={styles.stripDiv} />
      <span className={styles.stripStat}>
        <Film size={12} className={styles.stripIcon} />
        <strong>{stats.movies}</strong>
        <span>movies</span>
      </span>
      <span className={styles.stripStat}>
        <Tv2 size={12} className={styles.stripIcon} />
        <strong>{stats.shows}</strong>
        <span>shows</span>
      </span>
    </div>
  )
}


/** Shimmer placeholder rows shown while the applied history loads. */
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={styles.skelRow} style={{ animationDelay: `${i * 60}ms` }}>
          <div className={`${styles.skel} ${styles.skelThumb}`} />
          <div className={styles.skelInfo}>
            <div className={`${styles.skel} ${styles.skelTitle}`} />
            <div className={`${styles.skel} ${styles.skelMeta}`} />
          </div>
          <div className={`${styles.skel} ${styles.skelBtn}`} />
        </div>
      ))}
    </>
  )
}


/** Reset Posters page: lists locally tracked applied art and restores Plex originals. */
export default function ResetPage() {
  const { plexConnected } = useAppContext()
  // The run loop lives in ResetProvider so it survives navigating away mid-run.
  const { running, total, completed, statuses, revision, startAll, resetOne } = useReset()
  const [items, setItems]           = useState<TrackedItem[]>([])
  const [loading, setLoading]       = useState(false)
  const [sourceFilter, setSource]   = useState<SourceFilter>('all')
  const [typeFilter, setType]       = useState<TypeFilter>('all')
  const [search, setSearch]         = useState('')
  const [confirmAll, setConfirmAll] = useState(false)
  const [lightbox, setLightbox]     = useState<number | null>(null)
  const [deleteUploads, setDeleteUploads] = useState(false)
  const [cleanState, setCleanState] = useState<CleanState>('idle')
  const cleanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)


  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const cfg = await window.api.config.get()
      const records = cfg.appliedPosters ?? []
      // One row per Plex item (latest record wins)
      const byItem = new Map<string, AppliedRecord>()
      for (const r of records) if (!byItem.has(r.itemKey)) byItem.set(r.itemKey, r)
      setItems([...byItem.values()].map(r => ({ ...r, key: r.itemKey })))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  // The controller forgets items from history as they reset; pull the fresh list
  // so reset rows drop (without flashing the loading skeleton each time).
  useEffect(() => { if (revision > 0) void load(true) }, [revision, load])
  useEffect(() => () => { if (cleanTimer.current) clearTimeout(cleanTimer.current) }, [])


  /**
   * Triggers Plex's Clean Bundles task. The IPC call resolves only once the task
   * actually clears server-side, so the button tracks real progress and ends the
   * moment it's done - no fixed cooldown.
   */
  async function cleanBundles() {
    if (cleanState === 'cleaning') return
    if (cleanTimer.current) clearTimeout(cleanTimer.current)
    setCleanState('cleaning')
    try {
      await window.api.plex.cleanBundles()
      setCleanState('done')
      cleanTimer.current = setTimeout(() => setCleanState('idle'), 2_500)
    } catch {
      setCleanState('error')
      cleanTimer.current = setTimeout(() => setCleanState('idle'), 4_000)
    }
  }


  function resetAll() {
    setConfirmAll(false)
    // Hand the whole batch to the controller so it keeps running (and stays
    // visible) even if the user navigates away from this page.
    startAll(filtered.map(i => i.key), deleteUploads)
  }


  const filtered = items.filter(i => {
    if (sourceFilter !== 'all' && i.source !== sourceFilter) return false
    if (typeFilter   !== 'all' && i.type   !== typeFilter)   return false
    if (search && !i.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const stats = useMemo<Stats>(() => ({
    total:    items.length,
    mediux:   items.filter(i => i.source === 'mediux').length,
    posterdb: items.filter(i => i.source === 'posterdb').length,
    movies:   items.filter(i => i.type === 'movie').length,
    shows:    items.filter(i => i.type === 'show').length,
  }), [items])

  const lightboxImages: LightboxImage[] = filtered.map(i => ({
    url: enlarge(i.thumb) ?? i.thumb ?? '',
    label: i.year ? `${i.title} (${i.year})` : i.title,
    caption: `${i.source === 'mediux' ? 'MediUX' : 'ThePosterDB'} · ${i.libraryTitle ?? ''}`.trim(),
  }))

  const cleanBusy = cleanState === 'cleaning'
  const cleanLabel =
    cleanState === 'cleaning' ? 'Cleaning…'
    : cleanState === 'done' ? 'Cleaned'
    : cleanState === 'error' ? 'Failed'
    : 'Clean Bundles'


  return (
    <div className={styles.page}>

      {!plexConnected && <PlexConnectBanner />}

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className="page-title">Reset Posters</h1>
          <p className="page-subtitle">
            View and remove custom posters applied by this tool. Resets the item to its original Plex artwork.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="ghost"
            size="sm"
            icon={loading ? <Spinner size="xs" color="current" /> : <RefreshCw size={13} />}
            onClick={() => load()}
            disabled={loading}
          >
            Refresh
          </Button>
          {filtered.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              icon={deleteUploads ? <Trash2 size={13} /> : <RotateCcw size={13} />}
              onClick={() => setConfirmAll(true)}
              disabled={running}
            >
              Reset All ({filtered.length})
            </Button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      {!loading && items.length > 0 && <StatStrip stats={stats} />}

      {/* Space management: delete uploaded images + reclaim disk. Stays visible with
          no tracked items so Clean Bundles is still reachable right after a Reset All. */}
      {(items.length > 0 || plexConnected) && (
        <div className={`${styles.spaceRow} ${deleteUploads && items.length > 0 ? styles.spaceRowArmed : ''}`}>
          {items.length > 0 ? (
            <Switch
              checked={deleteUploads}
              onChange={setDeleteUploads}
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
      )}

      {/* Filters */}
      {items.length > 0 && (
        <div className={styles.filters}>
          <input
            className={styles.searchInput}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title…"
          />
          <div className={styles.filterGroup}>
            {(['all', 'mediux', 'posterdb'] as SourceFilter[]).map(f => (
              <button
                key={f}
                className={`${styles.filterBtn} ${sourceFilter === f ? styles.filterActive : ''}`}
                onClick={() => setSource(f)}
              >
                {f === 'all' ? 'All Sources' : f === 'mediux' ? 'MediUX' : 'PosterDB'}
              </button>
            ))}
          </div>
          <div className={styles.filterGroup}>
            {(['all', 'movie', 'show'] as TypeFilter[]).map(f => (
              <button
                key={f}
                className={`${styles.filterBtn} ${typeFilter === f ? styles.filterActive : ''}`}
                onClick={() => setType(f)}
              >
                {f === 'all' ? 'All Types' : f === 'movie' ? 'Movies' : 'Shows'}
              </button>
            ))}
          </div>
          {running && (
            <span className={styles.workingTag}>
              <Spinner size="xs" /> Resetting… {completed}/{total}
            </span>
          )}
        </div>
      )}

      {/* Item list */}
      <div className={styles.list}>
        {loading ? (
          <SkeletonRows />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={22} />}
            title={items.length === 0 ? 'Nothing applied yet' : 'No results'}
            description={
              items.length === 0
                ? 'Posters you apply from the Library Browser show up here, ready to revert to original Plex art.'
                : 'Try adjusting your filters or search.'
            }
          />
        ) : (
          <AnimatePresence initial={false}>
            {filtered.map(item => {
              const status = (statuses[item.key] ?? 'idle') as ResetItemStatus | 'idle'
              return (
              <motion.div
                key={item.key}
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
                  onClick={() => setLightbox(filtered.findIndex(f => f.key === item.key))}
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
                    <Badge variant={item.source}>{item.source === 'mediux' ? 'MediUX' : 'PosterDB'}</Badge>
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
                      onClick={() => resetOne(item.key, deleteUploads)}
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
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Confirm all modal */}
      <Modal
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title={deleteUploads ? 'Reset & Delete All?' : 'Reset All Posters?'}
        size="sm"
      >
        <p className={styles.confirmText}>
          This will reset <strong>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</strong> to
          their original Plex artwork and remove MediUX / ThePosterDB labels. This cannot be undone.
          {deleteUploads && (
            <> Uploaded poster and background images will also be <strong>deleted from your Plex server</strong>.</>
          )}
        </p>
        <div className={styles.confirmActions}>
          <Button variant="ghost" size="sm" onClick={() => setConfirmAll(false)}>Cancel</Button>
          <Button
            variant="destructive"
            size="sm"
            icon={deleteUploads ? <Trash2 size={13} /> : <RotateCcw size={13} />}
            onClick={resetAll}
          >
            {deleteUploads ? 'Reset & Delete' : 'Reset All'}
          </Button>
        </div>
      </Modal>

      <AnimatePresence>
        {lightbox !== null && lightbox >= 0 && (
          <Lightbox images={lightboxImages} index={lightbox} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
