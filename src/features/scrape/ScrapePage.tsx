import { useEffect, useRef, useState, useCallback } from 'react'
import { Reorder, AnimatePresence, motion } from 'framer-motion'
import { Link2, Play, Square, Trash2, ListPlus, Zap } from 'lucide-react'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import Spinner from '../../components/ui/Spinner'
import PlexConnectBanner from '../../components/ui/PlexConnectBanner'
import { useAppContext } from '../../app/AppContext'
import { useScrapeStore } from './useScrapeStore'
import UrlQueueEntry from './components/UrlQueueEntry'
import type { QueueEntry, PosterResult } from './useScrapeStore'
import type { PosterInfo, ScrapeProgress } from '../../../electron/ipc/types'
import styles from './ScrapePage.module.css'


const MAX_WORKERS = 2


/** Manual scrape page: URL queue with a concurrency-pooled runner and live progress. */
export default function ScrapePage() {
  const { plexConnected } = useAppContext()
  const { entries, isRunning, addUrls, setEntries, patchEntry, patchPoster, clearAll, setRunning } =
    useScrapeStore()

  const [inputValue, setInputValue] = useState('')
  const abortRef = useRef(false)
  const runningRef = useRef(false)


  useEffect(() => {
    const off = window.api.scrape.onProgress((prog: ScrapeProgress) => {
      const match = entries.find(e => e.url === prog.url)
      if (!match) return
      if (prog.status === 'error') {
        patchEntry(match.id, { status: 'error', error: prog.error })
      }
    })
    return () => { off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])


  const runQueue = useCallback(async () => {
    if (runningRef.current) return
    abortRef.current = false
    runningRef.current = true
    setRunning(true)

    const idle = useScrapeStore.getState().entries.filter(e => e.status === 'idle')
    if (!idle.length) {
      setRunning(false)
      runningRef.current = false
      return
    }

    // Simple concurrency pool - emit at most MAX_WORKERS concurrent invocations
    let cursor = 0

    async function runOne(entry: QueueEntry) {
      if (abortRef.current) return
      patchEntry(entry.id, { status: 'scraping', posters: [] })
      try {
        const results = await window.api.scrape.url(entry.url) as PosterInfo[]
        if (abortRef.current) return
        patchEntry(entry.id, {
          status: 'done',
          posters: results.map((p): PosterResult => ({ ...p, uploadStatus: 'idle' })),
        })
      } catch (err) {
        patchEntry(entry.id, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    async function worker() {
      while (cursor < idle.length && !abortRef.current) {
        const entry = idle[cursor++]
        await runOne(entry)
      }
    }

    const workerCount = Math.min(MAX_WORKERS, idle.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    runningRef.current = false
    setRunning(false)
  }, [patchEntry, setRunning])

  const cancelRun = useCallback(async () => {
    abortRef.current = true
    await window.api.scrape.cancel()
    // Reset any mid-scrape entries back to idle
    useScrapeStore.getState().entries.forEach(e => {
      if (e.status === 'scraping') {
        useScrapeStore.getState().patchEntry(e.id, { status: 'idle' })
      }
    })
    setRunning(false)
    runningRef.current = false
  }, [setRunning])


  function handleAdd() {
    const urls = inputValue
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean)
    if (urls.length) {
      addUrls(urls)
      setInputValue('')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleAdd()
    }
  }


  const idleCount    = entries.filter(e => e.status === 'idle').length
  const doneCount    = entries.filter(e => e.status === 'done').length
  const errorCount   = entries.filter(e => e.status === 'error').length
  const totalPosters = entries.reduce((n, e) => n + e.posters.length, 0)

  return (
    <div className={styles.page}>

      {!plexConnected && <PlexConnectBanner />}

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className="page-title">Poster Scrape</h1>
          <p className="page-subtitle">
            Paste PosterDB set / poster / user links or MediUX set links, one per line.
          </p>
        </div>
      </div>

      {/* URL Input */}
      <div className={styles.inputSection}>
        <textarea
          className={styles.urlInput}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={'https://theposterdb.com/set/12345\nhttps://mediux.pro/sets/67890\n…'}
          rows={4}
          disabled={isRunning}
          spellCheck={false}
        />
        <div className={styles.inputFooter}>
          <p className={styles.inputHint}>
            <kbd className={styles.kbd}>Ctrl</kbd><kbd className={styles.kbd}>Enter</kbd> to add
            &nbsp;·&nbsp; PosterDB sets · user pages · MediUX sets
          </p>
          <Button
            variant="primary"
            size="sm"
            icon={<ListPlus size={14} />}
            onClick={handleAdd}
            disabled={isRunning || !inputValue.trim()}
          >
            Add to Queue
          </Button>
        </div>
      </div>

      {/* Controls */}
      {entries.length > 0 && (
        <div className={styles.controls}>
          <div className={styles.controlsLeft}>
            {!isRunning ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={13} />}
                onClick={runQueue}
                disabled={idleCount === 0}
              >
                Run{idleCount > 0 ? ` (${idleCount})` : ''}
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                icon={<Square size={13} />}
                onClick={cancelRun}
              >
                Cancel
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={clearAll}
              disabled={isRunning}
            >
              Clear All
            </Button>
          </div>

          <div className={styles.controlsRight}>
            {isRunning && <Spinner size="xs" />}
            {doneCount > 0 && (
              <span className={styles.stat}>
                <span className={styles.statVal}>{doneCount}</span>
                <span className={styles.statLbl}>done</span>
              </span>
            )}
            {totalPosters > 0 && (
              <span className={styles.stat}>
                <span className={styles.statVal}>{totalPosters}</span>
                <span className={styles.statLbl}>posters</span>
              </span>
            )}
            {errorCount > 0 && (
              <span className={`${styles.stat} ${styles.statError}`}>
                <span className={styles.statVal}>{errorCount}</span>
                <span className={styles.statLbl}>error{errorCount !== 1 ? 's' : ''}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Run gate: shown when queue has idle items and isn't running */}
      <AnimatePresence>
        {entries.length > 0 && !isRunning && idleCount > 0 && (
          <motion.div
            className={styles.runGate}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            <div className={styles.runGateInfo}>
              <span className={styles.runGateDot} aria-hidden="true" />
              <span>
                <strong>{idleCount}</strong> URL{idleCount !== 1 ? 's' : ''} queued and ready, click Run to begin scraping
              </span>
            </div>
            <Button variant="primary" size="sm" icon={<Zap size={13} />} onClick={runQueue}>
              Run Queue
            </Button>
          </motion.div>
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
