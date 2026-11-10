import { useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AppWindow, CheckCircle2, ChevronDown, ClipboardList, Copy, Download, FolderOpen, Maximize2, Search, Trash2, X,
} from 'lucide-react'
import Segmented from '../../components/ui/Segmented'
import Select from '../../components/ui/Select'
import Menu, { type MenuItem } from '../../components/ui/Menu'
import Button from '../../components/ui/Button'
import Spinner from '../../components/ui/Spinner'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { copyText } from '../../utils/clipboard'
import { LOG_LEVEL_LABELS, formatBytes, formatLogLine, localDay } from '../../../electron/services/logFormat'
import type { LogEntry, LogStatus } from '../../../electron/ipc/types'
import {
  buildRows, countLabel, dayLabel, emptyText, filterEntries, fullTime, matchesQuery, matchesSeverity, mergeLive, timeOf,
  type Severity, type ViewEntry,
} from './logView'
import styles from './LogViewer.module.css'

const PAGE = 1000
const MAX_ROWS = 20000
const NEAR_BOTTOM = 40

const SEVERITY_OPTIONS: Array<{ value: Severity; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'warn', label: 'Warnings and errors' },
  { value: 'error', label: 'Errors' },
]

interface Props
{
  /** drawer docks under the pages; page fills the Logs page; window fills the pop-out window. */
  mode: 'drawer' | 'page' | 'window'
  onClose?: () => void
  onExpand?: () => void
}

function errorText(err: unknown): string
{
  return err instanceof Error ? err.message : String(err)
}

/**
 * Saved and live log lines with a day picker, a severity filter, search,
 * copying, and file actions. Follows new lines while scrolled to the bottom.
 */
export default function LogViewer({ mode, onClose, onExpand }: Props)
{
  const [entries, setEntries] = useState<ViewEntry[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [trimmed, setTrimmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [day, setDay] = useState('latest')
  const [status, setStatus] = useState<LogStatus | null>(null)
  const [severity, setSeverity] = useState<Severity>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [atBottom, setAtBottom] = useState(true)
  const [newCount, setNewCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [isWeb, setIsWeb] = useState(false)

  const dayLabelId = useId()
  const nextId = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const atBottomRef = useRef(true)
  const keepOffset = useRef<number | null>(null)
  const pendingLive = useRef<LogEntry[] | null>(null)
  const followRef = useRef(true)
  const filterRef = useRef<{ severity: Severity; query: string }>({ severity: 'all', query: '' })
  const countRef = useRef(0)

  const follows = day === 'latest' || day === localDay(new Date())
  const pickDays = mode !== 'drawer'

  useEffect(() =>
  {
    followRef.current = follows
    filterRef.current = { severity, query: deferredQuery }
    countRef.current = entries.length
  })

  const announce = useCallback((message: string) =>
  {
    setAnnouncement('')
    setTimeout(() => setAnnouncement(message), 30)
  }, [])

  const refreshStatus = useCallback(() =>
  {
    window.api.log.status().then(setStatus).catch(() => { /* the day picker keeps its last list */ })
  }, [])

  useEffect(() =>
  {
    window.api.app.getEnv().then(env => setIsWeb(!!env.web)).catch(() => { /* assume desktop */ })
    if (pickDays) refreshStatus()
  }, [pickDays, refreshStatus])

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

  const visible = useMemo(() => filterEntries(entries, severity, deferredQuery), [entries, severity, deferredQuery])
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
      announce(`Earlier lines could not be loaded: ${errorText(err)}`)
    }
    finally
    {
      setLoadingEarlier(false)
    }
  }

  async function copyVisible()
  {
    const ok = await copyText(visible.map(formatLogLine).join('\n'))
    if (!ok)
    {
      announce('Copying was blocked by the browser')
      return
    }
    setCopied(true)
    announce(`Copied ${countLabel(visible.length, visible.length)}`)
    setTimeout(() => setCopied(false), 2000)
  }

  async function copyDiagnostics()
  {
    try
    {
      const ok = await copyText(await window.api.log.diagnostics())
      announce(ok ? 'Diagnostics copied. Read them over before posting them publicly.' : 'Copying was blocked by the browser')
    }
    catch (err)
    {
      announce(`Diagnostics could not be read: ${errorText(err)}`)
    }
  }

  async function saveCopy()
  {
    try
    {
      const res = await window.api.log.exportCopy(day === 'latest' ? undefined : { day })
      if (res.saved && res.path) announce(`Saved to ${res.path}`)
    }
    catch (err)
    {
      announce(`The logs could not be saved: ${errorText(err)}`)
    }
  }

  async function clearLogs()
  {
    setConfirmClear(false)
    try
    {
      await window.api.log.clear()
      announce('Logs cleared')
      if (day !== 'latest') setDay('latest')
      reload()
      if (pickDays) refreshStatus()
    }
    catch (err)
    {
      announce(`The logs could not be cleared: ${errorText(err)}`)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>)
  {
    if (!e.currentTarget.contains(e.target as Node)) return
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F'))
    {
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
      return
    }
    if (e.key !== 'Escape') return
    if ((e.target as HTMLElement).closest('[aria-expanded="true"]')) return
    if (e.target === searchRef.current && query)
    {
      e.preventDefault()
      setQuery('')
      return
    }
    if (mode === 'drawer' && onClose)
    {
      e.preventDefault()
      onClose()
    }
  }

  const menuItems: MenuItem[] = [
    { label: 'Copy diagnostics', icon: <ClipboardList size={14} />, onSelect: () => void copyDiagnostics() },
    { label: isWeb ? 'Download logs' : 'Save a copy…', icon: <Download size={14} />, onSelect: () => void saveCopy() },
    ...(isWeb ? [] : [{ label: 'Open log folder', icon: <FolderOpen size={14} />, onSelect: () => void window.api.app.openLogFolder() }]),
    ...(mode === 'window' ? [] : [{ label: 'Open in new window', icon: <AppWindow size={14} />, onSelect: () => void window.api.log.openWindow() }]),
    {
      label: 'Clear logs…',
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () =>
      {
        refreshStatus()
        setConfirmClear(true)
      },
    },
  ]

  const dayOptions = [
    { value: 'latest', label: 'Newest lines' },
    ...(status?.days ?? []).map(d => ({ value: d.day, label: dayLabel(d.day), description: formatBytes(d.bytes) })),
  ]

  const canLoadEarlier = !loading && !error && (trimmed || !!cursor)

  return (
    <section className={`${styles.viewer} ${styles[mode]}`} aria-label="Logs" onKeyDown={onKeyDown} data-log-viewer>
      <div className={styles.toolbar}>
        {mode === 'drawer' && <h2 className={styles.title}>Logs</h2>}
        {pickDays && (
          <div className={styles.daySelect}>
            <span id={dayLabelId} className={styles.srOnly}>Day</span>
            <Select options={dayOptions} value={day} onChange={pickDay} placeholder="Newest lines" ariaLabelledBy={dayLabelId} />
          </div>
        )}
        <Segmented options={SEVERITY_OPTIONS} value={severity} onChange={setSeverity} ariaLabel="Show" />
        <label className={styles.search}>
          <Search size={13} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search logs"
            aria-label="Search logs"
            spellCheck={false}
          />
        </label>
        <span className={styles.spacer} />
        <span className={styles.count} aria-live="off">{loading ? '' : countLabel(visible.length, entries.length)}</span>
        <div className={styles.actions}>
          <Button
            variant="ghost" size="sm"
            icon={copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
            onClick={() => void copyVisible()}
            disabled={!visible.length}
            title="Copy the lines shown, as plain text"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Menu label="More log actions" items={menuItems} />
          {onExpand && (
            <Button variant="ghost" size="sm" icon={<Maximize2 size={13} />} onClick={onExpand} aria-label="Open the full Logs page" title="Open the full Logs page" />
          )}
          {onClose && (
            <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={onClose} aria-label="Close logs" title="Close logs (Esc)" />
          )}
        </div>
      </div>

      <div className={styles.bodyWrap}>
        <div
          ref={scrollRef}
          className={styles.body}
          onScroll={onScroll}
          role="log"
          aria-live="off"
          aria-label="Log lines"
          aria-busy={loading}
          tabIndex={0}
          data-selectable
        >
          {canLoadEarlier && (
            <button type="button" className={styles.earlier} onClick={() => void loadEarlier()} disabled={loadingEarlier}>
              {loadingEarlier ? <Spinner size="xs" color="current" /> : null}
              {trimmed ? 'Reload the newest lines' : loadingEarlier ? 'Loading earlier lines…' : 'Load earlier lines'}
            </button>
          )}

          {loading ? (
            <div className={styles.state}><Spinner size="sm" /> Loading logs…</div>
          ) : error ? (
            <div className={styles.state}>
              <span>The logs could not be read: {error}</span>
              <Button variant="secondary" size="sm" onClick={reload}>Try again</Button>
            </div>
          ) : rows.length === 0 ? (
            <div className={styles.state}>
              <span>{emptyText(severity, deferredQuery, entries.length)}</span>
              {deferredQuery.trim() ? (
                <Button variant="secondary" size="sm" onClick={() => setQuery('')}>Clear search</Button>
              ) : severity !== 'all' && entries.length ? (
                <Button variant="secondary" size="sm" onClick={() => setSeverity('all')}>Show all lines</Button>
              ) : null}
            </div>
          ) : (
            rows.map(row =>
            {
              if (row.kind === 'day')
              {
                return (
                  <div key={row.key} className={styles.dayRow}>
                    <span>{dayLabel(row.day)}</span>
                  </div>
                )
              }
              const e = row.entry
              if (row.kind === 'start')
              {
                return (
                  <div key={row.key} className={styles.startRow}>
                    <span className={styles.time} title={fullTime(e.ts)}>{timeOf(e.ts)}</span>
                    <span className={styles.startText}>{e.message}</span>
                  </div>
                )
              }
              const meta = e.meta && Object.keys(e.meta).length ? JSON.stringify(e.meta) : ''
              return (
                <div key={row.key} className={styles.row} data-level={e.level}>
                  <span className={styles.time} title={fullTime(e.ts)}>{timeOf(e.ts)}</span>
                  <span className={styles.level} data-level={e.level}>{LOG_LEVEL_LABELS[e.level] ?? e.level.toUpperCase()}</span>
                  <span className={styles.module} title={e.module}>{e.module}</span>
                  <span className={styles.message}>
                    {e.message}
                    {meta && <span className={styles.meta}> {meta}</span>}
                  </span>
                </div>
              )
            })
          )}
        </div>

        {!atBottom && newCount > 0 && (
          <button type="button" className={styles.newPill} onClick={scrollToBottom}>
            <ChevronDown size={13} aria-hidden />
            {newCount.toLocaleString()} new {newCount === 1 ? 'line' : 'lines'}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear all logs?"
        body={`Every saved log file is deleted${status ? `, ${formatBytes(status.totalBytes)} in all` : ''}. Logs are what a bug report needs, so save a copy first if something went wrong.`}
        confirmLabel="Clear logs"
        onConfirm={() => void clearLogs()}
        onCancel={() => setConfirmClear(false)}
      />

      <p className={styles.srOnly} aria-live="polite">{announcement}</p>
    </section>
  )
}
