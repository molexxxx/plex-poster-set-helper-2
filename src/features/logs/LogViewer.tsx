import { useDeferredValue, useRef, useState } from 'react'
import { AppWindow, ChevronDown, ClipboardList, Download, FolderOpen, Trash2 } from 'lucide-react'
import type { MenuItem } from '../../components/ui/Menu'
import Button from '../../components/ui/Button'
import Spinner from '../../components/ui/Spinner'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { formatBytes } from '../../../electron/services/logFormat'
import { countLabel, dayLabel, emptyText, type Severity } from './logView'
import { useLogNotice } from './hooks/useLogNotice'
import { useLogFeed } from './hooks/useLogFeed'
import { useLogActions } from './hooks/useLogActions'
import LogToolbar from './components/LogToolbar'
import LogLines from './components/LogLines'
import LogNotice from './components/LogNotice'
import shared from './components/logShared.module.css'
import styles from './LogViewer.module.css'

interface Props
{
  /** drawer docks under the pages; page fills the Logs page; window fills the pop-out window. */
  mode: 'drawer' | 'page' | 'window'
  onClose?: () => void
  onExpand?: () => void
}

/**
 * Saved and live log lines with a day picker, a severity filter, search,
 * copying, and file actions. Follows new lines while scrolled to the bottom.
 */
export default function LogViewer({ mode, onClose, onExpand }: Props)
{
  const [severity, setSeverity] = useState<Severity>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const searchRef = useRef<HTMLInputElement>(null)
  const pickDays = mode !== 'drawer'

  const { notice, notify, dismissNotice, announcement, announce } = useLogNotice()
  const {
    entries, visible, rows, loading, loadingEarlier, error, trimmed, cursor,
    day, setDay, pickDay, reload, loadEarlier, scrollRef, onScroll, scrollToBottom, atBottom, newCount,
  } = useLogFeed(severity, deferredQuery, announce, notify)
  const {
    status, isWeb, copied, confirmClear, setConfirmClear, refreshStatus, copyVisible, copyDiagnostics, saveCopy, clearLogs,
  } = useLogActions({ pickDays, day, setDay, reload, visible, notify, announce })

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
      <LogToolbar
        mode={mode}
        pickDays={pickDays}
        dayOptions={dayOptions}
        day={day}
        onPickDay={pickDay}
        severity={severity}
        onSeverity={setSeverity}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        countText={loading ? '' : countLabel(visible.length, entries.length)}
        copied={copied}
        canCopy={!!visible.length}
        onCopy={() => void copyVisible()}
        menuItems={menuItems}
        onExpand={onExpand}
        onClose={onClose}
      />

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
            <LogLines rows={rows} />
          )}
        </div>

        <div className={styles.noticeSlot} role="status" aria-live="polite">
          {notice && <LogNotice notice={notice} onDismiss={dismissNotice} />}
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

      <p className={shared.srOnly} aria-live="polite">{announcement}</p>
    </section>
  )
}
