import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, FolderOpen, Trash2, ChevronDown } from 'lucide-react'
import type { LogEntry } from '../../../electron/ipc/types'
import styles from './LogDrawer.module.css'


const LEVEL_COLORS: Record<string, string> = {
  error:   '#f87171',
  warn:    '#fbbf24',
  info:    '#60a5fa',
  success: '#34d399',
  session: '#a78bfa',
  scrape:  '#38bdf8',
  debug:   '#9ca3af',
  verbose: '#6b7280',
}

const LEVEL_LABELS: Record<string, string> = {
  error: 'ERR', warn: 'WARN', info: 'INFO', success: 'OK',
  session: 'SESS', scrape: 'SCRP', debug: 'DBG', verbose: 'VERB',
}

const FILTERABLE_LEVELS = ['error', 'warn', 'info', 'success', 'session', 'scrape', 'debug'] as const

const MIN_H = 120
const MAX_H = 640


interface Props {
  open: boolean
  onClose: () => void
}

/** Resizable bottom drawer streaming live log entries with level filtering. */
export default function LogDrawer({ open, onClose }: Props) {
  const [entries, setEntries]       = useState<LogEntry[]>([])
  const [height, setHeight]         = useState(300)
  const [levelFilter, setFilter]    = useState<string | null>(null)
  const [atBottom, setAtBottom]     = useState(true)
  const [newCount, setNewCount]     = useState(0)

  const scrollRef   = useRef<HTMLDivElement>(null)
  const heightRef   = useRef(300)
  const atBottomRef = useRef(true)


  useEffect(() => {
    window.api.config.get().then(cfg => {
      const h = Math.max(MIN_H, Math.min(MAX_H, cfg.logDrawerHeight ?? 300))
      setHeight(h)
      heightRef.current = h
    }).catch(() => {})
  }, [])


  useEffect(() => {
    if (!open) return
    window.api.log.getHistory().then((hist: LogEntry[]) => {
      setEntries(hist)
    }).catch(() => {})
  }, [open])


  useEffect(() => {
    if (!open) return
    const unsub = window.api.log.onEntry((entry: LogEntry) => {
      setEntries(prev => {
        const next = [...prev, entry]
        return next.length > 1000 ? next.slice(-1000) : next
      })
      if (!atBottomRef.current) {
        setNewCount(c => c + 1)
      }
    })
    return () => { unsub() }
  }, [open])


  useEffect(() => {
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      setNewCount(0)
    }
  }, [entries, atBottom])

  useEffect(() => {
    if (open) {
      const id = setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
      }, 60)
      return () => clearTimeout(id)
    }
  }, [open])

  function onScroll() {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const near = scrollHeight - scrollTop - clientHeight < 40
    atBottomRef.current = near
    setAtBottom(near)
    if (near) setNewCount(0)
  }

  function scrollToBottom() {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
    setNewCount(0)
  }


  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startH = heightRef.current

    function onMove(ev: MouseEvent) {
      const next = Math.max(MIN_H, Math.min(MAX_H, startH + (startY - ev.clientY)))
      heightRef.current = next
      setHeight(next)
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.api.config.set({ logDrawerHeight: heightRef.current }).catch(() => {})
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }


  const filtered = levelFilter ? entries.filter(e => e.level === levelFilter) : entries

  function fmtTime(ts: string) {
    try { return new Date(ts).toTimeString().slice(0, 8) }
    catch { return ts.slice(11, 19) }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.drawer}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.26 }}
        >
          {/* Drag handle */}
          <div className={styles.dragHandle} onMouseDown={startDrag}>
            <span className={styles.dragGrip} />
          </div>

          {/* Toolbar */}
          <div className={styles.toolbar}>
            <span className={styles.toolbarTitle}>Logs</span>

            <div className={styles.levelFilters}>
              {FILTERABLE_LEVELS.map(lvl => (
                <button
                  key={lvl}
                  className={`${styles.levelPill} ${levelFilter === lvl ? styles.levelPillActive : ''}`}
                  style={levelFilter === lvl ? {
                    color: LEVEL_COLORS[lvl],
                    borderColor: LEVEL_COLORS[lvl],
                    background: `${LEVEL_COLORS[lvl]}18`,
                  } : {}}
                  onClick={() => setFilter(l => l === lvl ? null : lvl)}
                >
                  {LEVEL_LABELS[lvl]}
                </button>
              ))}
            </div>

            <div className={styles.toolbarRight}>
              <span className={styles.entryCount}>{filtered.length}</span>
              <button
                className={styles.iconBtn}
                title="Open log folder"
                onClick={() => window.api.app.openLogFolder()}
              >
                <FolderOpen size={13} />
              </button>
              <button
                className={styles.iconBtn}
                title="Clear logs and truncate the log file"
                onClick={() => { window.api.log.clear().catch(() => {}); setEntries([]); setNewCount(0) }}
              >
                <Trash2 size={13} />
              </button>
              <button className={styles.iconBtn} title="Close" onClick={onClose}>
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Log body */}
          <div className={styles.logBody} ref={scrollRef} onScroll={onScroll}>
            {filtered.length === 0 ? (
              <div className={styles.emptyMsg}>No log entries yet.</div>
            ) : (
              filtered.map((entry, i) => (
                <div key={i} className={`${styles.logRow} ${styles[`level_${entry.level}`] ?? ''}`}>
                  <span className={styles.logTs}>{fmtTime(entry.ts)}</span>
                  <span
                    className={styles.logLevel}
                    style={{ color: LEVEL_COLORS[entry.level] ?? 'inherit' }}
                  >
                    {(LEVEL_LABELS[entry.level] ?? entry.level.toUpperCase()).padEnd(4)}
                  </span>
                  <span className={styles.logModule}>[{entry.module}]</span>
                  <span className={styles.logMsg}>{entry.message}</span>
                  {entry.meta && Object.keys(entry.meta).length > 0 && (
                    <span className={styles.logMeta}>{JSON.stringify(entry.meta)}</span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Scroll-to-bottom button */}
          <AnimatePresence>
            {!atBottom && newCount > 0 && (
              <motion.button
                className={styles.scrollBtn}
                onClick={scrollToBottom}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.14 }}
              >
                <ChevronDown size={12} />
                {newCount} new
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
