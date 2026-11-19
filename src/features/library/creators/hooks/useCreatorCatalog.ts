import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreatorCrawlStatus, MediuxUserSet, UserSetsChunk, UserSetsSnapshot } from '../../../../../electron/ipc/types'
import { errorMessage } from '../../../../utils/errorMessage'
import { catalogCache, rememberCatalog } from '../catalogCache'
import { appendNew } from '../catalogUtils'
/**
 * A creator's catalog, painted from this window's cache when it has one and
 * kept current from the main process: the first call sends the revision it
 * holds, so an unchanged catalog costs no transfer, and later changes arrive
 * as deltas.
 *
 * @returns The sets and crawl state, whether a check or re-read is running, the error or
 *   notice, and `check` and `reread`.
 */
export function useCreatorCatalog(username: string)
{
  const key = username.toLowerCase()
  const [cached] = useState(() => catalogCache.get(key))
  const [sets, setSets]           = useState<MediuxUserSet[]>(cached?.sets ?? [])
  const [rev, setRev]             = useState(cached?.rev ?? 0)
  const [status, setStatus]       = useState<CreatorCrawlStatus>(cached?.status ?? 'crawling')
  const [capped, setCapped]       = useState(cached?.capped ?? false)
  const [fetchedAt, setFetchedAt] = useState(cached?.fetchedAt ?? 0)
  const [ready, setReady]         = useState(!!cached)
  const [checking, setChecking]   = useState(false)
  const [rereading, setRereading] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [notice, setNotice]       = useState<string | null>(null)
  const revRef = useRef(rev)
  const countRef = useRef(sets.length)
  useEffect(() => { revRef.current = rev; countRef.current = sets.length }, [rev, sets.length])

  const applySnapshot = useCallback((snap: UserSetsSnapshot) =>
  {
    if (!snap.unchanged)
    {
      setSets(prev => (snap.status === 'crawling' ? appendNew(snap.sets, prev) : snap.sets))
    }
    setRev(snap.rev)
    setStatus(snap.status)
    setCapped(snap.capped)
    setFetchedAt(snap.fetchedAt)
    setChecking(!!snap.checking)
    setRereading(!!snap.rereading)
    if (snap.status === 'error' && !snap.collected) setError(snap.error ?? 'Could not read this creator\'s sets')
    if (snap.collected || snap.status !== 'crawling') setReady(true)
  }, [])

  useEffect(() =>
  {
    let cancelled = false
    const off = window.api.library.onUserSetsChunk((chunk: UserSetsChunk) =>
    {
      if (cancelled || chunk.username.toLowerCase() !== key) return
      if (chunk.reset) setSets(chunk.sets)
      else if (chunk.upsert)
      {
        const ids = new Set(chunk.sets.map(s => s.id))
        setSets(prev => [...chunk.sets, ...prev.filter(s => !ids.has(s.id))])
      }
      else if (chunk.sets.length) setSets(prev => appendNew(prev, chunk.sets))
      setRev(chunk.rev)
      setStatus(chunk.status)
      setCapped(chunk.capped)
      if (chunk.fetchedAt) setFetchedAt(chunk.fetchedAt)
      if (chunk.sets.length || chunk.done) setReady(true)
      if (chunk.done) { setChecking(false); setRereading(false) }
      if (chunk.error)
      {
        if (chunk.collected) setNotice(chunk.error)
        else setError(chunk.error)
      }
    })
    window.api.library.startUserSets({ username, rev: revRef.current || undefined })
      .then(snap => { if (!cancelled) applySnapshot(snap) })
      .catch(err => { if (!cancelled) { setReady(true); if (!countRef.current) setError(errorMessage(err)) } })
    return () => { cancelled = true; off() }
  }, [username, key, applySnapshot])

  useEffect(() =>
  {
    if (ready && sets.length) rememberCatalog(key, { rev, sets, capped, fetchedAt, status })
  }, [key, ready, rev, sets, capped, fetchedAt, status])

  const check = useCallback(() =>
  {
    setNotice(null)
    setError(null)
    setChecking(true)
    window.api.library.refreshUserSets({ username, rev: revRef.current || undefined })
      .then(applySnapshot)
      .catch(err => { setChecking(false); setNotice(`Could not check for new sets: ${errorMessage(err)}`) })
  }, [username, applySnapshot])

  const reread = useCallback(() =>
  {
    setNotice(null)
    setRereading(true)
    window.api.library.rereadUserSets({ username, rev: revRef.current || undefined })
      .then(applySnapshot)
      .catch(err => { setRereading(false); setNotice(`Could not re-read the catalog: ${errorMessage(err)}`) })
  }, [username, applySnapshot])

  return { sets, status, capped, fetchedAt, ready, checking, rereading, error, notice, dismissNotice: () => setNotice(null), check, reread }
}

/** The catalog state and actions `useCreatorCatalog` returns. */
export type CreatorCatalogData = ReturnType<typeof useCreatorCatalog>
