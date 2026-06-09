import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  RotateCcw, RefreshCw, Film, Tv2, Layers, AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Spinner from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import Modal from '../../components/ui/Modal'
import Lightbox, { type LightboxImage } from '../../components/ui/Lightbox'
import PlexConnectBanner from '../../components/ui/PlexConnectBanner'
import { useAppContext } from '../../app/AppContext'
import type { AppliedRecord } from '../../../electron/ipc/types'
import styles from './ResetPage.module.css'

// Bump the width/height params on a thumb URL so the lightbox shows it larger.
function enlarge(url?: string): string | undefined {
  if (!url) return undefined
  return url.replace(/width=\d+/i, 'width=700').replace(/height=\d+/i, 'height=1050')
}

// "3 days ago" style relative time.
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

// --- Types --------------------------------------------------------------------

type SourceFilter = 'all' | 'mediux' | 'posterdb'
type TypeFilter   = 'all' | 'movie' | 'show'
type ItemStatus   = 'idle' | 'resetting' | 'done' | 'error'

interface TrackedItem extends AppliedRecord {
  key: string            // itemKey alias for existing markup
  resetStatus: ItemStatus
}

// --- Stats strip --------------------------------------------------------------

function StatStrip({ stats, total }: { stats: Record<string, number>; total: number }) {
  return (
    <div className={styles.statsStrip}>
      <span className={styles.stripStat}>
        <Layers size={13} className={styles.stripIcon} />
        <strong>{total}</strong>
        <span>tracked</span>
      </span>
      <span className={styles.stripDiv} />
      <span className={styles.stripStat}>
        <span className={`${styles.sourceChip} ${styles.sourceChipMx}`}>MX</span>
        <strong>{stats.mediux ?? 0}</strong>
      </span>
      <span className={styles.stripStat}>
        <span className={`${styles.sourceChip} ${styles.sourceChipPdb}`}>PDB</span>
        <strong>{stats.posterdb ?? 0}</strong>
      </span>
      <span className={styles.stripDiv} />
      <span className={styles.stripStat}>
        <Film size={12} className={styles.stripIcon} />
        <strong>{stats.movies ?? 0}</strong>
        <span>movies</span>
      </span>
      <span className={styles.stripStat}>
        <Tv2 size={12} className={styles.stripIcon} />
        <strong>{stats.shows ?? 0}</strong>
        <span>shows</span>
      </span>
    </div>
  )
}

// --- Component ----------------------------------------------------------------

export default function ResetPage() {
  const { plexConnected } = useAppContext()
  const [items, setItems]           = useState<TrackedItem[]>([])
  const [loading, setLoading]       = useState(false)
  const [stats, setStats]           = useState<Record<string, number>>({})
  const [sourceFilter, setSource]   = useState<SourceFilter>('all')
  const [typeFilter, setType]       = useState<TypeFilter>('all')
  const [search, setSearch]         = useState('')
  const [confirmAll, setConfirmAll] = useState(false)
  const [resettingAll, setResettingAll] = useState(false)
  const [lightbox, setLightbox] = useState<number | null>(null)

  // -- Load -------------------------------------------------------------------

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cfg = await window.api.config.get()
      const records = cfg.appliedPosters ?? []
      // One row per Plex item (latest record wins)
      const byItem = new Map<string, AppliedRecord>()
      for (const r of records) if (!byItem.has(r.itemKey)) byItem.set(r.itemKey, r)
      const tracked: TrackedItem[] = [...byItem.values()].map(r => ({ ...r, key: r.itemKey, resetStatus: 'idle' as const }))
      setItems(tracked)

      setStats({
        total:    tracked.length,
        mediux:   tracked.filter(i => i.source === 'mediux').length,
        posterdb: tracked.filter(i => i.source === 'posterdb').length,
        movies:   tracked.filter(i => i.type === 'movie').length,
        shows:    tracked.filter(i => i.type === 'show').length,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Remove an item from the local applied history.
  async function forgetItem(key: string) {
    const cfg = await window.api.config.get()
    const next = (cfg.appliedPosters ?? []).filter(r => r.itemKey !== key)
    await window.api.config.set({ appliedPosters: next })
  }

  // -- Reset single -----------------------------------------------------------

  async function resetOne(key: string) {
    setItems(prev => prev.map(i => i.key === key ? { ...i, resetStatus: 'resetting' } : i))
    try {
      await window.api.plex.resetPoster(key, true)
      await forgetItem(key)
      setItems(prev => prev.map(i => i.key === key ? { ...i, resetStatus: 'done' } : i))
    } catch {
      setItems(prev => prev.map(i => i.key === key ? { ...i, resetStatus: 'error' } : i))
    }
  }

  // -- Reset all --------------------------------------------------------------

  async function resetAll() {
    setConfirmAll(false)
    setResettingAll(true)
    for (const item of filtered) {
      if (item.resetStatus === 'done') continue
      await resetOne(item.key)
    }
    setResettingAll(false)
  }

  // -- Filtered list ----------------------------------------------------------

  const filtered = items.filter(i => {
    if (sourceFilter !== 'all' && i.source !== sourceFilter) return false
    if (typeFilter   !== 'all' && i.type   !== typeFilter)   return false
    if (search && !i.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const doneCount = filtered.filter(i => i.resetStatus === 'done').length

  const lightboxImages: LightboxImage[] = filtered.map(i => ({
    url: enlarge(i.thumb) ?? i.thumb ?? '',
    label: i.year ? `${i.title} (${i.year})` : i.title,
    caption: `${i.source === 'mediux' ? 'MediUX' : 'ThePosterDB'} · ${i.libraryTitle ?? ''}`.trim(),
  }))

  // --- Render ----------------------------------------------------------------

  return (
    <div className={styles.page}>

      {!plexConnected && <PlexConnectBanner />}

      {/* -- Header ----------------------------------------------------------- */}
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
            onClick={load}
            disabled={loading}
          >
            Refresh
          </Button>
          {filtered.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              icon={<RotateCcw size={13} />}
              onClick={() => setConfirmAll(true)}
              disabled={resettingAll || filtered.every(i => i.resetStatus === 'done')}
            >
              Reset All ({filtered.length})
            </Button>
          )}
        </div>
      </div>

      {/* -- Stats strip ------------------------------------------------------ */}
      {!loading && items.length > 0 && (
        <StatStrip stats={stats} total={stats.total ?? items.length} />
      )}

      {/* -- Filters ---------------------------------------------------------- */}
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
          {doneCount > 0 && (
            <span className={styles.doneCount}>{doneCount} reset</span>
          )}
        </div>
      )}

      {/* -- Item list -------------------------------------------------------- */}
      <div className={styles.list}>
        {loading ? (
          <div className={styles.loadingCenter}>
            <Spinner size="md" />
            <span className={styles.loadingText}>Loading labeled items…</span>
          </div>
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
            {filtered.map(item => (
              <motion.div
                key={item.key}
                className={`${styles.itemRow} ${item.resetStatus === 'done' ? styles.itemDone : ''}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
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
                  {item.resetStatus === 'resetting' && <Spinner size="xs" />}
                  {item.resetStatus === 'done' && (
                    <span className={styles.doneLabel}>
                      <CheckCircle2 size={13} /> Reset
                    </span>
                  )}
                  {item.resetStatus === 'error' && (
                    <span className={styles.errorLabel}>
                      <AlertTriangle size={13} /> Failed
                    </span>
                  )}
                  {(item.resetStatus === 'idle' || item.resetStatus === 'error') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<RotateCcw size={12} />}
                      onClick={() => resetOne(item.key)}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* -- Confirm all modal ------------------------------------------------- */}
      <Modal
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="Reset All Posters?"
        size="sm"
      >
        <p className={styles.confirmText}>
          This will reset <strong>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</strong> to
          their original Plex artwork and remove MediUX / ThePosterDB labels. This cannot be undone.
        </p>
        <div className={styles.confirmActions}>
          <Button variant="ghost" size="sm" onClick={() => setConfirmAll(false)}>Cancel</Button>
          <Button variant="destructive" size="sm" icon={<RotateCcw size={13} />} onClick={resetAll}>
            Reset All
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
