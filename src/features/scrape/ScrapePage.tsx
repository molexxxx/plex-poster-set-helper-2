import { useMemo } from 'react'
import { Reorder, AnimatePresence, motion } from 'framer-motion'
import { Link2 } from 'lucide-react'
import EmptyState from '../../components/ui/EmptyState'
import PlexConnectBanner from '../../components/ui/PlexConnectBanner'
import { useAppContext } from '../../app/AppContext'
import { useScrapeStore } from './hooks/useScrapeStore'
import { useScrapeRunner } from './hooks/useScrapeRunner'
import UrlInput from './components/UrlInput'
import QueueControls from './components/QueueControls'
import RunGate from './components/RunGate'
import UrlQueueEntry from './components/UrlQueueEntry'
import { ARTWORK_TYPES } from '../../../electron/services/schedule/artworkTypes'
import { filterByTypes } from '../../utils/posterGroups'
import styles from './ScrapePage.module.css'


/** Manual scrape page: URL queue with a concurrency-pooled runner and live progress. */
export default function ScrapePage() {
  const { plexConnected } = useAppContext()
  const { entries, isRunning, addUrls, setEntries, patchPoster, clearAll, types, setTypes } =
    useScrapeStore()
  const shownTypes = useMemo(() => new Set(types ?? ARTWORK_TYPES), [types])
  const { runQueue, cancelRun } = useScrapeRunner()

  const idleCount    = entries.filter(e => e.status === 'idle').length
  const doneCount    = entries.filter(e => e.status === 'done').length
  const errorCount   = entries.filter(e => e.status === 'error').length
  const totalPosters = entries.reduce((n, e) => n + filterByTypes(e.posters, shownTypes).shown.length, 0)

  return (
    <div className={styles.page}>

      {!plexConnected && <PlexConnectBanner />}

      {/* URL Input */}
      <UrlInput disabled={isRunning} onAdd={addUrls} />

      {/* Controls */}
      {entries.length > 0 && (
        <QueueControls
          isRunning={isRunning}
          idleCount={idleCount}
          doneCount={doneCount}
          errorCount={errorCount}
          totalPosters={totalPosters}
          shownTypes={shownTypes}
          typesReady={!!types}
          onRun={runQueue}
          onCancel={cancelRun}
          onClear={clearAll}
          onTypesChange={setTypes}
        />
      )}

      {/* Run gate: shown when queue has idle items and isn't running */}
      <AnimatePresence>
        {entries.length > 0 && !isRunning && idleCount > 0 && (
          <RunGate idleCount={idleCount} onRun={runQueue} />
        )}
      </AnimatePresence>

      {/* Queue */}
      <div className={styles.queue}>
        <AnimatePresence mode="popLayout">
          {entries.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <EmptyState
                icon={<Link2 size={28} />}
                title="Queue is empty"
                description="Add PosterDB or MediUX URLs above to get started."
              />
            </motion.div>
          ) : (
            <Reorder.Group
              key="list"
              axis="y"
              values={entries}
              onReorder={setEntries}
              className={styles.reorderList}
              as="ul"
            >
              <AnimatePresence initial={false}>
                {entries.map(entry => (
                  <UrlQueueEntry
                    key={entry.id}
                    entry={entry}
                    types={shownTypes}
                    isRunning={isRunning}
                    patchPoster={patchPoster}
                  />
                ))}
              </AnimatePresence>
            </Reorder.Group>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
