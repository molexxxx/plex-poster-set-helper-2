import { useEffect, useRef, useCallback } from 'react'
import { useScrapeStore } from './useScrapeStore'
import type { QueueEntry, PosterResult } from './useScrapeStore'
import type { PosterInfo, ScrapeProgress } from '../../../../electron/ipc/types'
import { ARTWORK_TYPES } from '../../../../electron/services/schedule/artworkTypes'


const MAX_WORKERS = 2


/**
 * Runs the scrape queue. Reads the artwork types from Settings once per
 * session, marks an entry the main process reports as failed, and scrapes
 * idle entries a couple at a time.
 *
 * @returns `runQueue` to scrape every idle entry, and `cancelRun` to stop and
 *   put entries still scraping back in the queue.
 */
export function useScrapeRunner() {
  const { entries, patchEntry, setRunning, setTypes } = useScrapeStore()
  const abortRef = useRef(false)
  const runningRef = useRef(false)

  // The page starts from the types picked in Settings, once per session.
  useEffect(() => {
    if (useScrapeStore.getState().types) return
    window.api.config.get()
      .then(c => { if (!useScrapeStore.getState().types) setTypes(c.mediuxFilters?.length ? c.mediuxFilters : [...ARTWORK_TYPES]) })
      .catch(() => setTypes([...ARTWORK_TYPES]))
  }, [setTypes])

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
        // Every type is read so the type toggles can change what applies without a rescrape.
        const results = await window.api.scrape.url(entry.url, [...ARTWORK_TYPES]) as PosterInfo[]
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

  return { runQueue, cancelRun }
}
