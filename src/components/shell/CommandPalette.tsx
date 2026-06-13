import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, ScrollText, FolderOpen, RefreshCw, PlugZap, Link2, UserPlus, Users,
  User, Server, SlidersHorizontal, Filter, Sliders, Globe, Wrench, Package,
  Film, Tv, Star, CalendarClock, CornerDownLeft,
} from 'lucide-react'
import type { NavTab } from '../../app/App'
import type { LibrarySection, ScheduledJob, LibraryItem } from '../../../electron/ipc/types'
import { NAV_ENTRIES } from './navModel'
import { useScrapeStore } from '../../features/scrape/useScrapeStore'
import { useNavStore } from '../../app/navStore'
import styles from './CommandPalette.module.css'

interface Command {
  id: string
  label: string
  group: string
  icon: ReactNode
  /** Secondary line shown under the label. */
  sub?: string
  /** Extra text matched by search. */
  keywords?: string
  /** Shown in the default (empty-query) view. */
  defaultVisible?: boolean
  /** Set false to keep transient commands (URL suggestions) out of recents. */
  recentable?: boolean
  run: () => void
}

interface Entry { cmd: Command; group: string }

const GROUP_ORDER = ['Suggestion', 'Recent', 'In your library', 'Go to', 'Quick action', 'Settings', 'Schedules', 'Creators', 'Libraries']

const SUPPORTED = /theposterdb\.com|mediux\.pro/i
const URL_LIKE = /https?:\/\/|theposterdb\.com|mediux\.pro/i
const RECENTS_KEY = 'cmdPalette.recents'

/** True when the query is a pasteable poster source URL (not a user profile). */
function isSupportedUrl(q: string): boolean {
  try {
    return SUPPORTED.test(new URL(q.trim()).hostname)
  } catch {
    return false
  }
}

function matchText(c: Command, q: string): boolean {
  return c.label.toLowerCase().includes(q)
    || (c.keywords?.toLowerCase().includes(q) ?? false)
    || (c.sub?.toLowerCase().includes(q) ?? false)
}

function loadRecents(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
    return Array.isArray(r) ? r : []
  } catch {
    return []
  }
}

const SETTINGS_ITEMS: Array<{ anchor: string; label: string; keywords: string; icon: ReactNode }> = [
  { anchor: 'plex-account',   label: 'Plex Account',                keywords: 'sign in account disconnect auth plex token', icon: <User size={16} /> },
  { anchor: 'plex-server',    label: 'Plex Server URL',             keywords: 'server url address connect baseurl', icon: <Server size={16} /> },
  { anchor: 'libraries',      label: 'Libraries (include / exclude)', keywords: 'libraries movies tv exclude include sections', icon: <SlidersHorizontal size={16} /> },
  { anchor: 'mediux-filters', label: 'MediUX Asset Types',          keywords: 'posters backdrops title cards filters asset types', icon: <Filter size={16} /> },
  { anchor: 'scraper',        label: 'Scraper - Max Workers',       keywords: 'scraper workers parallel speed concurrency', icon: <Sliders size={16} /> },
  { anchor: 'tmdb',           label: 'TMDB API Key',                keywords: 'tmdb api key hama tvdb imdb agent', icon: <Film size={16} /> },
  { anchor: 'browser',        label: 'Browser Engine (Chromium)',   keywords: 'browser chromium playwright install engine', icon: <Globe size={16} /> },
  { anchor: 'general',        label: 'General - Tray & Logs',       keywords: 'tray notification append logs general', icon: <Wrench size={16} /> },
  { anchor: 'application',    label: 'Application & Updates',       keywords: 'version update logs application about', icon: <Package size={16} /> },
]

interface Props {
  open: boolean
  onClose: () => void
  onNavigate: (tab: NavTab) => void
  onToggleLogs: () => void
  plexConnected: boolean
  isMac: boolean
}

/** Ctrl/⌘F palette: jump to pages, run actions, deep-search settings/schedules/creators/libraries, or paste a URL. */
export default function CommandPalette({ open, onClose, onNavigate, onToggleLogs, plexConnected, isMac }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [recents, setRecents] = useState<string[]>(loadRecents)
  const [subs, setSubs] = useState<string[]>([])
  const [sections, setSections] = useState<LibrarySection[]>([])
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [libResults, setLibResults] = useState<{ item: LibraryItem; section: LibrarySection }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset and refresh live data each time the palette opens.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(0)
    setRecents(loadRecents())
    requestAnimationFrame(() => inputRef.current?.focus())
    window.api.config.get().then(c => setSubs(c.mediuxSubscriptions ?? [])).catch(() => setSubs([]))
    window.api.library.sections().then(setSections).catch(() => setSections([]))
    window.api.scheduler.list().then(setJobs).catch(() => setJobs([]))
  }, [open])

  // Live cross-library search of Plex items: selecting one opens its MediUX sets.
  useEffect(() => {
    const q = query.trim()
    if (!open || !plexConnected || sections.length === 0 || q.length < 2 || URL_LIKE.test(q)) {
      setLibResults([])
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      Promise.all(
        sections.map(s =>
          window.api.library.items({ sectionKey: s.key, offset: 0, limit: 5, search: q })
            .then(res => (res.items as LibraryItem[]).map(item => ({ item, section: s })))
            .catch(() => [] as { item: LibraryItem; section: LibrarySection }[]),
        ),
      ).then(perSection => {
        if (!cancelled) setLibResults(perSection.flat().slice(0, 8))
      })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, open, sections, plexConnected])

  function record(id: string) {
    setRecents(prev => {
      const next = [id, ...prev.filter(r => r !== id)].slice(0, 8)
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)) } catch { /* storage may be unavailable */ }
      return next
    })
  }

  function exec(cmd: Command) {
    if (cmd.recentable !== false) record(cmd.id)
    cmd.run()
  }

  const commands = useMemo<Command[]>(() => {
    const q = query.trim()
    const list: Command[] = []

    // Smart URL handling: a creator profile offers follow/browse; any other
    // supported URL offers a scrape.
    const userMatch = q.match(/mediux\.pro\/user\/([^/?#]+)/i)
    if (userMatch) {
      const name = userMatch[1].replace(/^@/, '')
      list.push({
        id: `follow:${name.toLowerCase()}`, group: 'Suggestion', recentable: false,
        label: `Follow @${name}`, sub: 'Add to your MediUX creators and open their sets',
        icon: <UserPlus size={16} />,
        run: async () => {
          try {
            const c = await window.api.config.get()
            const cur = c.mediuxSubscriptions ?? []
            if (!cur.some(s => s.toLowerCase() === name.toLowerCase())) {
              await window.api.config.set({ mediuxSubscriptions: [...cur, name] })
            }
          } catch { /* config write best-effort */ }
          useNavStore.getState().goLibrary({ creator: name })
          onNavigate('library'); onClose()
        },
      })
      list.push({
        id: `browse:${name.toLowerCase()}`, group: 'Suggestion', recentable: false,
        label: `Browse @${name}'s sets`, sub: 'Open this creator in the Library Browser',
        icon: <Users size={16} />,
        run: () => { useNavStore.getState().goLibrary({ creator: name }); onNavigate('library'); onClose() },
      })
    } else if (isSupportedUrl(q)) {
      list.push({
        id: 'scrape-url', group: 'Suggestion', recentable: false,
        label: `Scrape "${q}"`, sub: 'Queue this URL in Manual Import',
        icon: <Link2 size={16} />,
        run: () => { useScrapeStore.getState().addUrls([q]); onNavigate('manual'); onClose() },
      })
    }

    // Live Plex library matches: open the item's MediUX sets panel.
    for (const { item, section } of libResults) {
      list.push({
        id: `item:${item.key}`, group: 'In your library', recentable: false,
        label: item.year ? `${item.title} (${item.year})` : item.title,
        sub: `${section.title} · open MediUX sets`,
        keywords: item.title,
        icon: item.type === 'movie' ? <Film size={16} /> : <Tv size={16} />,
        run: () => { useNavStore.getState().goLibrary({ item, section: section.key }); onNavigate('library'); onClose() },
      })
    }

    // Pages
    for (const e of NAV_ENTRIES) {
      list.push({
        id: `nav:${e.id}`, group: 'Go to', defaultVisible: true,
        label: e.label, sub: e.hint, keywords: e.hint,
        icon: <e.Icon size={16} />,
        run: () => { onNavigate(e.id); onClose() },
      })
    }

    // Quick actions
    list.push({ id: 'act:logs', group: 'Quick action', defaultVisible: true, label: 'Toggle Logs', keywords: 'logs console output drawer', icon: <ScrollText size={16} />, run: () => { onToggleLogs(); onClose() } })
    if (!plexConnected) {
      list.push({ id: 'act:connect', group: 'Quick action', defaultVisible: true, label: 'Connect to Plex', keywords: 'plex sign in auth login server connect', icon: <PlugZap size={16} />, run: () => { useNavStore.getState().goSettings('plex-account'); onNavigate('settings'); onClose() } })
    }
    list.push({ id: 'act:logfolder', group: 'Quick action', defaultVisible: true, label: 'Open Log Folder', keywords: 'logs files folder disk open', icon: <FolderOpen size={16} />, run: () => { window.api.app.openLogFolder(); onClose() } })
    list.push({ id: 'act:update', group: 'Quick action', defaultVisible: true, label: 'Check for Updates', keywords: 'update version upgrade release', icon: <RefreshCw size={16} />, run: () => { window.api.app.checkUpdate(); onClose() } })

    // Settings (deep links)
    for (const s of SETTINGS_ITEMS) {
      list.push({
        id: `set:${s.anchor}`, group: 'Settings', label: s.label, sub: 'Settings', keywords: s.keywords, icon: s.icon,
        run: () => { useNavStore.getState().goSettings(s.anchor); onNavigate('settings'); onClose() },
      })
    }

    // Schedules
    for (const j of jobs) {
      list.push({
        id: `job:${j.id}`, group: 'Schedules', label: j.name,
        sub: `${j.urls.length} URL${j.urls.length !== 1 ? 's' : ''} · ${j.enabled ? 'enabled' : 'disabled'}`,
        keywords: `schedule job cron ${j.name}`, icon: <CalendarClock size={16} />,
        run: () => { useNavStore.getState().goScheduler(j.id); onNavigate('scheduler'); onClose() },
      })
    }

    // Followed creators
    for (const name of subs) {
      list.push({
        id: `creator:${name.toLowerCase()}`, group: 'Creators', label: name, sub: 'MediUX creator',
        keywords: `creator mediux follow ${name}`, icon: <Star size={16} />,
        run: () => { useNavStore.getState().goLibrary({ creator: name }); onNavigate('library'); onClose() },
      })
    }

    // Libraries
    for (const sec of sections) {
      list.push({
        id: `lib:${sec.key}`, group: 'Libraries', label: sec.title, sub: sec.type === 'movie' ? 'Movies' : 'TV Shows',
        keywords: `library ${sec.title} ${sec.type === 'movie' ? 'movies' : 'tv shows'}`,
        icon: sec.type === 'movie' ? <Film size={16} /> : <Tv size={16} />,
        run: () => { useNavStore.getState().goLibrary({ section: sec.key }); onNavigate('library'); onClose() },
      })
    }

    return list
  }, [query, plexConnected, subs, sections, jobs, libResults, onNavigate, onToggleLogs, onClose])

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim().toLowerCase()
    let list: Entry[]
    if (!q) {
      const recentCmds = recents
        .map(id => commands.find(c => c.id === id))
        .filter((c): c is Command => !!c)
        .slice(0, 5)
      const recentIds = new Set(recentCmds.map(c => c.id))
      list = [
        ...recentCmds.map(cmd => ({ cmd, group: 'Recent' })),
        ...commands.filter(c => c.defaultVisible && !recentIds.has(c.id)).map(cmd => ({ cmd, group: cmd.group })),
      ]
    } else {
      list = commands
        .filter(c => c.group === 'Suggestion' || c.group === 'In your library' || matchText(c, q))
        .map(cmd => ({ cmd, group: cmd.group }))
    }
    return list.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  }, [commands, query, recents])

  // Clamp at render so a shrinking list never leaves the highlight out of range.
  const activeIndex = entries.length ? Math.min(selected, entries.length - 1) : 0

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, entries.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); const entry = entries[activeIndex]; if (entry) exec(entry.cmd) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entries, activeIndex, onClose])

  // Scroll the active row into view on keyboard navigation.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const queryEmpty = query.trim().length === 0

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={onClose}
        >
          <motion.div
            className={styles.panel}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.2 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className={styles.searchRow}>
              <Search size={16} className={styles.searchIcon} />
              <input
                ref={inputRef}
                className={styles.input}
                placeholder="Search library, pages, actions, or paste a URL…"
                value={query}
                onChange={e => { setQuery(e.target.value); setSelected(0) }}
                spellCheck={false}
              />
              <span className={styles.escHint}>esc</span>
            </div>

            {queryEmpty && (
              <div className={styles.hintBar}>
                Type a movie or show to open its MediUX sets. Or jump to a page, run an action, search settings / schedules / creators, or paste a posterdb / mediux URL.
              </div>
            )}

            <div className={styles.list} ref={listRef}>
              {entries.length === 0 && <div className={styles.empty}>No matches for “{query.trim()}”</div>}
              {entries.map(({ cmd, group }, i) => {
                const showHeader = i === 0 || entries[i - 1].group !== group
                return (
                  <div key={`${group}:${cmd.id}`}>
                    {showHeader && <div className={styles.groupHeader}>{group}</div>}
                    <button
                      type="button"
                      data-index={i}
                      className={`${styles.cmd} ${i === activeIndex ? styles.cmdActive : ''}`}
                      onMouseMove={() => setSelected(i)}
                      onClick={() => exec(cmd)}
                    >
                      <span className={styles.cmdIcon}>{cmd.icon}</span>
                      <span className={styles.cmdText}>
                        <span className={styles.cmdLabel}>{cmd.label}</span>
                        {cmd.sub && <span className={styles.cmdSub}>{cmd.sub}</span>}
                      </span>
                      {i === activeIndex && <CornerDownLeft size={13} className={styles.enterHint} />}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className={styles.footer}>
              <span><kbd className={styles.fkbd}>↑</kbd><kbd className={styles.fkbd}>↓</kbd> navigate</span>
              <span><kbd className={styles.fkbd}>↵</kbd> select</span>
              <span><kbd className={styles.fkbd}>esc</kbd> close</span>
              <span className={styles.footerRight}>{isMac ? '⌘' : 'Ctrl'}+F</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
