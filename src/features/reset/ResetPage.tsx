import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { RotateCcw, RefreshCw, CheckCircle2, Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button'
import Spinner from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import Lightbox from '../../components/ui/Lightbox'
import Pager from '../../components/ui/Pager'
import PlexConnectBanner from '../../components/ui/PlexConnectBanner'
import { useAppContext } from '../../app/AppContext'
import { useReset, type ResetItemStatus } from './ResetContext'
import { useTrackedPosters } from './hooks/useTrackedPosters'
import { useCleanBundles } from './hooks/useCleanBundles'
import StatStrip from './components/StatStrip'
import SkeletonRows from './components/SkeletonRows'
import SpaceRow from './components/SpaceRow'
import ResetFilters from './components/ResetFilters'
import TrackedRow from './components/TrackedRow'
import ResetAllModal from './components/ResetAllModal'
import styles from './ResetPage.module.css'


/** Reset Posters page: lists locally tracked applied art and restores Plex originals. */
export default function ResetPage()
{
  const { plexConnected } = useAppContext()
  // The run loop lives in ResetProvider so it survives navigating away mid-run.
  const { running, total, completed, statuses, revision, startAll, resetOne } = useReset()
  const tracked = useTrackedPosters(revision)
  const clean = useCleanBundles()
  const [confirmAll, setConfirmAll] = useState(false)
  const [lightbox, setLightbox]     = useState<number | null>(null)
  const [deleteUploads, setDeleteUploads] = useState(false)
  const { items, loading, load, listRef, goToPage, filtered, pageItems, pageCount, safePage, pageStart, pageSize, stats, lightboxImages } = tracked


  function resetAll()
  {
    setConfirmAll(false)
    // Hand the whole batch to the controller so it keeps running (and stays
    // visible) even if the user navigates away from this page.
    startAll(filtered.map(i => ({ key: i.key, type: i.type })), deleteUploads)
  }


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
        <SpaceRow
          hasItems={items.length > 0}
          plexConnected={plexConnected}
          deleteUploads={deleteUploads}
          onDeleteUploadsChange={setDeleteUploads}
          running={running}
          clean={clean}
        />
      )}

      {/* Filters */}
      {items.length > 0 && (
        <ResetFilters
          search={tracked.search}
          onSearch={tracked.searchFor}
          sourceFilter={tracked.sourceFilter}
          onSource={tracked.showSource}
          typeFilter={tracked.typeFilter}
          onType={tracked.showType}
          running={running}
          completed={completed}
          total={total}
        />
      )}

      {/* Item list */}
      <div className={styles.list} ref={listRef}>
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
          // Keyed per page so a page change is a clean remount (no rows panning
          // in from the side) while single-row reset keeps its exit animation.
          <div key={safePage} className={styles.pageRows}>
          <AnimatePresence initial={false}>
            {pageItems.map(item => (
              <TrackedRow
                key={item.key}
                item={item}
                status={(statuses[item.key] ?? 'idle') as ResetItemStatus | 'idle'}
                deleteUploads={deleteUploads}
                running={running}
                onView={() => setLightbox(filtered.findIndex(f => f.key === item.key))}
                onReset={() => resetOne({ key: item.key, type: item.type }, deleteUploads)}
              />
            ))}
          </AnimatePresence>
          </div>
        )}
      </div>

      {/* Pager overlay: pinned at the bottom flanking the dock, while the list
          scrolls cleanly under both. */}
      {!loading && filtered.length > 0 && (
        <div className={styles.pagerBar}>
          <span className={styles.pagerStatus}>
            Showing {pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)} of {filtered.length}
          </span>
          <Pager page={safePage} pageCount={pageCount} onPage={goToPage} />
        </div>
      )}

      {/* Confirm all modal */}
      <ResetAllModal
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        count={filtered.length}
        deleteUploads={deleteUploads}
        onConfirm={resetAll}
      />

      <AnimatePresence>
        {lightbox !== null && lightbox >= 0 && (
          <Lightbox images={lightboxImages} index={lightbox} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
