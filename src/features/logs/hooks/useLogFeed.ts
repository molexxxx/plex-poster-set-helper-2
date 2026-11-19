import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { localDay } from '../../../../electron/services/logFormat'
import type { LogEntry } from '../../../../electron/ipc/types'
import { buildRows, errorText, filterEntries, matchesQuery, matchesSeverity, mergeLive, type Severity, type ViewEntry } from '../logView'
import type { NoticeTone } from './useLogNotice'

const PAGE = 1000
const MAX_ROWS = 20000
const NEAR_BOTTOM = 40

/**
 * The lines the log viewer shows: the saved history of the picked day, live
 * lines while it shows today, and earlier pages on request. The list stays
 * scrolled to the bottom while the user is there, and counts the new lines
 * that pass the filters while they are not.
 *
 * @param severity - The severity filter.
 * @param query - The search text, deferred.
 * @param announce - Speaks a message to screen readers.
 * @param notify - Shows a notice over the lines.
 * @returns The loaded entries, the ones that show and their rows, the load
 *   state, the scroll ref with its handlers, and the day with `pickDay`,
 *   `reload`, and `loadEarlier`.
 */
export function useLogFeed(
  severity: Severity,
  query: string,
  announce: (message: string) => void,
  notify: (text: string, tone?: NoticeTone) => void,
)
{
  const [entries, setEntries] = useState<ViewEntry[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [trimmed, setTrimmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [day, setDay] = useState('latest')
  const [atBottom, setAtBottom] = useState(true)
  const [newCount, setNewCount] = useState(0)

  const nextId = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const keepOffset = useRef<number | null>(null)
  const pendingLive = useRef<LogEntry[] | null>(null)
  const followRef = useRef(true)
  const filterRef = useRef<{ severity: Severity; query: string }>({ severity: 'all', query: '' })
  const countRef = useRef(0)

  const follows = day === 'latest' || day === localDay(new Date())

  useEffect(() =>
  {
    followRef.current = follows
    filterRef.current = { severity, query }
    countRef.current = entries.length
  })

  useEffect(() =>
  {
    let cancelled = false
    pendingLive.current = []
    window.api.log.getHistory({ day: day === 'latest' ? undefined : day, limit: PAGE })
      .then(page =>
      {
        if (cancelled) return
        const merged = mergeLive(page.entries, followRef.current ? pendingLive.current ?? [] : [])
        atBottomRef.current = true
        setAtBottom(true)
        setNewCount(0)
        setEntries(merged.map(e => ({ ...e, id: nextId.current++ })))
        setCursor(page.cursor)
        setTrimmed(false)
        setError(null)
      })
      .catch(err =>
      {
        if (!cancelled) setError(errorText(err))
      })
      .finally(() =>
      {
        if (cancelled) return
        pendingLive.current = null
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [day, reloadNonce])

  useEffect(() =>
  {
    return window.api.log.onEntry((entry: LogEntry) =>
    {
      if (!followRef.current) return
      if (pendingLive.current)
      {
        pendingLive.current.push(entry)
        return
      }
      const row: ViewEntry = { ...entry, id: nextId.current++ }
      if (countRef.current >= MAX_ROWS) setTrimmed(true)
      setEntries(prev => prev.length >= MAX_ROWS ? [...prev.slice(prev.length - MAX_ROWS + 1), row] : [...prev, row])
      const { severity: s, query: q } = filterRef.current
      if (!atBottomRef.current && matchesSeverity(entry, s) && matchesQuery(entry, q))
      {
        setNewCount(c =>
        {
          if (c === 0) announce('New log lines below')
          return c + 1
        })
      }
    })
  }, [announce])

  const visible = useMemo(() => filterEntries(entries, severity, query), [entries, severity, query])
  const rows = useMemo(() => buildRows(visible), [visible])

  useLayoutEffect(() =>
  {
    const el = scrollRef.current
    if (!el) return
    if (keepOffset.current != null)
    {
      el.scrollTop = el.scrollHeight - keepOffset.current
      keepOffset.current = null
    }
    else if (atBottomRef.current)
    {
      el.scrollTop = el.scrollHeight
    }
  }, [rows, loading])

  function onScroll()
  {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
    atBottomRef.current = near
    setAtBottom(near)
    if (near) setNewCount(0)
  }

  function scrollToBottom()
  {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
    setNewCount(0)
  }

  function reload()
  {
    setLoading(true)
    setReloadNonce(n => n + 1)
  }

  function pickDay(next: string)
  {
    if (next === day) return
    setLoading(true)
    setDay(next)
  }

  async function loadEarlier()
  {
    if (trimmed)
    {
      reload()
      return
    }
    if (!cursor) return
    setLoadingEarlier(true)
    try
    {
      const page = await window.api.log.getHistory({ day: day === 'latest' ? undefined : day, cursor, limit: PAGE })
      const el = scrollRef.current
      keepOffset.current = el ? el.scrollHeight - el.scrollTop : null
      setEntries(prev => [...page.entries.map(e => ({ ...e, id: nextId.current++ })), ...prev])
      setCursor(page.cursor)
    }
    catch (err)
    {
      notify(`Earlier lines could not be loaded: ${errorText(err)}`, 'error')
    }
    finally
    {
      setLoadingEarlier(false)
    }
  }

  return {
    entries, visible, rows, loading, loadingEarlier, error, trimmed, cursor,
    day, setDay, pickDay, reload, loadEarlier,
    scrollRef, onScroll, scrollToBottom, atBottom, newCount,
  }
}
