import { useEffect, useRef, useState, useCallback, useMemo, createContext, useContext } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X, Upload, Check, AlertCircle, Loader2, User, Image as ImageIcon, ChevronDown, ChevronUp, Plus, UserPlus, Trash2, CalendarClock, CheckCircle2, RefreshCw, Star, Library, Download, LayoutGrid, Users, Film, Tv, Layers, ArrowUp, ArrowDown, Eye, EyeOff, ExternalLink, Link2, Link2Off, Circle } from 'lucide-react'
import type { ScheduledJob } from '../../../electron/ipc/types'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Select, { type SelectOption } from '../../components/ui/Select'
import Checkbox from '../../components/ui/Checkbox'
import Spinner from '../../components/ui/Spinner'
import Lightbox, { type LightboxImage } from '../../components/ui/Lightbox'
import Pager from '../../components/ui/Pager'
import PlexConnectBanner from '../../components/ui/PlexConnectBanner'
import { groupPosters, posterFileType, setKey, ALL_TYPES, SOURCE_LABEL, SOURCE_SHORT, defaultSetApplyScope, collectionName, variantKey, variantClusters, defaultVariant, resolveVariants, type ApplyContext, type FileType, type SetApplyScope, type SetSource } from '../../utils/posterGroups'
import { useCreatorPrefs, parseCreatorInput, type CreatorState } from '../../utils/creatorPrefs'
import { arrangeSets, byPopularity, mergeLinkedSets, uploaderValue } from '../../utils/librarySets'
import { recordApplied, recordAppliedBatch, recordAppliedQuietly, appliedKey, loadAppliedIndex, type AppliedIndex } from '../../utils/appliedTracker'
import { uuid } from '../../utils/uuid'
import { errorMessage } from '../../utils/errorMessage'
import {
  DEFAULT_QUICK_CRON, appliedUploaders, coveringJob, creatorSyncUrl, describeCron, describeQuickSync, planQuickSync, posterSlot, scheduleCoverage,
  type AppliedUploader,
} from '../../../electron/services/scheduleUtils'
import { useAppContext } from '../../app/AppContext'
import { useNavStore } from '../../app/navStore'
import type {
  LibrarySection, LibraryItem, PosterSetSummary, BrowseSetsRes, PosterInfo, MediuxUserSet, AppliedRecord,
  PlexArtSlot, LibrarySort, SortDir, LibraryArtFilter, LibraryStatusFilter, LinkedItemRef,
} from '../../../electron/ipc/types'
import styles from './LibraryPage.module.css'

const PAGE_SIZE = 60

/** Library Browser grid sort options and their labels. */
const SORT_LABEL: Record<LibrarySort, string> = {
  recentlyAdded: 'Recently Added',
  title: 'Title',
  year: 'Release Year',
  lastPlayed: 'Last Played',
}
/** Collections only support title / date-added ordering. */
const COLLECTION_SORTS: LibrarySort[] = ['recentlyAdded', 'title']
const ALL_SORTS: LibrarySort[] = ['recentlyAdded', 'title', 'year', 'lastPlayed']
/** Sentinel activeKey for the movie-collections browser tab. */
const COLLECTIONS_TAB_KEY = '__collections__'

/** Grid art filter as the dropdown holds it; creators carry their site so the same name on two sites stays two entries. */
type ArtFilterValue = 'all' | 'none' | 'applied' | 'unscheduled' | `uploader:${SetSource}:${string}`

/**
 * Converts the dropdown value into the request filter.
 *
 * @param value - The selected option.
 * @returns The filter, or undefined for "all".
 */
function toArtFilter(value: ArtFilterValue): LibraryArtFilter | undefined {
  if (value === 'all') return undefined
  if (value === 'none' || value === 'applied' || value === 'unscheduled') return { kind: value }
  const m = value.match(/^uploader:(mediux|posterdb):(.*)$/)
  return m ? { kind: 'uploader', uploader: m[2], source: m[1] as SetSource } : undefined
}

interface BrowseCacheEntry {
  sets: PosterSetSummary[]
  tmdbId?: string
  tmdbMissing?: boolean
  collectionMembers?: LibraryItem[]
  sourceErrors?: Partial<Record<SetSource, string>>
  /** ThePosterDB has more sets than were read; the page to continue on. */
  posterdbUrl?: string
  fetchedAt: number
}

/** The sites the panel asks, in the order their sets are listed. */
const SOURCES: SetSource[] = ['mediux', 'posterdb']

/**
 * A site's own failure to answer, as opposed to the panel-level notices
 * (no TMDB id, no movies) that describe the title rather than the site.
 *
 * @param src - The site that was asked.
 * @param res - Its answer.
 * @returns The reason it could not be searched, if any.
 */
function sourceFailure(src: SetSource, res: BrowseSetsRes): string | undefined {
  if (res.sourceErrors?.[src]) return res.sourceErrors[src]
  return res.error && res.error !== 'no_tmdb' && res.error !== 'no_movies' ? res.error : undefined
}
const browseSetsCache = new Map<string, BrowseCacheEntry>()
const BROWSE_CACHE_TTL = 30 * 60 * 1000

interface ArtCacheEntry { slots: PlexArtSlot[]; fetchedAt: number }
const currentArtCache = new Map<string, ArtCacheEntry>()

/** Human label for an art slot's kind, shown under the lightbox image. */
const ART_KIND_LABEL: Record<PlexArtSlot['kind'], string> = {
  collection: 'Collection',
  movie: 'Movie',
  show: 'Show',
  season: 'Season',
}

/**
 * Upsizes a Plex thumb transcode URL for a crisp full-screen lightbox view.
 * The strip requests small posters (240x360); Plex transcodes from the full-res
 * source, so asking for a larger size yields a genuinely sharper image.
 *
 * @param thumb - The slot's transcode thumb URL.
 * @returns The same URL with the transcode dimensions bumped up.
 */
function hiResArt(thumb: string): string {
  return thumb.replace(/width=\d+&height=\d+/, 'width=800&height=1200')
}
const ART_CACHE_TTL = 5 * 60 * 1000

/** Sets read from the links attached to one item, with the links that could not be read. */
interface LinkedState { key: string; sets: PosterSetSummary[]; errors: Array<{ url: string; error: string }> }
/** The link row for one item: whether it is open, the typed link, and why the last one was refused. */
interface LinkUiState { key: string; open: boolean; url: string; error: string | null }
const NO_PICKS: Record<string, Record<string, string>> = {}
const NO_SETS: PosterSetSummary[] = []
const NO_LINK_ERRORS: Array<{ url: string; error: string }> = []

const PANEL_WIDTH_DEFAULT = 560
const PANEL_WIDTH_MIN = 360
const PANEL_WIDTH_MAX = 900

function browseCacheKey(item: LibraryItem): string {
  return item.type === 'collection' ? `collection:${item.key}` : `sets:${item.type}:${item.key}`
}

function invalidateCurrentArt(...keys: string[]) {
  for (const k of keys) currentArtCache.delete(k)
}

function clampPanelWidth(w: number): number {
  const max = Math.min(PANEL_WIDTH_MAX, Math.round(window.innerWidth * 0.9))
  return Math.max(PANEL_WIDTH_MIN, Math.min(max, w))
}

/** A creator's page on the site their set came from. */
function creatorUrl(source: SetSource, uploader: string): string {
  return source === 'posterdb'
    ? `https://theposterdb.com/user/${encodeURIComponent(uploader)}`
    : `https://mediux.pro/user/${encodeURIComponent(uploader)}`
}

/** Match a collection-member poster to a Plex collection child. */
function matchCollectionChild(p: PosterInfo, children: LibraryItem[]): LibraryItem | undefined {
  if (p.tmdbId) {
    const byTmdb = children.find(c => c.tmdbId === p.tmdbId)
    if (byTmdb) return byTmdb
  }
  const lt = p.title.toLowerCase().trim()
  return children.find(c =>
    c.title.toLowerCase().trim() === lt
    && (p.year == null || c.year == null || p.year === c.year),
  )
}

/**
 * Compact relative time for the "last checked" stamp.
 *
 * @param ts - Epoch milliseconds of the check.
 * @returns A short label like "5m ago".
 */
function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Apply progress for a single set. */
interface ApplyState { status: 'idle' | 'applying' | 'done' | 'error'; done: number; total: number; error?: string }

/**
 * Error text for a finished apply: upload failures first, then a failure to
 * save the history that drives the Applied badges and filters.
 *
 * @param failed - Posters that failed to upload.
 * @param historyError - Why the history write failed, if it did.
 * @returns The text, or undefined when everything went through.
 */
function applyError(failed: number, historyError?: string): string | undefined {
  const parts: string[] = []
  if (failed) parts.push(`${failed} failed`)
  if (historyError) parts.push(`history not saved: ${historyError}`)
  return parts.length ? parts.join(' · ') : undefined
}

/**
 * Applies a set's posters to a Plex target, routing each by season/episode.
 *
 * @param targetKey - Plex ratingKey to apply onto.
 * @param posters - Candidate posters; filtered by the enabled types.
 * @param enabled - File types the user has switched on.
 * @param onProgress - Called after each poster with done/total counts.
 * @returns Done/failed counts, the URLs and slots actually applied, and the last error.
 */
async function applyPosters(
  targetKey: string,
  posters: PosterInfo[],
  enabled: Set<FileType>,
  onProgress: (done: number, total: number) => void,
): Promise<{ done: number; failed: number; total: number; appliedUrls: string[]; appliedSlots: string[]; lastError?: string }> {
  const list = posters.filter(p => enabled.has(posterFileType(p)))
  let done = 0, failed = 0
  const appliedUrls: string[] = []
  const appliedSlots: string[] = []
  let lastError: string | undefined
  for (const p of list) {
    try {
      const res = await window.api.plex.uploadPoster(targetKey, p.url, p.source, p.season, p.episode, p.isCollection) as { success: boolean; error?: string }
      if (res.success) { done++; appliedUrls.push(p.url); appliedSlots.push(posterSlot(p)) } else { failed++; lastError = res.error }
    } catch (err) { failed++; lastError = err instanceof Error ? err.message : String(err) }
    onProgress(done, list.length)
  }
  return { done, failed, total: list.length, appliedUrls, appliedSlots, lastError }
}

/** Lets any nested set card jump to a creator in the Creators tab. */
const CreatorNav = createContext<(username: string) => void>(() => {})

/** Plex library grid with per-section tabs, cross-library search, and the poster-sets panel. */
function MyLibraryView({ targetSection, targetItem }: { targetSection: string | null; targetItem: LibraryItem | null }) {
  const [sections, setSections]   = useState<LibrarySection[]>([])
  const [activeKey, setActiveKey] = useState<string>('')

  const [items, setItems]     = useState<LibraryItem[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch]   = useState('')

  const [globalResults, setGlobalResults] = useState<{ section: LibrarySection; items: LibraryItem[] }[]>([])
  const [collectionHits, setCollectionHits] = useState<LibraryItem[]>([])
  const [globalLoading, setGlobalLoading] = useState(false)

  const [selected, setSelected] = useState<LibraryItem | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [manualRefreshing, setManualRefreshing] = useState(false)
  // Global "include collections" setting; collections live in movie libraries.
  const [collectionsEnabled, setCollectionsEnabled] = useState(true)
  const [sort, setSort] = useState<LibrarySort>('recentlyAdded')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [artFilter, setArtFilter] = useState<ArtFilterValue>('all')
  const [showStatus, setShowStatus] = useState<'any' | LibraryStatusFilter>('any')
  const [uploaders, setUploaders] = useState<AppliedUploader[]>([])
  const statusParam = showStatus === 'any' ? undefined : showStatus

  const offsetRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.config.get().then(c => {
      setCollectionsEnabled(c.collectionsEnabled !== false)
      if (c.librarySort) setSort(c.librarySort)
      if (c.librarySortDir) setSortDir(c.librarySortDir)
      setUploaders(appliedUploaders(c.appliedPosters ?? []))
    })
  }, [reloadNonce])

  const artFilterOptions: SelectOption<string>[] = [
    { value: 'all', label: 'All titles' },
    { value: 'none', label: 'No art applied', description: 'Nothing applied from this app yet' },
    { value: 'applied', label: 'Art applied' },
    { value: 'unscheduled', label: 'Applied, not scheduled', description: 'No job keeps this art updated' },
    ...uploaders.map(u => ({
      value: `uploader:${u.source}:${u.uploader}`,
      // The same name on both sites is two creators; say which one when it matters.
      label: `Applied from @${u.uploader}${uploaders.some(o => o !== u && o.uploader.toLowerCase() === u.uploader.toLowerCase()) ? ` (${SOURCE_SHORT[u.source]})` : ''}`,
      description: `${u.count} title${u.count !== 1 ? 's' : ''} · ${SOURCE_LABEL[u.source]}`,
    })),
  ]

  const isCollectionsView = activeKey === COLLECTIONS_TAB_KEY && search.trim().length === 0
  const isGlobalSearch = search.trim().length > 0
  const hasMovieLibrary = sections.some(s => s.type === 'movie')
  const showCollections = collectionsEnabled && hasMovieLibrary

  const loadSections = useCallback(() => {
    return window.api.library.sections().then((s: LibrarySection[]) => {
      setSections(s)
      setActiveKey(prev => prev || s[0]?.key || '')
    })
  }, [])

  useEffect(() => {
    loadSections()
    const unsub = window.api.auth.onStatusChange(st => {
      if (st.status === 'authorized') loadSections()
    })
    return () => { unsub() }
  }, [loadSections])

  // Deep-link from the command palette: jump to a specific library section.
  useEffect(() => {
    if (!targetSection) return
    setSearch('')
    setActiveKey(targetSection)
    setSelected(null)
  }, [targetSection])

  // Deep-link from the command palette: open a specific item's sets panel,
  // and scroll its card into view within the active library tab.
  const scrollTargetRef = useRef<string | null>(null)
  const flashCard = useCallback((key: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-item-key="${key}"]`)
    if (!el) return false
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add(styles.itemCardPulse)
    setTimeout(() => el.classList.remove(styles.itemCardPulse), 1600)
    return true
  }, [])

  useEffect(() => {
    if (!targetItem) return
    // Filter the grid down to the chosen title (cross-library search) and open
    // its sets panel, so a command-palette jump lands on just that item.
    setSearch(targetItem.title)
    setSelected(targetItem)
    scrollTargetRef.current = targetItem.key
    // Best-effort once the grid for this section has had a moment to load.
    const t = setTimeout(() => { if (flashCard(targetItem.key)) scrollTargetRef.current = null }, 350)
    return () => clearTimeout(t)
  }, [targetItem, flashCard])

  // Backup: if the grid loads later, scroll once the card appears.
  useEffect(() => {
    const key = scrollTargetRef.current
    if (key && flashCard(key)) scrollTargetRef.current = null
  }, [items, flashCard])

  // When a new item is selected the grid reflows (gridScrollWithPanel adds
  // padding-right equal to the panel width). Two rAFs let React flush the DOM
  // and the browser complete layout before we scroll so the measured position
  // is post-reflow, not the pre-open position.
  useEffect(() => {
    if (!selected) return
    let raf2: number
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-item-key="${selected.key}"]`)
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key])

  const loadItems = useCallback(async (key: string, q: string, append: boolean, fresh = false) => {
    if (!key || key === COLLECTIONS_TAB_KEY) return
    setLoading(true)
    const offset = append ? offsetRef.current : 0
    try {
      const res = await window.api.library.items({
        sectionKey: key, offset, limit: PAGE_SIZE, search: q, sort, sortDir,
        artFilter: toArtFilter(artFilter), status: statusParam, fresh: fresh || undefined,
      })
      setTotal(res.total)
      offsetRef.current = offset + res.items.length
      setItems(prev => append ? [...prev, ...res.items] : res.items)
    } finally {
      setLoading(false)
    }
  }, [sort, sortDir, artFilter, statusParam])

  const loadCollections = useCallback(async (q: string, append: boolean) => {
    setLoading(true)
    const offset = append ? offsetRef.current : 0
    try {
      const res = await window.api.library.collections({ offset, limit: PAGE_SIZE, search: q || undefined, sort, sortDir })
      setTotal(res.total)
      offsetRef.current = offset + res.items.length
      setItems(prev => append ? [...prev, ...res.items] : res.items)
    } finally {
      setLoading(false)
    }
  }, [sort, sortDir])

  useEffect(() => {
    if (!activeKey || isGlobalSearch) return
    offsetRef.current = 0
    const q = search.trim()
    const t = setTimeout(() => {
      if (activeKey === COLLECTIONS_TAB_KEY) void loadCollections(q, false)
      else void loadItems(activeKey, '', false)
    }, activeKey === COLLECTIONS_TAB_KEY && q ? 300 : 0)
    return () => clearTimeout(t)
  }, [activeKey, isGlobalSearch, search, loadItems, loadCollections, reloadNonce])

  // Cross-library search: fire all sections in parallel, debounced
  useEffect(() => {
    if (!isGlobalSearch || !sections.length) { setGlobalResults([]); setCollectionHits([]); return }
    setGlobalLoading(true)
    const q = search.trim()
    let cancelled = false
    const t = setTimeout(() => {
      Promise.all([
        Promise.all(
          sections.map(s =>
            window.api.library.items({ sectionKey: s.key, offset: 0, limit: 24, search: q, sort, sortDir, artFilter: toArtFilter(artFilter), status: statusParam })
              .then(res => ({ section: s, items: res.items }))
              .catch(() => ({ section: s, items: [] as LibraryItem[] }))
          ),
        ),
        showCollections
          ? window.api.library.collections({ offset: 0, limit: 48, search: q, sort, sortDir })
              .then(res => res.items)
              .catch(() => [] as LibraryItem[])
          : Promise.resolve([] as LibraryItem[]),
      ]).then(([results, collections]) => {
        if (cancelled) return
        setGlobalResults(results.filter(r => r.items.length > 0))
        setCollectionHits(collections)
        setGlobalLoading(false)
      })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search, isGlobalSearch, sections, showCollections, reloadNonce, sort, sortDir, artFilter, statusParam])

  // Infinite scroll, single-tab mode only
  function onScroll() {
    const el = scrollRef.current
    if (!el || loading || isGlobalSearch) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400 && items.length < total) {
      if (isCollectionsView) void loadCollections(search.trim(), true)
      else void loadItems(activeKey, '', true)
    }
  }

  const totalGlobalHits = globalResults.reduce((n, g) => n + g.items.length, 0) + collectionHits.length

  // Manual refresh re-checks sections and reloads what's on screen, holding the
  // spin for a brief minimum so a fast local Plex doesn't flicker sub-frame
  const refreshing = manualRefreshing || loading || globalLoading
  async function handleRefresh() {
    if (manualRefreshing) return
    setManualRefreshing(true)
    const started = Date.now()
    try {
      await loadSections()
      if (!isGlobalSearch && activeKey === COLLECTIONS_TAB_KEY) {
        offsetRef.current = 0
        await loadCollections(search.trim(), false)
      } else if (!isGlobalSearch && activeKey) {
        offsetRef.current = 0
        await loadItems(activeKey, '', false, true)
      } else {
        setReloadNonce(n => n + 1)
      }
    } finally {
      const elapsed = Date.now() - started
      if (elapsed < 500) await new Promise(r => setTimeout(r, 500 - elapsed))
      setManualRefreshing(false)
    }
  }

  // Collections only support a subset of sorts; coerce the shown value so the
  // dropdown never displays an option it isn't offering on that tab.
  const sortList = isCollectionsView ? COLLECTION_SORTS : ALL_SORTS
  const shownSort: LibrarySort = sortList.includes(sort) ? sort : 'title'
  function changeSort(next: LibrarySort) {
    setSort(next)
    window.api.config.set({ librarySort: next }).catch(() => {})
  }
  function toggleSortDir() {
    const next: SortDir = sortDir === 'asc' ? 'desc' : 'asc'
    setSortDir(next)
    window.api.config.set({ librarySortDir: next }).catch(() => {})
  }

  return (
    <>
      {/* Controls */}
      <div className={styles.controls}>
        <div className={`${styles.sectionTabs} ${isGlobalSearch ? styles.sectionTabsDimmed : ''}`}>
          {isGlobalSearch && (
            <span className={styles.allLibsChip}>
              <Library size={12} />
              All libraries
            </span>
          )}
          {sections.map(s => (
            <button
              key={s.key}
              className={`${styles.sectionTab} ${!isGlobalSearch && activeKey === s.key ? styles.sectionTabActive : ''}`}
              onClick={() => { setSearch(''); setActiveKey(s.key); setSelected(null) }}
            >
              {s.type === 'movie'
                ? <Film size={13} className={styles.sectionTabIcon} />
                : <Tv size={13} className={styles.sectionTabIcon} />}
              {s.title}
            </button>
          ))}
          {showCollections && (
            <button
              className={`${styles.sectionTab} ${!isGlobalSearch && isCollectionsView ? styles.sectionTabActive : ''}`}
              onClick={() => { setSearch(''); setActiveKey(COLLECTIONS_TAB_KEY); setSelected(null) }}
            >
              <Layers size={13} className={styles.sectionTabIcon} />
              Collections
            </button>
          )}
        </div>

        <div className={styles.controlsRight}>
          {!isCollectionsView && (
            <div className={styles.artFilter} title="Show only titles by their applied artwork">
              <Select
                value={artFilter}
                onChange={v => setArtFilter(v as ArtFilterValue)}
                options={artFilterOptions}
              />
            </div>
          )}
          {!isCollectionsView && (isGlobalSearch || sections.find(s => s.key === activeKey)?.type === 'show') && (
            <div className={styles.statusFilter} title="Show only series that are still going, or only ones that have finished. Uses TMDB when a key is set in Settings; without one, a show counts as continuing when an episode aired in the last year.">
              <Select
                value={showStatus}
                onChange={v => setShowStatus(v as 'any' | LibraryStatusFilter)}
                options={[
                  { value: 'any', label: 'Any status' },
                  { value: 'continuing', label: 'Continuing', description: 'Running, renewed, or in production' },
                  { value: 'ended', label: 'Ended', description: 'Finished or canceled' },
                ]}
              />
            </div>
          )}
          <div className={styles.sortControl}>
            <Select
              value={shownSort}
              onChange={v => changeSort(v as LibrarySort)}
              options={sortList.map(s => ({ value: s, label: SORT_LABEL[s] }))}
            />
            <button
              className={styles.refreshBtn}
              onClick={toggleSortDir}
              title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
              aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
            >
              {sortDir === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
            </button>
          </div>
          <div className={styles.searchBox}>
            <Search size={14} className={styles.searchIcon} />
            <input
              className={`${styles.searchInput} ${isGlobalSearch ? styles.searchInputActive : ''}`}
              placeholder={isCollectionsView ? 'Filter collections…' : isGlobalSearch ? 'Filtering all libraries…' : 'Filter all libraries…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              spellCheck={false}
            />
            {search && (
              <button className={styles.searchClear} onClick={() => setSearch('')}><X size={13} /></button>
            )}
          </div>
          <button
            className={styles.refreshBtn}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh from Plex"
            aria-label="Refresh library from Plex"
          >
            <RefreshCw size={15} className={refreshing ? styles.spin : ''} />
          </button>
        </div>
      </div>

      {/* Grid area */}
      <div
        className={`${styles.gridScroll} ${selected ? styles.gridScrollWithPanel : ''}`}
        ref={scrollRef}
        onScroll={onScroll}
      >
        {isGlobalSearch ? (
          globalLoading ? (
            <div className={styles.gridLoading}><Spinner size="sm" /><span>Searching all libraries…</span></div>
          ) : globalResults.length === 0 && collectionHits.length === 0 ? (
            <div className={styles.emptyGrid}>
              <ImageIcon size={32} />
              <p>No results across any library.</p>
            </div>
          ) : (
            <div className={styles.globalResults}>
              {collectionHits.length > 0 && (
                <div className={styles.globalGroup}>
                  <div className={styles.globalGroupHeader}>
                    <span className={styles.globalGroupTitle}>Collections</span>
                    <span className={styles.globalGroupMeta}>
                      <span className={styles.sectionType}>Collections</span>
                      {collectionHits.length} result{collectionHits.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className={styles.itemGrid}>
                    {collectionHits.map(item => (
                      <ItemCard
                        key={item.key}
                        item={item}
                        active={selected?.key === item.key}
                        onClick={() => setSelected(item)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {globalResults.map(({ section, items: hits }) => (
                <div key={section.key} className={styles.globalGroup}>
                  <div className={styles.globalGroupHeader}>
                    <span className={styles.globalGroupTitle}>{section.title}</span>
                    <span className={styles.globalGroupMeta}>
                      <span className={styles.sectionType}>{section.type === 'movie' ? 'Movies' : 'TV'}</span>
                      {hits.length} result{hits.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className={styles.itemGrid}>
                    {hits.map(item => (
                      <ItemCard
                        key={item.key}
                        item={item}
                        active={selected?.key === item.key}
                        onClick={() => setSelected(item)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className={styles.gridCount}>{totalGlobalHits} result{totalGlobalHits !== 1 ? 's' : ''} across {globalResults.length} librar{globalResults.length !== 1 ? 'ies' : 'y'}</div>
            </div>
          )
        ) : (
          <>
            {items.length === 0 && !loading ? (
              <div className={styles.emptyGrid}>
                <ImageIcon size={32} />
                <p>{isCollectionsView ? 'No movie collections found.' : artFilter !== 'all' || showStatus !== 'any' ? 'No titles match these filters.' : 'This library is empty.'}</p>
              </div>
            ) : (
              <div className={styles.itemGrid}>
                {items.map(item => (
                  <ItemCard
                    key={item.key}
                    item={item}
                    active={selected?.key === item.key}
                    onClick={() => setSelected(item)}
                  />
                ))}
              </div>
            )}
            {loading && <div className={styles.gridLoading}><Spinner size="sm" /><span>Loading…</span></div>}
            {!loading && items.length > 0 && <div className={styles.gridCount}>{items.length} of {total}</div>}
          </>
        )}
      </div>

      {/* Sets panel. Stable key: the panel mounts once per open/close and
          swaps content internally as `item` changes, instead of a full
          remount per item - a remount-per-item used to fight its own
          slide-in animation whenever the user picked a different item while
          the panel was already open. */}
      <AnimatePresence>
        {selected && (
          <SetsPanel
            key="sets-panel"
            item={selected}
            onClose={() => setSelected(null)}
            onItemPoster={(key, thumb) => {
              setItems(prev => prev.map(it => it.key === key ? { ...it, thumb } : it))
              // The grid may be showing cross-library search results instead of `items`.
              setGlobalResults(prev => prev.map(g => ({ ...g, items: g.items.map(it => it.key === key ? { ...it, thumb } : it) })))
              setSelected(prev => prev && prev.key === key ? { ...prev, thumb } : prev)
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

type Mode = 'library' | 'creators'

/** Library Browser page: switches between the My Library grid and the Creators view. */
export default function LibraryPage() {
  const { plexConnected } = useAppContext()
  const [mode, setMode] = useState<Mode>('library')
  const [creatorTarget, setCreatorTarget] = useState<string | null>(null)
  const [sectionTarget, setSectionTarget] = useState<string | null>(null)
  const [itemTarget, setItemTarget] = useState<LibraryItem | null>(null)
  const libraryIntent = useNavStore(s => s.libraryIntent)
  const clearLibrary  = useNavStore(s => s.clearLibrary)
  const { prefs: creatorPrefs } = useCreatorPrefs()
  const followCount = creatorPrefs.mediuxFollows.length + creatorPrefs.posterdbFollows.length

  const openCreator = useCallback((username: string) => {
    setCreatorTarget(username)
    setMode('creators')
  }, [])

  // Consume a deep-link intent from the command palette (creator, section, or item).
  useEffect(() => {
    if (!libraryIntent) return
    if (libraryIntent.creator) {
      setCreatorTarget(libraryIntent.creator)
      setMode('creators')
    } else if (libraryIntent.item) {
      if (libraryIntent.section) setSectionTarget(libraryIntent.section)
      setItemTarget(libraryIntent.item)
      setMode('library')
    } else if (libraryIntent.section) {
      setSectionTarget(libraryIntent.section)
      setMode('library')
    }
    clearLibrary()
  }, [libraryIntent, clearLibrary])

  return (
    <CreatorNav.Provider value={openCreator}>
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className="page-title">{mode === 'library' ? 'Library Browser' : 'Creators'}</h1>
            <p className="page-subtitle">
              {mode === 'library'
                ? 'Browse your Plex library and apply MediUX and ThePosterDB poster sets.'
                : 'Follow creators on MediUX and ThePosterDB and apply their newest art to your library.'}
            </p>
          </div>

          {/* Mode switch */}
          <div className={styles.tabBar}>
            <button
              className={`${styles.tabBarBtn} ${mode === 'library' ? styles.tabBarBtnActive : ''}`}
              onClick={() => setMode('library')}
            >
              {mode === 'library' && (
                <motion.span className={styles.tabBarIndicator} layoutId="libTabIndicator" transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} />
              )}
              <LayoutGrid size={14} />
              <span>My Library</span>
            </button>
            <button
              className={`${styles.tabBarBtn} ${mode === 'creators' ? styles.tabBarBtnActive : ''}`}
              onClick={() => setMode('creators')}
            >
              {mode === 'creators' && (
                <motion.span className={styles.tabBarIndicator} layoutId="libTabIndicator" transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} />
              )}
              <Users size={14} />
              <span>Creators</span>
              {followCount > 0 && (
                <span className={styles.tabBadge}>{followCount}</span>
              )}
            </button>
          </div>
        </div>

        {!plexConnected ? (
          <PlexConnectBanner />
        ) : mode === 'library' ? (
          <MyLibraryView targetSection={sectionTarget} targetItem={itemTarget} />
        ) : (
          <CreatorsView initialCreator={creatorTarget} />
        )}
      </div>
    </CreatorNav.Provider>
  )
}

/** Poster-grid card for one Plex library item. */
function ItemCard({ item, active, onClick }: { item: LibraryItem; active: boolean; onClick: () => void }) {
  const [err, setErr]       = useState(false)
  const [loaded, setLoaded] = useState(false)
  return (
    <button className={`${styles.itemCard} ${active ? styles.itemCardActive : ''}`} onClick={onClick} title={item.title} data-item-key={item.key}>
      <div className={`${styles.itemPoster} ${!err && item.thumb && !loaded ? styles.skeleton : ''}`}>
        {!err && item.thumb ? (
          <img
            src={item.thumb}
            alt={item.title}
            loading="lazy"
            draggable={false}
            className={loaded ? '' : styles.imgPending}
            onLoad={() => setLoaded(true)}
            onError={() => setErr(true)}
          />
        ) : (
          <div className={styles.itemPosterFallback}>
            {item.type === 'collection' ? <Layers size={22} /> : item.title.charAt(0)}
          </div>
        )}
        <div className={styles.itemOverlay} aria-hidden="true">
          <span className={styles.itemOverlayHint}>Browse Sets</span>
        </div>
      </div>
      <div className={styles.itemMeta}>
        <span className={styles.itemTitle}>{item.title}</span>
        {item.type === 'collection' && item.childCount != null && (
          <span className={styles.itemYear}>{item.childCount} movie{item.childCount !== 1 ? 's' : ''}</span>
        )}
        {item.type !== 'collection' && item.year && <span className={styles.itemYear}>{item.year}</span>}
      </div>
    </button>
  )
}

/** Collapsible strip of the item's current Plex art, clickable into a lightbox. */
function CurrentArtStrip({ slots, loading }: { slots: PlexArtSlot[]; loading: boolean }) {
  const [expanded, setExpanded] = useState(true)
  const [lightbox, setLightbox] = useState<number | null>(null)

  // Only slots with a thumb are viewable; the lightbox index lines up with this
  // filtered list, so each card carries its position into it.
  const lightboxImages = useMemo<LightboxImage[]>(
    () => slots.filter(s => !!s.thumb).map(s => ({
      url: hiResArt(s.thumb!),
      label: s.label,
      caption: s.season != null ? `Season ${s.season}` : ART_KIND_LABEL[s.kind],
    })),
    [slots],
  )

  if (loading) {
    return (
      <div className={styles.artStripSection}>
        <span className={styles.artStripLabel}>Current Plex Art</span>
        <div className={styles.artStripLoading}><Spinner size="sm" /> <span>Loading…</span></div>
      </div>
    )
  }
  if (!slots.length) return null

  let imgIdx = -1
  return (
    <div className={styles.artStripSection}>
      <button
        type="button"
        className={styles.artStripHeader}
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Collapse current art' : 'Expand current art'}
      >
        <ChevronDown
          size={13}
          className={`${styles.artStripChevron} ${expanded ? '' : styles.artStripChevronCollapsed}`}
        />
        <span className={styles.artStripLabel}>Current Plex Art</span>
        <span className={styles.artStripCount}>{slots.length}</span>
      </button>
      <div className={`${styles.artStripBody} ${expanded ? '' : styles.artStripBodyCollapsed}`}>
        <div className={styles.artStripScroll}>
          <div className={styles.artStrip}>
            {slots.map(s => {
              const i = s.thumb ? ++imgIdx : -1
              return (
                <div
                  key={`${s.kind}-${s.key}`}
                  className={`${styles.artCard} ${s.highlight ? styles.artHighlight : ''} ${s.thumb ? styles.artCardClickable : ''}`}
                  title={s.label}
                  {...(s.thumb
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        onClick: () => setLightbox(i),
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox(i) }
                        },
                      }
                    : {})}
                >
                  {s.thumb ? (
                    <img src={s.thumb} alt={s.label} className={styles.artCardImg} loading="lazy" draggable={false} />
                  ) : (
                    <div className={styles.artCardFallback}><ImageIcon size={16} /></div>
                  )}
                  <span className={styles.artLabel}>{s.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {lightbox !== null && (
          <Lightbox images={lightboxImages} index={lightbox} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

function SetsPanel({ item, onClose, onItemPoster }: {
  item: LibraryItem
  onClose: () => void
  onItemPoster: (key: string, thumb: string) => void
}) {
  const [sets, setSets]       = useState<PosterSetSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const [hasTmdbKey, setHasTmdbKey] = useState(false)
  // The item has no TMDB id, so only ThePosterDB could be searched.
  const [tmdbMissing, setTmdbMissing] = useState(false)
  const [uploader, setUploader] = useState<string>('all')
  const [source, setSource]     = useState<SetSource | 'all'>('all')
  // Reveals hidden creators' sets for this title, until the next title.
  const [showHidden, setShowHidden] = useState(false)
  const { stateOf, setState: setCreatorState } = useCreatorPrefs()
  // A site that was asked but could not answer, shown beside the other's sets.
  const [sourceErrors, setSourceErrors] = useState<Partial<Record<SetSource, string>>>({})
  // Sites still being searched once the first answer is in.
  const [pending, setPending] = useState<Set<SetSource>>(new Set())
  // ThePosterDB lists more sets than the panel read; the page to continue on.
  const [posterdbMore, setPosterdbMore] = useState<string | null>(null)
  const [creatorError, setCreatorError] = useState<string | null>(null)
  const [types, setTypes]       = useState<Set<FileType>>(new Set(ALL_TYPES))
  const [applyMap, setApplyMap] = useState<Record<string, ApplyState>>({})
  // Per-set apply scope: movies and collection poster are chosen independently.
  const [collectionScope, setCollectionScope] = useState<Record<string, SetApplyScope>>({})
  // Per-set choice of which poster fills a Plex slot that several posters in
  // the set compete for, keyed by set then slot (see variantKey). Scoped to
  // the viewed item by key, so a switch starts clean without a reset effect.
  const [pickState, setPickState] = useState<{ key: string; bySet: Record<string, Record<string, string>> }>({ key: '', bySet: {} })
  const picks = pickState.key === item.key ? pickState.bySet : NO_PICKS
  // Sets read from the links the user attached to this title, scoped the same way.
  const [linkedState, setLinkedState] = useState<LinkedState>({ key: '', sets: [], errors: [] })
  const linked = linkedState.key === item.key ? linkedState.sets : NO_SETS
  const linkErrors = linkedState.key === item.key ? linkedState.errors : NO_LINK_ERRORS
  const [linkUi, setLinkUi] = useState<LinkUiState>({ key: '', open: false, url: '', error: null })
  const linkOpen = linkUi.key === item.key && linkUi.open
  const linkUrl = linkUi.key === item.key ? linkUi.url : ''
  const linkError = linkUi.key === item.key ? linkUi.error : null
  const [linking, setLinking] = useState(false)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const updateLinkUi = (patch: Partial<Omit<LinkUiState, 'key'>>) =>
    setLinkUi(prev => ({ ...(prev.key === item.key ? prev : { open: false, url: '', error: null }), ...patch, key: item.key }))
  // TMDB id MediUX resolved for this item (set even when the Plex item uses a
  // tvdb/imdb agent), used to match the viewed item's collection-member poster.
  const [resolvedTmdbId, setResolvedTmdbId] = useState<string | undefined>(undefined)
  // Which collection-member movies actually exist in the Plex library, keyed by
  // tmdbId (or title|year). Resolved with the same findItem the apply uses, so
  // the "N movies" count matches exactly what "apply all" will touch.
  const [memberInLib, setMemberInLib] = useState<Map<string, boolean>>(new Map())
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>({ setKeys: new Set(), titles: new Set(), posterUrls: new Set(), currentByItem: new Map(), currentPosterUrls: new Set() })
  const [schedJobs, setSchedJobs] = useState<ScheduledJob[]>([])
  const [quickCron, setQuickCron] = useState(DEFAULT_QUICK_CRON)
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<{ setId: string; message: string } | null>(null)
  const coverage = useMemo(() => scheduleCoverage(schedJobs), [schedJobs])
  const { navigate } = useAppContext()
  const goScheduler = useNavStore(s => s.goScheduler)
  const [setsReloadKey, setSetsReloadKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [artSlots, setArtSlots] = useState<PlexArtSlot[]>([])
  const [artLoading, setArtLoading] = useState(true)
  const [artReloadKey, setArtReloadKey] = useState(0)
  const [collectionMembers, setCollectionMembers] = useState<LibraryItem[]>([])
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH_DEFAULT)
  const panelWidthRef = useRef(PANEL_WIDTH_DEFAULT)
  const [resizing, setResizing] = useState(false)
  const panelBodyRef = useRef<HTMLDivElement>(null)

  // The panel chrome no longer remounts per item (see the parent's stable
  // "sets-panel" key), so per-item UI state that used to reset for free via
  // remount needs an explicit reset here. `sets`/`error`/`loading`/`artSlots`/
  // etc. already key their own effects off item.key and don't need to be
  // listed - only genuinely transient UI state does.
  useEffect(() => {
    setUploader('all')
    setSource('all')
    setShowHidden(false)
    setApplyMap({})
    setCollectionScope({})
    setSchedulingId(null)
    panelBodyRef.current?.scrollTo({ top: 0 })
  }, [item.key])

  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus()
  }, [linkOpen])

  const isCollectionItem = item.type === 'collection'
  const itemApplied = isCollectionItem
    ? appliedIdx.currentByItem.has(item.key)
    : appliedIdx.titles.has(appliedKey(item.title, item.year))

  useEffect(() => { loadAppliedIndex().then(setAppliedIdx) }, [])

  // Scheduled jobs, kept live so the Scheduled tags follow edits made elsewhere.
  useEffect(() => {
    window.api.scheduler.list().then(setSchedJobs).catch(() => { /* scheduler unavailable */ })
    return window.api.scheduler.onChange(setSchedJobs)
  }, [])

  // Schedule a single set straight from the library, reusing any job that
  // already covers it (the set itself or, for MediUX, a whole-creator sync).
  async function scheduleSet(s: PosterSetSummary) {
    if (schedulingId) return
    const sKey = setKey(s)
    setSchedulingId(sKey)
    setScheduleError(null)
    try {
      const plan = planQuickSync(await window.api.scheduler.list(), {
        urls: [s.setUrl ?? `https://mediux.pro/sets/${s.id}`],
        name: `${item.title}${item.year ? ` (${item.year})` : ''} - ${s.setName}`,
        cronExpr: quickCron,
        // Creator-wide syncs are MediUX feeds; a ThePosterDB uploader has none.
        creator: s.source === 'mediux' ? s.uploader : undefined,
      }, uuid)
      if (plan.kind !== 'exists') await window.api.scheduler.save(plan.job)
      setSchedJobs(await window.api.scheduler.list())
    } catch (err) {
      setScheduleError({ setId: sKey, message: errorMessage(err) })
    } finally {
      setSchedulingId(null)
    }
  }

  function openScheduledJob(jobId: string) {
    goScheduler(jobId)
    navigate('scheduler')
  }

  useEffect(() => {
    window.api.config.get().then(c => {
      if (c.mediuxFilters?.length) setTypes(new Set(c.mediuxFilters as FileType[]))
      setHasTmdbKey(Boolean(c.tmdbApiKey?.trim()))
      setQuickCron(c.schedulerQuickCron || DEFAULT_QUICK_CRON)
      const w = clampPanelWidth(c.libraryPanelWidth ?? PANEL_WIDTH_DEFAULT)
      panelWidthRef.current = w
      setPanelWidth(w)
    })
  }, [])

  // The grid's reserved gap and the panel itself both read --library-panel-width,
  // so a resize updates both from one value. We don't clear it on unmount: while
  // switching between items both panels are briefly mounted, and the outgoing
  // one's cleanup would otherwise wipe the width the incoming one just set. The
  // grid only consumes the gap while a panel is open, so a stale value is inert.
  useEffect(() => {
    document.documentElement.style.setProperty('--library-panel-width', `${panelWidth}px`)
  }, [panelWidth])

  useEffect(() => {
    let cancelled = false
    const cacheKey = item.key
    const cached = currentArtCache.get(cacheKey)
    const fresh = !!cached && Date.now() - cached.fetchedAt < ART_CACHE_TTL
    const forced = artReloadKey > 0

    if (cached && !forced) {
      setArtSlots(cached.slots)
      setArtLoading(false)
    } else if (!cached) {
      setArtSlots([])
      setArtLoading(true)
    }

    if (fresh && !forced) return

    window.api.library.currentArt({
      key: item.key,
      type: item.type === 'collection' ? 'collection' : item.type === 'show' ? 'show' : 'movie',
      title: item.title,
      year: item.year,
    }).then(res => {
      if (cancelled) return
      currentArtCache.set(cacheKey, { slots: res.slots, fetchedAt: Date.now() })
      setArtSlots(res.slots)
    }).catch(() => {
      if (!cancelled) setArtSlots([])
    }).finally(() => {
      if (!cancelled) setArtLoading(false)
    })
    return () => { cancelled = true }
  }, [item.key, item.type, item.title, item.year, artReloadKey])

  useEffect(() => {
    let cancelled = false
    const key = browseCacheKey(item)
    const cached = browseSetsCache.get(key)
    const forced = setsReloadKey > 0
    const fresh = !!cached && Date.now() - cached.fetchedAt < BROWSE_CACHE_TTL

    setError(null)
    setPending(new Set())

    if (cached) {
      setSets(cached.sets)
      setResolvedTmdbId(cached.tmdbId)
      setTmdbMissing(!!cached.tmdbMissing)
      setCollectionMembers(cached.collectionMembers ?? [])
      setSourceErrors(cached.sourceErrors ?? {})
      setPosterdbMore(cached.posterdbUrl ?? null)
      setLoading(false)
    } else {
      setSets([])
      setCollectionMembers([])
      setSourceErrors({})
      setPosterdbMore(null)
      setLoading(true)
    }

    if (fresh && !forced) return

    const hasCache = !!cached
    if (hasCache) setRefreshing(true)
    setPending(new Set(SOURCES))

    // Each site is asked on its own, so MediUX's single page is not held back
    // by the ThePosterDB walk; answers merge into the list as they arrive.
    const request = (sources: SetSource[]): Promise<BrowseSetsRes> => isCollectionItem
      ? window.api.library.collectionSets({ collectionKey: item.key, title: item.title, sources, fresh: forced })
      : window.api.library.sets({
          type: item.type === 'show' ? 'show' : 'movie',
          tmdbId: item.tmdbId, tvdbId: item.tvdbId, imdbId: item.imdbId, anidbId: item.anidbId,
          // ThePosterDB has no id lookup, so it matches on these.
          title: item.title, year: item.year,
          sources, fresh: forced,
        })

    // Most downloaded first (byPopularity); followed/hidden ordering is applied
    // live in visibleSets, so it follows a follow or hide without a reload.
    const results: Partial<Record<SetSource, BrowseSetsRes>> = {}

    const settle = (src: SetSource, res: BrowseSetsRes) => {
      if (cancelled) return
      results[src] = res
      setSourceErrors(prev => ({ ...prev, [src]: sourceFailure(src, res) }))
      setSets(prev => [...prev.filter(s => s.source !== src), ...res.sets].sort(byPopularity))
      if (res.collectionMembers) setCollectionMembers(res.collectionMembers)
      if (src === 'mediux') {
        setResolvedTmdbId(res.tmdbId)
        setTmdbMissing(!!res.tmdbMissing)
      } else {
        setPosterdbMore(res.posterdbCapped && res.posterdbUrl ? res.posterdbUrl : null)
      }
      if (res.error === 'no_movies') setError('no_movies')
      setPending(prev => { const next = new Set(prev); next.delete(src); return next })
      setLoading(false)
    }

    Promise.all(SOURCES.map(src =>
      request([src]).then(res => settle(src, res), (e: unknown) => settle(src, { sets: [], error: errorMessage(e) })),
    )).then(() => {
      if (cancelled) return
      const m = results.mediux, p = results.posterdb
      const failures: Partial<Record<SetSource, string>> = {}
      for (const src of SOURCES) {
        const f = results[src] && sourceFailure(src, results[src])
        if (f) failures[src] = f
      }
      // "No TMDB id" blocks the panel only when ThePosterDB had nothing to add.
      if (m?.tmdbMissing && !p?.sets.length && !failures.posterdb && !m.error) setError('no_tmdb')
      // A site that failed is retried on the next open rather than remembered.
      if (!Object.keys(failures).length) {
        browseSetsCache.set(key, {
          sets: [...(m?.sets ?? []), ...(p?.sets ?? [])].sort(byPopularity),
          tmdbId: m?.tmdbId,
          tmdbMissing: m?.tmdbMissing,
          collectionMembers: m?.collectionMembers ?? p?.collectionMembers,
          posterdbUrl: p?.posterdbCapped && p.posterdbUrl ? p.posterdbUrl : undefined,
          fetchedAt: Date.now(),
        })
      }
      setLoading(false)
      setRefreshing(false)
    })
    return () => { cancelled = true }
  }, [item.key, item.type, item.title, item.year, item.tmdbId, item.tvdbId, item.imdbId, item.anidbId, isCollectionItem, setsReloadKey])

  function refreshSets() {
    browseSetsCache.delete(browseCacheKey(item))
    setSetsReloadKey(k => k + 1)
  }

  // The item as the links are attached to it.
  const linkedItem = useMemo<LinkedItemRef>(
    () => ({ key: item.key, type: item.type, title: item.title, year: item.year }),
    [item.key, item.type, item.title, item.year],
  )

  // Linked sets load beside the browse; Refresh re-reads their pages too. The
  // previous item's sets never show here, since the state is keyed by item.
  useEffect(() => {
    let cancelled = false
    const key = item.key
    window.api.library.linkedSets({ item: linkedItem, fresh: setsReloadKey > 0 }).then(res => {
      if (!cancelled) setLinkedState({ key, sets: res.sets, errors: res.errors ?? [] })
    }).catch((err: unknown) => {
      if (!cancelled) setLinkedState({ key, sets: [], errors: [{ url: '', error: errorMessage(err) }] })
    })
    return () => { cancelled = true }
  }, [item.key, linkedItem, setsReloadKey])

  async function submitLink() {
    const url = linkUrl.trim()
    if (!url || linking) return
    setLinking(true)
    updateLinkUi({ error: null })
    try {
      const res = await window.api.library.linkSet({ item: linkedItem, url })
      const refused = res.errors?.[0]
      if (refused) {
        updateLinkUi({ error: refused.error })
        return
      }
      const key = item.key
      setLinkedState(prev => prev.key === key
        ? { ...prev, sets: mergeLinkedSets(prev.sets, res.sets) }
        : { key, sets: res.sets, errors: [] })
      updateLinkUi({ open: false, url: '' })
    } catch (err) {
      updateLinkUi({ error: errorMessage(err) })
    } finally {
      setLinking(false)
    }
  }

  async function unlink(url: string) {
    const key = item.key
    setLinkedState(prev => prev.key === key
      ? { ...prev, sets: prev.sets.filter(s => s.linkedFrom !== url), errors: prev.errors.filter(e => e.url !== url) }
      : prev)
    try {
      await window.api.library.unlinkSet({ itemKey: key, url })
    } catch (err) {
      updateLinkUi({ open: true, error: errorMessage(err) })
    }
  }

  // Everything the panel lists: linked sets first, then what the sites found.
  const allSets = useMemo(() => mergeLinkedSets(linked, sets), [linked, sets])

  function bumpArtReload() {
    invalidateCurrentArt(item.key)
    setArtReloadKey(k => k + 1)
  }

  function startPanelResize(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidthRef.current
    setResizing(true)

    function onMove(ev: MouseEvent) {
      const next = clampPanelWidth(startW + (startX - ev.clientX))
      panelWidthRef.current = next
      // Drive the drag straight through the CSS var: the panel and the grid gap
      // both track the cursor 1:1 without re-rendering the (heavy) panel on every
      // frame - the per-frame React re-render is what made resizing stutter. The
      // final value is committed to state in onUp so React stays in sync.
      document.documentElement.style.setProperty('--library-panel-width', `${next}px`)
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
      setPanelWidth(panelWidthRef.current)
      window.api.config.set({ libraryPanelWidth: panelWidthRef.current }).catch(() => {})
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function resetPanelWidth() {
    const w = clampPanelWidth(PANEL_WIDTH_DEFAULT)
    panelWidthRef.current = w
    setPanelWidth(w)
    window.api.config.set({ libraryPanelWidth: w }).catch(() => {})
  }

  // Resolve which collection-member movies are in scope for apply toggles.
  useEffect(() => {
    const unique = new Map<string, { title: string; year?: number; tmdbId?: string }>()
    for (const s of allSets) for (const p of s.posters) {
      if (!p.isCollectionMember) continue
      const k = p.tmdbId ?? `${p.title.toLowerCase()}|${p.year ?? ''}`
      if (!unique.has(k)) unique.set(k, { title: p.title, year: p.year, tmdbId: p.tmdbId })
    }
    if (unique.size === 0) { setMemberInLib(new Map()); return }

    if (isCollectionItem) {
      const out = new Map<string, boolean>()
      for (const [k, m] of unique) {
        out.set(k, !!matchCollectionChild(
          { title: m.title, year: m.year, tmdbId: m.tmdbId, url: '', source: 'mediux' },
          collectionMembers,
        ))
      }
      setMemberInLib(out)
      return
    }

    const myTmdb = item.tmdbId ?? resolvedTmdbId
    let cancelled = false
    ;(async () => {
      const out = new Map<string, boolean>()
      for (const [k, m] of unique) {
        if (m.tmdbId && myTmdb && m.tmdbId === myTmdb) { out.set(k, true); continue }
        const found = await window.api.plex.findItem(m.title, m.year, undefined, m.tmdbId)
        if (cancelled) return
        out.set(k, !!found)
      }
      if (!cancelled) setMemberInLib(out)
    })()
    return () => { cancelled = true }
  }, [allSets, item.tmdbId, resolvedTmdbId, isCollectionItem, collectionMembers])

  const creatorOf = useCallback((s: PosterSetSummary) => stateOf(s.source, s.uploader), [stateOf])

  // Filters and creator preferences are applied in one tested helper, so the
  // dropdown, the list and the hidden count always agree. A stale choice (an
  // uploader hidden since, a site that returned nothing) falls back to "all"
  // in the same render instead of flashing an empty list first.
  const { sourceCounts, activeSource, sourceSets, uploaders, activeUploader, visibleSets, hiddenCount } = useMemo(
    () => arrangeSets(allSets, { source, uploader, types, showHidden, stateOf }),
    [allSets, source, uploader, types, showHidden, stateOf],
  )

  function toggleType(t: FileType) {
    setTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next.size ? next : prev   // keep at least one
    })
  }

  // True when a collection-member poster targets the currently viewed item
  // (exact TMDB match preferred; title/year as a fallback when ids are absent).
  function isThisItem(p: PosterInfo): boolean {
    const myTmdb = item.tmdbId ?? resolvedTmdbId
    if (p.tmdbId && myTmdb) return p.tmdbId === myTmdb
    return p.title.toLowerCase().trim() === item.title.toLowerCase().trim()
      && (p.year == null || item.year == null || p.year === item.year)
  }

  /** Main poster (no season/episode) of a list, for the grid thumbnail. */
  function mainThumb(posters: PosterInfo[]): string | undefined {
    const main = posters.find(p => p.season == null && p.episode == null)
    return main ? (main.thumbUrl ?? main.url) : undefined
  }

  /** Stable key for a collection-member poster's movie (matches the memberInLib map). */
  const memberKey = (p: PosterInfo) => p.tmdbId ?? `${p.title.toLowerCase()}|${p.year ?? ''}`

  async function applySet(s: PosterSetSummary) {
    // Every per-set map is keyed by source, never by the raw id (see setKey).
    const sKey = setKey(s)
    const memberIds = [...new Set(s.posters.filter(p => p.isCollectionMember).map(p => p.tmdbId ?? `${p.title.toLowerCase()}|${p.year ?? ''}`))]
    const collectionInLib = memberIds.filter(k => memberInLib.get(k)).length

    const collectionArt = s.posters.filter(p => p.isCollection)
    const members       = s.posters.filter(p => p.isCollectionMember)
    const plain         = s.posters.filter(p => !p.isCollection && !p.isCollectionMember)

    // When browsing from a Plex Collection and the set carries no explicitly-tagged
    // collection art or per-movie member posters, treat plain (unclassified) posters
    // as the collection-level art — they have nowhere else to go from this view.
    const effectiveCollArt = isCollectionItem && collectionArt.length === 0 && members.length === 0
      ? plain
      : collectionArt
    const hasCollectionArt = effectiveCollArt.length > 0
    const scope = collectionScope[sKey] ?? defaultSetApplyScope(hasCollectionArt, collectionInLib)
    const chosen = picks[sKey] ?? {}

    if (isCollectionItem) {
      // One poster per Plex slot (see resolveVariants): a set carrying art for
      // several collections would otherwise upload them all to this one and
      // keep whichever came last.
      const memberPosters = resolveVariants(
        scope.movies === 'none' ? [] : members.filter(p => memberInLib.get(memberKey(p))),
        'collection', chosen,
      )
      const collArt = scope.collectionPoster ? resolveVariants(effectiveCollArt, 'collection', chosen, item.title) : []

      const willApply = [...memberPosters, ...collArt]
      const enabledTotal = willApply.filter(p => types.has(posterFileType(p))).length
      if (enabledTotal === 0) return
      setApplyMap(m => ({ ...m, [sKey]: { status: 'applying', done: 0, total: enabledTotal } }))

      let totalDone = 0, totalFailed = 0
      const records: AppliedRecord[] = []
      const bump = (d: number) =>
        setApplyMap(m => ({ ...m, [sKey]: { status: 'applying', done: totalDone + d, total: enabledTotal } }))

      if (memberPosters.length > 0) {
        const movieMap = new Map<string, { child: LibraryItem; posters: PosterInfo[] }>()
        for (const p of memberPosters) {
          const child = matchCollectionChild(p, collectionMembers)
          if (!child) continue
          const existing = movieMap.get(child.key)
          if (existing) existing.posters.push(p)
          else movieMap.set(child.key, { child, posters: [p] })
        }
        for (const { child, posters } of movieMap.values()) {
          const memberRes = await applyPosters(child.key, posters, types, bump)
          totalDone += memberRes.done; totalFailed += memberRes.failed
          if (memberRes.done > 0) {
            const thumb = mainThumb(posters)
            records.push({
              itemKey: child.key, title: child.title, year: child.year, type: 'movie',
              source: s.source, thumb: thumb ?? child.thumb, setId: s.id, uploader: s.uploader,
              posterUrls: memberRes.appliedUrls, slots: memberRes.appliedSlots, appliedAt: new Date().toISOString(),
            })
            if (thumb) onItemPoster(child.key, thumb)
          }
        }
      }

      if (collArt.length) {
        const collRes = await applyPosters(item.key, collArt, types, bump)
        totalDone += collRes.done; totalFailed += collRes.failed
        if (collRes.done > 0) {
          const thumb = mainThumb(collArt) ?? item.thumb
          records.push({
            itemKey: item.key, title: item.title, type: 'collection',
            source: s.source, thumb, setId: s.id, uploader: s.uploader,
            posterUrls: collRes.appliedUrls, slots: collRes.appliedSlots, appliedAt: new Date().toISOString(),
          })
          if (thumb) onItemPoster(item.key, thumb)
        }
      }

      let historyError: string | undefined
      if (records.length > 0) {
        historyError = await recordAppliedBatch(records).then(() => undefined, (err: unknown) => errorMessage(err))
        const appliedUrls = records.flatMap(r => r.posterUrls ?? [])
        setAppliedIdx(prev => ({
          setKeys: new Set(prev.setKeys).add(sKey),
          titles: prev.titles,
          posterUrls: new Set([...prev.posterUrls, ...appliedUrls]),
          currentByItem: records.reduce((map, r) => map.set(r.itemKey, sKey), new Map(prev.currentByItem)),
          currentPosterUrls: new Set([...prev.currentPosterUrls, ...appliedUrls]),
        }))
        bumpArtReload()
      }
      setApplyMap(m => ({
        ...m,
        [sKey]: { status: totalFailed && !totalDone ? 'error' : 'done', done: totalDone, total: enabledTotal, error: applyError(totalFailed, historyError) },
      }))
      return
    }

    // A plain movie/show set has no collection dimension, so the scope toggle is
    // never shown for it (see `showScope`); its posters must always apply. Only
    // suppress the viewed item's own art when the scope control is actually
    // present and the user set it to "none".
    const scopeControllable = hasCollectionArt || collectionInLib > 1
    // One poster per Plex slot (see resolveVariants): two posters for the same
    // slot would otherwise both upload, and the last would win.
    const viewedPosters = resolveVariants(
      scopeControllable && scope.movies === 'none' ? [] : [...plain, ...members.filter(isThisItem)],
      'title', chosen,
    )
    const siblingMembers = resolveVariants(
      scope.movies === 'all' ? members.filter(p => !isThisItem(p) && memberInLib.get(memberKey(p))) : [],
      'title', chosen,
    )
    const collArt = scope.collectionPoster ? resolveVariants(collectionArt, 'title', chosen) : []

    const willApply = [...viewedPosters, ...siblingMembers, ...collArt]
    const enabledTotal = willApply.filter(p => types.has(posterFileType(p))).length
    if (enabledTotal === 0) return
    setApplyMap(m => ({ ...m, [sKey]: { status: 'applying', done: 0, total: enabledTotal } }))

    let totalDone = 0, totalFailed = 0
    const records: AppliedRecord[] = []
    const bump = (d: number) =>
      setApplyMap(m => ({ ...m, [sKey]: { status: 'applying', done: totalDone + d, total: enabledTotal } }))

    // 1. The viewed item's own art.
    const mainRes = await applyPosters(item.key, viewedPosters, types, bump)
    totalDone += mainRes.done; totalFailed += mainRes.failed
    if (mainRes.done > 0) {
      const thumb = mainThumb(viewedPosters)
      records.push({
        itemKey: item.key, title: item.title, year: item.year, type: item.type,
        source: s.source, thumb: thumb ?? item.thumb, setId: s.id, uploader: s.uploader,
        posterUrls: mainRes.appliedUrls, slots: mainRes.appliedSlots, appliedAt: new Date().toISOString(),
      })
      if (thumb) onItemPoster(item.key, thumb)
    }

    // 2. Sibling movies in the collection: resolve each to its own Plex key.
    if (siblingMembers.length > 0) {
      const movieMap = new Map<string, { title: string; year?: number; tmdbId?: string; posters: PosterInfo[] }>()
      for (const p of siblingMembers) {
        const key = p.tmdbId ?? `${p.title.toLowerCase()}|${p.year ?? ''}`
        const existing = movieMap.get(key)
        if (existing) existing.posters.push(p)
        else movieMap.set(key, { title: p.title, year: p.year, tmdbId: p.tmdbId, posters: [p] })
      }
      for (const m of movieMap.values()) {
        const found = await window.api.plex.findItem(m.title, m.year, undefined, m.tmdbId) as { key: string; title: string; year?: number; type: string; thumb?: string; libraryTitle?: string } | null
        // Not in the library - skip quietly rather than reporting a failure.
        if (!found) continue
        const memberRes = await applyPosters(found.key, m.posters, types, bump)
        totalDone += memberRes.done; totalFailed += memberRes.failed
        if (memberRes.done > 0) {
          const thumb = mainThumb(m.posters)
          records.push({
            itemKey: found.key, title: found.title, year: found.year,
            type: (found.type === 'movie' ? 'movie' : 'show'),
            source: s.source, thumb: thumb ?? found.thumb, setId: s.id, uploader: s.uploader,
            posterUrls: memberRes.appliedUrls, slots: memberRes.appliedSlots, appliedAt: new Date().toISOString(),
          })
          if (thumb) onItemPoster(found.key, thumb)
        }
      }
    }

    // 3. Collection-level art onto the matching Plex Collection objects. A set
    //    can carry art for several collections (a franchise and its spin-off);
    //    each is matched by its own name.
    if (collArt.length) {
      const byCollection = new Map<string, PosterInfo[]>()
      for (const p of collArt) {
        const name = collectionName(p.title)
        const list = byCollection.get(name)
        if (list) list.push(p)
        else byCollection.set(name, [p])
      }
      for (const posters of byCollection.values()) {
        const coll = await window.api.plex.findCollection(posters[0].title) as { key: string; title: string; thumb?: string; libraryTitle?: string } | null
        // No matching Plex Collection object - skip quietly (the movies still applied).
        if (!coll) continue
        const collRes = await applyPosters(coll.key, posters, types, bump)
        totalDone += collRes.done; totalFailed += collRes.failed
        if (collRes.done > 0) {
          records.push({
            itemKey: coll.key, title: coll.title, type: 'collection',
            source: s.source, thumb: mainThumb(posters) ?? coll.thumb, setId: s.id, uploader: s.uploader,
            posterUrls: collRes.appliedUrls, slots: collRes.appliedSlots, appliedAt: new Date().toISOString(),
          })
        }
      }
    }

    // One atomic write so every touched item keeps its Reset Posters row.
    let historyError: string | undefined
    if (records.length > 0) {
      historyError = await recordAppliedBatch(records).then(() => undefined, (err: unknown) => errorMessage(err))
      const appliedUrls = records.flatMap(r => r.posterUrls ?? [])
      setAppliedIdx(prev => ({
        setKeys: new Set(prev.setKeys).add(sKey),
        titles: new Set([...prev.titles, ...records.map(r => appliedKey(r.title, r.year))]),
        posterUrls: new Set([...prev.posterUrls, ...appliedUrls]),
        currentByItem: records.reduce((map, r) => map.set(r.itemKey, sKey), new Map(prev.currentByItem)),
        currentPosterUrls: new Set([...prev.currentPosterUrls, ...appliedUrls]),
      }))
      bumpArtReload()
    }
    setApplyMap(m => ({
      ...m,
      [sKey]: { status: totalFailed && !totalDone ? 'error' : 'done', done: totalDone, total: enabledTotal, error: applyError(totalFailed, historyError) },
    }))
  }

  return (
    <motion.div
      className={styles.panel}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.3 }}
    >
      <div
        className={`${styles.panelResizeHandle} ${resizing ? styles.panelResizeHandleActive : ''}`}
        onMouseDown={startPanelResize}
        onDoubleClick={resetPanelWidth}
        title="Drag to resize · double-click to reset"
      >
        <span className={styles.panelResizeGrip} />
      </div>
      <div className={styles.panelHeader}>
        {/* Keyed on item.key: the panel chrome (position, resize handle,
            width) stays mounted across item switches, only this title
            crossfades. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={item.key}
            className={styles.panelTitleWrap}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <h2 className={styles.panelTitle}>{item.title}</h2>
            {isCollectionItem && item.childCount != null && (
              <span className={styles.panelYear}>{item.childCount} movie{item.childCount !== 1 ? 's' : ''}</span>
            )}
            {!isCollectionItem && item.year && <span className={styles.panelYear}>{item.year}</span>}
          </motion.div>
        </AnimatePresence>
        <div className={styles.panelHeaderActions}>
          <button
            className={`${styles.panelRefresh} ${linkOpen ? styles.panelActionOn : ''}`}
            onClick={() => updateLinkUi({ open: !linkOpen, error: null })}
            title="Link a set from MediUX or ThePosterDB to this title"
            aria-pressed={linkOpen}
          >
            <Link2 size={14} />
          </button>
          <button
            className={styles.panelRefresh}
            onClick={refreshSets}
            disabled={loading && !refreshing}
            title="Refresh sets"
          >
            <RefreshCw size={14} className={refreshing ? styles.spin : undefined} />
          </button>
          <button className={styles.panelClose} onClick={onClose}><X size={16} /></button>
        </div>
      </div>

      <CurrentArtStrip slots={artSlots} loading={artLoading} />

      {linkOpen && (
        <form className={styles.linkRow} onSubmit={e => { e.preventDefault(); void submitLink() }}>
          <span className={styles.addLabel}>Link a set to this title</span>
          <div className={styles.addField}>
            <Link2 size={14} className={styles.addIcon} />
            <input
              ref={linkInputRef}
              className={styles.addInput}
              placeholder="MediUX or ThePosterDB link: a set, a poster, or the title's own page"
              value={linkUrl}
              onChange={e => updateLinkUi({ url: e.target.value })}
              spellCheck={false}
            />
            <button type="submit" className={styles.addBtn} disabled={!linkUrl.trim() || linking} title="Add">
              {linking ? <Loader2 size={14} className={styles.spin} /> : <Plus size={14} />}
            </button>
          </div>
          {linkError && <p className={styles.addError}>{linkError}</p>}
          <p className={styles.linkHint}>
            The sets behind the link join this title&apos;s list and are remembered. Paste the title&apos;s own page on either site to use every set listed there.
          </p>
        </form>
      )}

      {/* Filters */}
      {!loading && !error && allSets.length > 0 && (
        <div className={styles.filters}>
          {/* Only worth a row when both sites answered; the card badges and
              the notices cover a single-site list. */}
          {sourceCounts.mediux > 0 && sourceCounts.posterdb > 0 && (
            <div className={styles.sourceToggles} role="group" aria-label="Source">
              <button
                className={`${styles.sourceToggle} ${activeSource === 'all' ? styles.sourceToggleOn : ''}`}
                onClick={() => setSource('all')}
                aria-pressed={activeSource === 'all'}
                title="Show sets from both sites"
              >
                All <span className={styles.sourceCount}>{allSets.length}</span>
              </button>
              {SOURCES.map(src => (
                <button
                  key={src}
                  className={`${styles.sourceToggle} ${activeSource === src ? styles.sourceToggleOn : ''}`}
                  onClick={() => setSource(src)}
                  aria-pressed={activeSource === src}
                  title={`Show only ${SOURCE_LABEL[src]} sets`}
                >
                  {SOURCE_LABEL[src]} <span className={styles.sourceCount}>{sourceCounts[src]}</span>
                </button>
              ))}
            </div>
          )}
          <Select
            value={activeUploader}
            onChange={setUploader}
            searchable={uploaders.length > 5}
            options={[
              { value: 'all', label: `All uploaders (${sourceSets.length})`, icon: <User size={13} /> },
              ...uploaders.map(u => ({ value: u.value, label: u.label })),
            ]}
          />
          <div className={styles.typeToggles}>
            {ALL_TYPES.map(t => (
              <button
                key={t}
                className={`${styles.typeToggle} ${types.has(t) ? styles.typeToggleOn : ''}`}
                onClick={() => toggleType(t)}
              >
                {t === 'title_card' ? 'Title Cards' : t === 'backdrop' ? 'Backdrops' : 'Posters'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Body. Scroll position and content fade both key off item.key since
          this container - like the panel itself - now persists across item
          switches instead of remounting. */}
      <div className={styles.panelBody} ref={panelBodyRef}>
        <motion.div
          key={item.key}
          className={styles.panelBodyInner}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18 }}
        >
        {loading && <div className={styles.panelLoading}><Spinner size="sm" /> <span>{isCollectionItem ? 'Finding collection sets on MediUX and ThePosterDB…' : 'Finding sets on MediUX and ThePosterDB…'}</span></div>}

        {!loading && pending.size > 0 && (
          <div className={styles.panelInlineNotice}>
            <Loader2 size={13} className={styles.spin} />
            <span>Still searching {[...pending].map(s => SOURCE_LABEL[s]).join(' and ')}…</span>
          </div>
        )}

        {creatorError && (
          <div className={styles.panelInlineNotice}>
            <AlertCircle size={13} />
            <span>Could not save that creator preference: {creatorError}</span>
          </div>
        )}

        {/* A site that could not be searched is a note beside the other site's
            sets, never a reason to hide them. */}
        {!loading && SOURCES.filter(s => sourceErrors[s]).map(s => (
          <div key={s} className={styles.panelInlineNotice}>
            <AlertCircle size={13} />
            <span>{SOURCE_LABEL[s]} could not be searched: {sourceErrors[s]}</span>
          </div>
        ))}

        {/* A link whose page could not be read this time stays attached; the
            user can retry with Refresh or let it go. */}
        {linkErrors.map((e, i) => (
          <div key={e.url || i} className={styles.panelInlineNotice}>
            <AlertCircle size={13} />
            <span>
              A linked page could not be read: {e.error}
              {e.url && <>{' '}<span className={styles.linkUrl}>{e.url}</span>{' '}<button className={styles.noteSearchLink} onClick={() => unlink(e.url)}>Unlink</button></>}
            </span>
          </div>
        ))}

        {error === 'no_movies' && (
          <div className={styles.panelNotice}>
            <AlertCircle size={20} />
            <p><strong>No movies in this collection.</strong></p>
            <p className={styles.noticeSub}>Plex needs at least one movie in the collection to discover MediUX collection art.</p>
          </div>
        )}

        {error === 'no_tmdb' && isCollectionItem && (
          <div className={styles.panelNotice}>
            <AlertCircle size={20} />
            <p><strong>No TMDB ids for collection members.</strong></p>
            <p className={styles.noticeSub}>
              {hasTmdbKey
                ? <>Plex did not expose TMDB ids for the movies in this collection, so MediUX cannot look up collection art.</>
                : <>Add a free TMDB API key in Settings so member movies can be matched to MediUX.</>}
            </p>
          </div>
        )}

        {error === 'no_tmdb' && !isCollectionItem && (() => {
          const agent = item.tvdbId ? 'TVDB' : item.imdbId ? 'IMDb' : item.anidbId ? 'AniDB' : 'non-TMDB'
          // A key only helps convert tvdb/imdb ids via TMDB; AniDB is mapped
          // separately, so its failures mean "no known mapping", not "add a key".
          const keyWouldHelp = !hasTmdbKey && (item.tvdbId || item.imdbId)
          return (
            <div className={styles.panelNotice}>
              <AlertCircle size={20} />
              <p><strong>No TMDB match for this item.</strong></p>
              <p className={styles.noticeSub}>
                {keyWouldHelp ? (
                  <>This title uses a {agent} agent. Add a free TMDB API key in Settings to auto-convert it to TMDB.</>
                ) : (
                  <>This title&apos;s {agent} id has no known TMDB mapping, so MediUX has no sets to show for it.</>
                )}
              </p>
              <p className={styles.noticeSub}>ThePosterDB matches on title instead, and had nothing for this one either.</p>
            </div>
          )
        })()}
        {error && error !== 'no_tmdb' && (
          <div className={styles.panelNotice}><AlertCircle size={20} /><p>{error}</p></div>
        )}

        {/* Sets came back from ThePosterDB (title match) but MediUX was skipped
            for want of a TMDB id - worth saying, not worth hiding results for.
            A key only converts TVDB/IMDb ids, so it is suggested only then. */}
        {!loading && !error && tmdbMissing && sets.length > 0 && (
          <div className={styles.panelInlineNotice}>
            <AlertCircle size={13} />
            <span>
              ThePosterDB sets only: this item has no TMDB id, so MediUX could not be searched.
              {!hasTmdbKey && (item.tvdbId || item.imdbId) && ' Add a TMDB API key in Settings to include it.'}
            </span>
          </div>
        )}

        {!loading && !error && posterdbMore && (
          <div className={styles.panelInlineNotice}>
            <ImageIcon size={13} />
            <span>
              ThePosterDB lists more sets for this title than are shown here.{' '}
              <button className={styles.noteSearchLink} onClick={() => window.api.app.openExternal(posterdbMore)}>Open on ThePosterDB</button>
            </span>
          </div>
        )}

        {!loading && !error && pending.size === 0 && allSets.length === 0 && (() => {
          const searched = SOURCES.filter(s => !sourceErrors[s])
          return (
            <div className={styles.panelNotice}>
              <ImageIcon size={20} />
              <p>
                {searched.length === 0
                  ? 'Neither site could be searched for this title.'
                  : `No sets found for this title on ${searched.map(s => SOURCE_LABEL[s]).join(' or ')}.`}
              </p>
              <p className={styles.noticeSub}>
                Know where the art is?{' '}
                <button className={styles.noteSearchLink} onClick={() => updateLinkUi({ open: true })}>Link a set or the title&apos;s page</button>
                {' '}from either site and it will be used here.
              </p>
            </div>
          )
        })()}

        {!loading && !error && allSets.length > 0 && visibleSets.length === 0 && hiddenCount === 0 && (
          <div className={styles.panelNotice}><ImageIcon size={20} /><p>No sets match the current filters.</p></div>
        )}

        {visibleSets.map(s => {
          const sKey = setKey(s)
          // "Applied" = the set currently live on this item; "Downloaded" = a set
          // applied before but since overwritten; "Has art" = title has art elsewhere.
          const isCurrent = appliedIdx.currentByItem.get(item.key) === sKey
          const badge = isCurrent
            ? <span className={styles.matchBadge}><CheckCircle2 size={11} /> Applied</span>
            : appliedIdx.setKeys.has(sKey)
              ? <span className={styles.downloadedBadge}><Download size={11} /> Downloaded</span>
              : itemApplied
                ? <span className={styles.scheduledBadge}><Library size={11} /> Has art</span>
                : undefined
          // Distinct movies this set spans, and how many are actually in the
          // library. The toggle only matters when more than the viewed item is
          // present, and the label reflects what "apply all" will really touch.
          const memberIds = [...new Set(s.posters.filter(p => p.isCollectionMember).map(p => p.tmdbId ?? `${p.title.toLowerCase()}|${p.year ?? ''}`))]
          const collectionTotal = memberIds.length
          const collectionInLib = memberIds.filter(k => memberInLib.get(k)).length
          // Mirror the effectiveCollArt logic in applySet: plain posters act as
          // collection art when viewing from a Plex Collection and the set has no
          // explicitly-tagged collection art or per-movie member posters.
          const hasCollectionArt = s.posters.some(p => p.isCollection)
            || (isCollectionItem
                && !s.posters.some(p => p.isCollectionMember)
                && s.posters.some(p => !p.isCollection && !p.isCollectionMember))
          const applyScope = collectionScope[sKey] ?? defaultSetApplyScope(hasCollectionArt, collectionInLib)
          const showScope = hasCollectionArt || collectionInLib > 1
            || (isCollectionItem && memberIds.some(k => memberInLib.get(k)))
          const scheduledBy = coveringJob(coverage, s.id, s.uploader, s.source)
          return (
            <SetCard
              key={sKey}
              set={s}
              apply={applyMap[sKey]}
              onApply={() => applySet(s)}
              enabledTypes={types}
              creator={creatorOf(s)}
              onCreatorChange={state => {
                // Hiding the creator the dropdown is narrowed to would leave
                // an empty list, and the stale choice would resurface on Show.
                if (state === 'hidden' && uploaderValue(s) === uploader) setUploader('all')
                setCreatorError(null)
                setCreatorState(s.source, s.uploader, state).catch((err: unknown) => setCreatorError(errorMessage(err)))
              }}
              showSource
              badge={badge}
              onSchedule={() => scheduleSet(s)}
              scheduledBy={scheduledBy ? `${scheduledBy.name} · ${describeCron(scheduledBy.cronExpr)}` : undefined}
              onOpenSchedule={scheduledBy ? () => openScheduledJob(scheduledBy.id) : undefined}
              scheduleHint={describeCron(quickCron)}
              scheduleError={scheduleError?.setId === sKey ? scheduleError.message : undefined}
              scheduling={schedulingId === sKey}
              collectionMovies={collectionInLib}
              collectionTotal={collectionTotal}
              hasCollectionArt={hasCollectionArt}
              applyScope={showScope ? applyScope : undefined}
              scopeContext={isCollectionItem ? 'collection' : 'movie'}
              onApplyScopeChange={showScope ? (patch) => {
                setCollectionScope(m => ({
                  ...m,
                  [sKey]: { ...(m[sKey] ?? defaultSetApplyScope(hasCollectionArt, collectionInLib)), ...patch },
                }))
                setApplyMap(m => { const next = { ...m }; delete next[sKey]; return next })
              } : undefined}
              linked={!!s.linkedFrom}
              onUnlink={s.linkedFrom ? () => unlink(s.linkedFrom!) : undefined}
              variantContext={isCollectionItem ? 'collection' : 'title'}
              itemTitle={item.title}
              picks={picks[sKey]}
              onPick={(slot, url) => {
                setPickState(prev => {
                  const bySet = prev.key === item.key ? prev.bySet : {}
                  return { key: item.key, bySet: { ...bySet, [sKey]: { ...(bySet[sKey] ?? {}), [slot]: url } } }
                })
                setApplyMap(m => { const next = { ...m }; delete next[sKey]; return next })
              }}
            />
          )
        })}

        {/* Hidden creators' sets are tucked away, not deleted: say how many
            there are so a short list isn't mistaken for a short catalog. */}
        {!loading && !error && hiddenCount > 0 && (
          <button className={styles.hiddenToggle} onClick={() => setShowHidden(v => !v)}>
            {showHidden ? <EyeOff size={13} /> : <Eye size={13} />}
            {showHidden
              ? `Showing ${hiddenCount} set${hiddenCount !== 1 ? 's' : ''} from hidden creators · Hide`
              : `${hiddenCount} set${hiddenCount !== 1 ? 's' : ''} from hidden creators · Show`}
          </button>
        )}
        </motion.div>
      </div>
    </motion.div>
  )
}

/** Small skeleton-aware thumbnail button used in the SetCard expanded view. */
function ThumbButton({ url, label, episode, onClick, selectable, selected, onSelect }: {
  url: string
  label: string
  episode?: number
  onClick: () => void
  /** The poster competes with others in the set for one Plex slot, so it carries a pick control. */
  selectable?: boolean
  /** This is the poster that will be applied. */
  selected?: boolean
  onSelect?: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const thumb = (
    <button
      className={`${styles.groupThumb} ${!loaded ? styles.skeleton : ''}`}
      title={`${episode != null ? `Episode ${episode}` : label} - click to enlarge`}
      onClick={onClick}
    >
      <img
        src={url}
        alt={label}
        loading="lazy"
        draggable={false}
        className={loaded ? '' : styles.imgPending}
        onLoad={() => setLoaded(true)}
      />
      {episode != null && <span className={styles.epBadge}>E{episode}</span>}
    </button>
  )
  if (!selectable) return thumb
  const pickLabel = selected ? 'This poster will be applied' : 'Apply this poster instead'
  return (
    <div className={`${styles.groupThumbWrap} ${selected ? styles.groupThumbSelected : styles.groupThumbPassed}`}>
      {thumb}
      <button
        className={`${styles.pickBtn} ${selected ? styles.pickBtnOn : ''}`}
        onClick={onSelect}
        aria-pressed={selected}
        title={pickLabel}
        aria-label={pickLabel}
      >
        {selected ? <CheckCircle2 size={14} /> : <Circle size={14} />}
      </button>
    </div>
  )
}

/** Expandable card for one poster set: preview, uploader, source, counts, apply state, and grouped posters. */
function SetCard({ set, apply, onApply, enabledTypes, title, badge, disabled, creator = 'none', onCreatorChange, showSource, selectable, checked, onToggleSelect, onSchedule, scheduledBy, onOpenSchedule, scheduleHint, scheduleError, scheduling, collectionMovies, collectionTotal, hasCollectionArt, applyScope, scopeContext, onApplyScopeChange, linked, onUnlink, variantContext, itemTitle, picks, onPick }: {
  set: PosterSetSummary
  apply?: ApplyState
  onApply: () => void
  enabledTypes: Set<FileType>
  /** When shown (Creators view), the heading is the media title. */
  title?: string
  /** Optional match/applied badge. */
  badge?: React.ReactNode
  /** Disables Apply (e.g. no library match). */
  disabled?: boolean
  /** Whether the uploader is followed or hidden. */
  creator?: CreatorState
  /** Follow, hide or reset the uploader; omit to show no creator controls. */
  onCreatorChange?: (state: CreatorState) => void
  /** Tag the card with its site; for lists that mix MediUX and ThePosterDB. */
  showSource?: boolean
  /** Shows a selection checkbox (Creators sync). */
  selectable?: boolean
  checked?: boolean
  onToggleSelect?: () => void
  /** Creates a sync job for this set (library view). */
  onSchedule?: () => void
  /** Name and schedule of the job that already syncs this set. */
  scheduledBy?: string
  /** Opens the covering job in the Scheduler. */
  onOpenSchedule?: () => void
  /** Plain-language schedule a new job would use. */
  scheduleHint?: string
  /** Why the last schedule request for this set failed. */
  scheduleError?: string
  /** A schedule request for this set is in flight. */
  scheduling?: boolean
  /** How many of this collection set's movies are in the library (the spread target count). */
  collectionMovies?: number
  /** Total movies the collection set spans, including any not in the library. */
  collectionTotal?: number
  /** Set includes a collection-level poster (applied to the Plex Collection object). */
  hasCollectionArt?: boolean
  /** Independent movie / collection-poster apply choices. */
  applyScope?: SetApplyScope
  /** Whether scope labels refer to a Plex Collection or a single movie. */
  scopeContext?: 'movie' | 'collection'
  onApplyScopeChange?: (patch: Partial<SetApplyScope>) => void
  /** The set came from a link the user attached to this title. */
  linked?: boolean
  /** Detaches that link. */
  onUnlink?: () => void
  /** Offers a pick when several posters in the set compete for one Plex slot; omit to show none. */
  variantContext?: ApplyContext
  /** The viewed item's title, so the collection poster named after it is the default pick. */
  itemTitle?: string
  /** Chosen poster URL by slot key (see variantKey). */
  picks?: Record<string, string>
  onPick?: (slot: string, url: string) => void
}) {
  const [err, setErr]               = useState(false)
  const [previewLoaded, setPreviewLoaded] = useState(false)
  // A ThePosterDB avatar can be the fallback CDN guess, which 403s for users
  // without an upload. Remembered per URL, so a refreshed avatar gets a new try.
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const status = apply?.status ?? 'idle'
  const openCreator = useContext(CreatorNav)
  const isPosterdb = set.source === 'posterdb'
  // Radio groups must not collide when both sites contribute a set numbered the same.
  const scopeName = `scope-movies-${setKey(set)}`

  const scopeBlocksApply = applyScope != null
    && applyScope.movies === 'none'
    && !applyScope.collectionPoster
  const applyDisabled = disabled || scopeBlocksApply

  const groups = useMemo(() => groupPosters(set.posters), [set.posters])
  // Only the groups whose file type is enabled by the type chips; the preview,
  // counts and lightbox all key off this so the filter drives what's shown.
  const visibleGroups = useMemo(() => groups.filter(g => enabledTypes.has(g.kind)), [groups, enabledTypes])
  const totalCount = visibleGroups.reduce((n, g) => n + g.posters.length, 0)

  // Flattened poster list in group order for the full-screen lightbox
  const [lightbox, setLightbox] = useState<number | null>(null)
  const lightboxImages = useMemo<LightboxImage[]>(
    () => visibleGroups.flatMap(g => g.posters.map(p => ({
      url: p.url,
      label: g.label,
      caption: p.episode != null ? `Episode ${p.episode}` : (p.title || undefined),
    }))),
    [visibleGroups],
  )

  return (
    <div className={`${styles.setCard} ${creator === 'followed' ? styles.setCardFollowed : ''} ${creator === 'hidden' ? styles.setCardHidden : ''} ${checked ? styles.setCardChecked : ''}`}>
      <div className={styles.setRow}>
        {selectable && (
          <div className={styles.setSelect}>
            <Checkbox checked={!!checked} onChange={() => onToggleSelect?.()} />
          </div>
        )}
        <div className={`${styles.setPreview} ${!err && set.previewUrl && !previewLoaded ? styles.skeleton : ''}`}>
          {!err && set.previewUrl ? (
            <img
              src={set.previewUrl}
              alt={set.setName}
              loading="lazy"
              draggable={false}
              className={previewLoaded ? '' : styles.imgPending}
              onLoad={() => setPreviewLoaded(true)}
              onError={() => setErr(true)}
            />
          ) : (
            <div className={styles.setPreviewFallback}><ImageIcon size={18} /></div>
          )}
        </div>

        <div className={styles.setInfo}>
          {title && <div className={styles.setHeadingRow}><span className={styles.setTitle}>{title}</span>{badge}</div>}

          <div className={styles.setUploaderRow}>
            <button
              className={`${styles.setUploader} ${styles.uploaderLink}`}
              // The Creators tab browses MediUX only, so a ThePosterDB uploader
              // opens their profile on ThePosterDB instead of a tab that would
              // come back empty.
              onClick={() => isPosterdb
                ? window.api.app.openExternal(creatorUrl(set.source, set.uploader))
                : openCreator(set.uploader)}
              title={isPosterdb ? `Open ${set.uploader} on ThePosterDB` : `View ${set.uploader} in Creators`}
            >
              {set.uploaderAvatar && failedAvatar !== set.uploaderAvatar ? (
                <img className={styles.avatar} src={set.uploaderAvatar} alt={set.uploader} onError={() => setFailedAvatar(set.uploaderAvatar ?? null)} />
              ) : (
                <div className={styles.avatarFallback}><User size={11} /></div>
              )}
              <span className={styles.uploaderName}>{set.uploader}</span>
              {creator === 'followed' && !onCreatorChange && <Star size={10} className={styles.followStar} />}
            </button>
            {showSource && <Badge variant={set.source}>{SOURCE_SHORT[set.source]}</Badge>}
            {linked && (
              <span className={styles.linkedBadge} title={set.linkedFrom ? `Linked from ${set.linkedFrom}` : 'Linked to this title'}>
                <Link2 size={10} /> Linked
              </span>
            )}
            {onCreatorChange && (
              // Both toggles depict state, like the star: lit when on. The
              // accessible name stays constant and aria-pressed carries the state.
              <div className={styles.creatorActions}>
                <button
                  className={`${styles.creatorAction} ${creator === 'followed' ? styles.creatorActionOn : ''}`}
                  onClick={() => onCreatorChange(creator === 'followed' ? 'none' : 'followed')}
                  title={creator === 'followed' ? `Unfollow ${set.uploader}` : `Follow ${set.uploader}: their sets come first and are highlighted`}
                  aria-label={`Follow ${set.uploader}`}
                  aria-pressed={creator === 'followed'}
                >
                  <Star size={12} fill={creator === 'followed' ? 'currentColor' : 'none'} />
                </button>
                <button
                  className={`${styles.creatorAction} ${creator === 'hidden' ? styles.creatorActionOn : ''}`}
                  onClick={() => onCreatorChange(creator === 'hidden' ? 'none' : 'hidden')}
                  title={creator === 'hidden' ? `Unhide ${set.uploader}` : `Hide ${set.uploader}'s sets`}
                  aria-label={`Hide ${set.uploader}`}
                  aria-pressed={creator === 'hidden'}
                >
                  {creator === 'hidden' ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            )}
            {onUnlink && (
              <button
                className={styles.unlinkAction}
                onClick={onUnlink}
                title="Unlink this set from the title"
                aria-label="Unlink this set from the title"
              >
                <Link2Off size={12} />
              </button>
            )}
            {!title && badge && <span className={styles.setTrailing}>{badge}</span>}
          </div>

          <div className={styles.setCounts}>
            {enabledTypes.has('poster')     && set.posterCount > 0    && <span className={styles.countBadge}>{set.posterCount} poster{set.posterCount !== 1 ? 's' : ''}</span>}
            {enabledTypes.has('title_card') && set.titleCardCount > 0 && <span className={styles.countBadge}>{set.titleCardCount} card{set.titleCardCount !== 1 ? 's' : ''}</span>}
            {enabledTypes.has('backdrop')   && set.backdropCount > 0  && <span className={styles.countBadge}>{set.backdropCount} backdrop{set.backdropCount !== 1 ? 's' : ''}</span>}
            {set.downloads != null && <span className={styles.countBadge} title="Downloads on MediUX">{set.downloads.toLocaleString()} download{set.downloads !== 1 ? 's' : ''}</span>}
          </div>

          <div className={styles.setActions}>
            {status === 'idle' && (
              <Button variant="primary" size="sm" icon={<Upload size={12} />} onClick={onApply} disabled={applyDisabled}>Apply</Button>
            )}
            {status === 'applying' && (
              <span className={styles.applyProgress}><Loader2 size={13} className={styles.spin} /> {apply!.done}/{apply!.total}</span>
            )}
            {status === 'done' && (
              <span className={styles.applyDone}><Check size={13} /> Applied {apply!.done}{apply!.error ? ` · ${apply!.error}` : ''}</span>
            )}
            {status === 'error' && (
              <span className={styles.applyError}><AlertCircle size={13} /> {apply!.error ?? 'Failed'}
                <button className={styles.retry} onClick={onApply}>Retry</button>
              </span>
            )}
            {onSchedule && !disabled && (
              scheduledBy
                ? <button className={styles.scheduledTag} onClick={onOpenSchedule} title={`Synced by ${scheduledBy}. Click to open it in the Scheduler.`}>
                    <CalendarClock size={12} /> Scheduled
                  </button>
                : <button
                    className={styles.scheduleBtn}
                    onClick={onSchedule}
                    disabled={scheduling}
                    title={`Apply new artwork from this set automatically${scheduleHint ? ` (${scheduleHint})` : ''}`}
                  >
                    {scheduling ? <Loader2 size={12} className={styles.spin} /> : <CalendarClock size={12} />} Schedule
                  </button>
            )}
          </div>
          {scheduleError && (
            <div className={styles.scheduleError} role="alert">
              <AlertCircle size={12} /> Couldn&apos;t schedule: {scheduleError}
            </div>
          )}
        </div>
      </div>

      {applyScope && onApplyScopeChange && (
        <div className={styles.scopeToggle} title="Choose whether to update movie posters, the Plex Collection poster, or both.">
          {(collectionMovies ?? 0) >= 1 && (
            <div className={styles.scopeBlock}>
              <Checkbox
                checked={applyScope.movies !== 'none'}
                onChange={() => onApplyScopeChange({
                  movies: applyScope.movies === 'none'
                    ? ((collectionMovies ?? 0) > 1 ? 'all' : 'this')
                    : 'none',
                })}
                label="Apply to movies"
              />
              {applyScope.movies !== 'none' && (collectionMovies ?? 0) > 1 && scopeContext !== 'collection' && (
                <div className={styles.scopeSubOptions}>
                  <label className={styles.scopeRadio}>
                    <input
                      type="radio"
                      name={scopeName}
                      checked={applyScope.movies === 'this'}
                      onChange={() => onApplyScopeChange({ movies: 'this' })}
                    />
                    This movie only
                  </label>
                  <label className={styles.scopeRadio}>
                    <input
                      type="radio"
                      name={scopeName}
                      checked={applyScope.movies === 'all'}
                      onChange={() => onApplyScopeChange({ movies: 'all' })}
                    />
                    All {(collectionTotal && collectionTotal > (collectionMovies ?? 0))
                      ? `${collectionMovies} of ${collectionTotal} movies`
                      : `${collectionMovies} movies`} in library
                  </label>
                </div>
              )}
              {applyScope.movies !== 'none' && (collectionMovies ?? 0) > 1 && scopeContext === 'collection' && (
                <div className={styles.scopeSubOptions}>
                  <label className={styles.scopeRadio}>
                    <input
                      type="radio"
                      name={scopeName}
                      checked={applyScope.movies === 'all'}
                      onChange={() => onApplyScopeChange({ movies: 'all' })}
                    />
                    All {(collectionTotal && collectionTotal > (collectionMovies ?? 0))
                      ? `${collectionMovies} of ${collectionTotal} movies`
                      : `${collectionMovies} movies`} in collection
                  </label>
                </div>
              )}
            </div>
          )}
          {hasCollectionArt && (
            <Checkbox
              checked={applyScope.collectionPoster}
              onChange={() => onApplyScopeChange({ collectionPoster: !applyScope.collectionPoster })}
              label="Apply collection poster"
            />
          )}
        </div>
      )}

      <button className={`${styles.setExpandBar} ${open ? styles.setExpandBarOpen : ''}`} onClick={() => setOpen(v => !v)}>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span>{open ? 'Hide posters' : `Preview ${totalCount} poster${totalCount !== 1 ? 's' : ''}`}</span>
      </button>

      {/* Grouped contents; posters never mixed across types */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.setGroups}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {(() => {
              let flat = -1
              return visibleGroups.map(g => {
                // Posters competing for one Plex slot: only one of them is
                // applied, so the group offers a pick.
                const clusters = variantContext ? variantClusters(g.posters, variantContext) : null
                const hasChoice = !!clusters && [...clusters.values()].some(c => c.length > 1)
                return (
                  <div key={g.label} className={styles.group}>
                    <div className={styles.groupLabel}>
                      {g.label}
                      <span className={styles.groupCount}>{g.posters.length}</span>
                      {hasChoice && <span className={styles.groupHint}>One is applied: pick it</span>}
                    </div>
                    <div className={`${styles.groupThumbs} ${g.kind === 'title_card' || g.kind === 'backdrop' ? styles.groupThumbsWide : ''}`}>
                      {g.posters.map(p => {
                        flat++
                        const idx = flat
                        const slot = variantContext ? variantKey(p, variantContext) : ''
                        const cluster = clusters?.get(slot)
                        const choosable = !!cluster && cluster.length > 1
                        const chosen = choosable ? (picks?.[slot] ?? defaultVariant(cluster, itemTitle).url) : undefined
                        return (
                          <ThumbButton
                            key={p.url}
                            url={p.thumbUrl ?? p.url}
                            label={g.label}
                            episode={p.episode}
                            onClick={() => setLightbox(idx)}
                            selectable={choosable}
                            selected={chosen === p.url}
                            onSelect={() => onPick?.(slot, p.url)}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lightbox !== null && (
          <Lightbox images={lightboxImages} index={lightbox} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

/** Single-file tile for the Posters / Backdrops / Title Cards tabs in Creators. */
function FileTile({ poster, set, st, done, error, onLightbox, onApply }: {
  poster: PosterInfo
  set: MediuxUserSet
  st?: string
  done: boolean
  error?: string
  onLightbox: () => void
  onApply: () => void
}) {
  const [loaded, setLoaded] = useState(false)

  function shortError(e: string): string {
    if (/not connected/i.test(e)) return 'Not connected'
    if (/403/.test(e))            return 'Auth error (403)'
    if (/404/.test(e))            return 'Not found (404)'
    if (/download failed/i.test(e)) return e.replace(/.*:\s*/, '').slice(0, 22)
    return e.slice(0, 22)
  }

  return (
    <div className={styles.fileTile}>
      <button
        className={`${styles.fileThumb} ${!loaded ? styles.skeleton : ''}`}
        onClick={onLightbox}
        title={set.title}
      >
        <img
          src={poster.thumbUrl ?? poster.url}
          alt={set.title}
          loading="lazy"
          draggable={false}
          className={loaded ? '' : styles.imgPending}
          onLoad={() => setLoaded(true)}
        />
      </button>
      <div className={styles.fileMeta}>
        <span className={styles.fileTitle} title={set.title}>
          {set.year ? `${set.title} (${set.year})` : set.title}
          {poster.episode != null && (
            <span className={styles.fileEpBadge}>
              {typeof poster.season === 'number' ? `S${poster.season} ` : ''}E{poster.episode}
            </span>
          )}
        </span>
        {!set.matchedKey
          ? <span className={styles.fileNoMatch}>Not in library</span>
          : done
            ? <span className={styles.fileApplied}><Check size={11} /> Applied</span>
            : st === 'applying'
              ? <span className={styles.fileApplied}><Loader2 size={11} className={styles.spin} /></span>
              : st === 'error'
                ? <span className={styles.fileError} title={error}><AlertCircle size={11} /> {error ? shortError(error) : 'Failed'}</span>
                : <button className={styles.fileApplyBtn} onClick={onApply}><Upload size={11} /> Apply</button>}
      </div>
    </div>
  )
}

/** Creators view: followed and hidden creator rails plus the selected creator's sets. */
function CreatorsView({ initialCreator }: { initialCreator: string | null }) {
  const { prefs, stateOf, setState } = useCreatorPrefs()
  const subs = prefs.mediuxFollows
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>({ setKeys: new Set(), titles: new Set(), posterUrls: new Set(), currentByItem: new Map(), currentPosterUrls: new Set() })
  // The creator picked in the rail (or via a clicked badge); until one is,
  // the first followed creator is shown.
  const [picked, setActive]   = useState<string | null>(null)
  const active = picked ?? subs[0] ?? null
  const [adding, setAdding]   = useState('')
  const [prefsError, setPrefsError] = useState<string | null>(null)

  useEffect(() => { loadAppliedIndex().then(setAppliedIdx) }, [])

  // A username arriving from a clicked badge (preview, may not be followed)
  useEffect(() => {
    if (initialCreator) setActive(initialCreator)
  }, [initialCreator])

  // The Creators tab browses MediUX catalogs; ThePosterDB creators open on
  // their own site instead.
  const openTpdb = (name: string) => window.api.app.openExternal(creatorUrl('posterdb', name))

  const savePrefs = (run: Promise<unknown>) => {
    setPrefsError(null)
    run.catch((err: unknown) => setPrefsError(errorMessage(err)))
  }

  async function addCreator() {
    const parsed = parseCreatorInput(adding)
    if (!parsed) {
      setPrefsError('Enter a username or a MediUX / ThePosterDB profile link.')
      return
    }
    setPrefsError(null)
    try {
      if (stateOf(parsed.source, parsed.name) !== 'followed') await setState(parsed.source, parsed.name, 'followed')
      if (parsed.source === 'mediux') setActive(parsed.name)
      setAdding('')
    } catch (err) {
      setPrefsError(errorMessage(err))
    }
  }

  async function removeCreator(name: string) {
    try {
      setPrefsError(null)
      const next = await setState('mediux', name, 'none')
      if (active?.toLowerCase() === name.toLowerCase()) setActive(next.mediuxFollows[0] ?? null)
    } catch (err) {
      setPrefsError(errorMessage(err))
    }
  }

  const isActive = (name: string) => active?.toLowerCase() === name.toLowerCase()
  const activeState = active ? stateOf('mediux', active) : 'none'

  return (
    <div className={styles.creators}>
      {/* Subscriptions rail */}
      <div className={styles.creatorRail}>
        <div className={styles.railHeader}>Following</div>
        <div className={styles.creatorList}>
          {subs.length === 0 && prefs.posterdbFollows.length === 0 && <p className={styles.railEmpty}>No creators yet. Add one below.</p>}
          {subs.map(name => (
            <div
              key={`mediux:${name}`}
              className={`${styles.creatorItem} ${isActive(name) ? styles.creatorItemActive : ''}`}
              onClick={() => setActive(name)}
            >
              <Star size={12} className={styles.creatorStar} />
              <span className={styles.creatorName}>{name}</span>
              <button className={styles.creatorRemove} onClick={e => { e.stopPropagation(); removeCreator(name) }} title="Unfollow">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {prefs.posterdbFollows.map(name => (
            <div
              key={`posterdb:${name}`}
              className={styles.creatorItem}
              onClick={() => openTpdb(name)}
              title={`Open ${name} on ThePosterDB`}
            >
              <Star size={12} className={styles.creatorStar} />
              <span className={styles.creatorName}>{name}</span>
              <Badge variant="posterdb">{SOURCE_SHORT.posterdb}</Badge>
              <ExternalLink size={11} className={styles.creatorExternal} aria-hidden />
              <button className={styles.creatorRemove} onClick={e => { e.stopPropagation(); savePrefs(setState('posterdb', name, 'none')) }} title="Unfollow">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {prefs.hidden.length > 0 && (
          <>
            <div className={styles.railHeader}>Hidden</div>
            <div className={`${styles.creatorList} ${styles.creatorListHidden}`}>
              {prefs.hidden.map(h => (
                <div
                  key={`${h.source}:${h.username}`}
                  className={`${styles.creatorItem} ${h.source === 'mediux' && isActive(h.username) ? styles.creatorItemActive : ''}`}
                  onClick={() => h.source === 'mediux' ? setActive(h.username) : openTpdb(h.username)}
                  title={h.source === 'mediux' ? `Browse ${h.username}` : `Open ${h.username} on ThePosterDB`}
                >
                  <EyeOff size={12} className={styles.creatorStar} />
                  <span className={styles.creatorName}>{h.username}</span>
                  <Badge variant={h.source}>{SOURCE_SHORT[h.source]}</Badge>
                  {h.source === 'posterdb' && <ExternalLink size={11} className={styles.creatorExternal} aria-hidden />}
                  <button
                    className={styles.creatorRemove}
                    onClick={e => { e.stopPropagation(); savePrefs(setState(h.source, h.username, 'none')) }}
                    title="Unhide"
                  >
                    <Eye size={12} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className={styles.addCreator}>
          <span className={styles.addLabel}>Follow a creator</span>
          <div className={styles.addField}>
            <UserPlus size={14} className={styles.addIcon} />
            <input
              className={styles.addInput}
              placeholder="username or profile link"
              value={adding}
              onChange={e => setAdding(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCreator() }}
              spellCheck={false}
            />
            <button className={styles.addBtn} onClick={addCreator} disabled={!adding.trim()} title="Follow">
              <Plus size={14} />
            </button>
          </div>
          {prefsError && <p className={styles.addError}>{prefsError}</p>}
        </div>
      </div>

      {/* Selected creator's recent sets */}
      <div className={styles.creatorMain}>
        {active ? (
          <CreatorSets
            key={active}
            username={active}
            creator={activeState}
            appliedIdx={appliedIdx}
            onCreatorChange={state => {
              // Pin the selection first: once the creator leaves the followed
              // list, the fallback would move the view to someone else.
              setActive(active)
              savePrefs(setState('mediux', active, state))
            }}
            onApplied={(sKey, itemKey, title, year, urls) => setAppliedIdx(prev => ({
              setKeys: new Set(prev.setKeys).add(sKey),
              titles: new Set(prev.titles).add(appliedKey(title, year)),
              posterUrls: new Set([...prev.posterUrls, ...urls]),
              currentByItem: new Map(prev.currentByItem).set(itemKey, sKey),
              currentPosterUrls: new Set([...prev.currentPosterUrls, ...urls]),
            }))}
          />
        ) : (
          <div className={styles.creatorEmpty}>
            <UserPlus size={32} />
            <p>Follow a creator to browse their newest art.</p>
            <p className={styles.creatorEmptySub}>e.g. <code>aloha_alona</code> or a profile link. MediUX creators are browsed here; ThePosterDB creators open on their site.</p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Placeholder set card so the list keeps its shape while a creator's art loads,
 * instead of a layout-shifting centered spinner.
 */
function SetCardSkeleton() {
  return (
    <div className={styles.setCardSkeleton} aria-hidden="true">
      <div className={`${styles.skelPreview} ${styles.skeleton}`} />
      <div className={styles.skelInfo}>
        <div className={`${styles.skelLine} ${styles.skelTitle} ${styles.skeleton}`} />
        <div className={`${styles.skelLine} ${styles.skelUploader} ${styles.skeleton}`} />
        <div className={styles.skelChips}>
          <span className={`${styles.skelChip} ${styles.skeleton}`} />
          <span className={`${styles.skelChip} ${styles.skeleton}`} />
        </div>
      </div>
    </div>
  )
}

/** Placeholder tabs row so the toolbar holds its place until the real tabs load. */
function SkeletonTabs() {
  return (
    <div className={styles.creatorTabsRow} aria-hidden="true">
      <div className={styles.creatorTabs}>
        {[0, 1, 2, 3].map(i => <span key={i} className={`${styles.skelTab} ${styles.skeleton}`} />)}
      </div>
      <span className={`${styles.skelSearch} ${styles.skeleton}`} />
    </div>
  )
}

/** One creator poster/backdrop/title-card file, paired with its parent set. */
/** How many sets / files render per page in the creator browser. */
const CREATOR_SETS_PER_PAGE = 24
const CREATOR_FILES_PER_PAGE = 60

/** A creator's recent sets with tabs, deep search, selection, and weekly-sync scheduling. */
function CreatorSets({ username, creator, appliedIdx, onCreatorChange, onApplied }: {
  username: string
  /** Whether this MediUX creator is followed or hidden. */
  creator: CreatorState
  appliedIdx: AppliedIndex
  onCreatorChange: (state: CreatorState) => void
  /** Reports an applied set by its source-qualified setKey(). */
  onApplied: (sKey: string, itemKey: string, title: string, year: number | undefined, urls: string[]) => void
}) {
  const following = creator === 'followed'
  const { navigate } = useAppContext()
  const [sets, setSets]       = useState<MediuxUserSet[]>([])
  // First paint (nothing buffered yet) shows skeletons; `crawling` means a
  // background crawl is still streaming in more sets behind what's shown.
  const [loading, setLoading] = useState(true)
  const [crawling, setCrawling] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [applyMap, setApplyMap] = useState<Record<string, ApplyState>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scheduledMsg, setScheduledMsg] = useState<string | null>(null)
  const [tab, setTab]         = useState<'sets' | 'posters' | 'backdrops' | 'titlecards'>('sets')
  const [query, setQuery]     = useState('')
  const [fileLightbox, setFileLightbox] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [capped, setCapped]   = useState(false)
  const [lastChecked, setLastChecked] = useState<number | null>(null)
  const [refreshing, setRefreshing]   = useState(false)
  const [, setNowTick] = useState(0)   // re-renders the "checked Xm ago" stamp
  const [searchResults, setSearchResults] = useState<MediuxUserSet[]>([])
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // Current page (0-based) of the active tab; only this page's items render.
  const [page, setPage] = useState(0)
  // Scroll container for the current page of sets / files.
  const listRef = useRef<HTMLDivElement>(null)
  // Latest sets, for reading inside the chunk subscription without stale closure.
  const setsRef = useRef<MediuxUserSet[]>([])
  useEffect(() => { setsRef.current = sets }, [sets])

  // Saved jobs, kept live; a set is covered individually or by a whole-creator
  // "/user/{name}/sets" sync job.
  const [schedJobs, setSchedJobs] = useState<ScheduledJob[]>([])
  const [quickCron, setQuickCron] = useState(DEFAULT_QUICK_CRON)
  const [scheduling, setScheduling] = useState(false)
  const [scheduledJobId, setScheduledJobId] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const goScheduler = useNavStore(s => s.goScheduler)
  const coverage = useMemo(() => scheduleCoverage(schedJobs), [schedJobs])
  const creatorJob = coverage.creators.get(username.toLowerCase())

  const [allTypes, setAllTypes] = useState<Set<FileType>>(new Set(ALL_TYPES))
  useEffect(() => {
    window.api.config.get().then(c => {
      if (c.mediuxFilters?.length) setAllTypes(new Set(c.mediuxFilters as FileType[]))
      setQuickCron(c.schedulerQuickCron || DEFAULT_QUICK_CRON)
    })
  }, [])

  const refresh = useCallback(() => { setRefreshing(true); setReloadKey(k => k + 1) }, [])

  // Stream the creator's full catalog from the backend's per-creator buffer.
  // start()/refresh() return whatever is buffered right now (instant when the
  // crawl already ran), then `library:userSetsChunk` events append each batch as
  // MediUX pages land. The crawl lives in the main process, so it keeps running
  // when you navigate away - returning re-start()s and paints the grown buffer.
  useEffect(() => {
    let cancelled = false
    const target = username.toLowerCase()
    const forced = reloadKey > 0

    setError(null)
    setSelected(new Set())
    setSets([])
    setsRef.current = []
    setCapped(false)
    setLoading(true)
    setCrawling(true)

    const merge = (incoming: MediuxUserSet[]) => {
      if (!incoming.length) return
      setSets(prev => {
        const seen = new Set(prev.map(s => s.id))
        const out = prev.slice()
        for (const s of incoming) if (!seen.has(s.id)) out.push(s)
        return out
      })
    }

    // Subscribe before start() so no batch emitted in between is missed.
    const unsub = window.api.library.onUserSetsChunk(chunk => {
      if (cancelled || chunk.username.toLowerCase() !== target) return
      if (chunk.reset) {
        // Incremental resync: replace the list with the merged result.
        setSets(chunk.sets)
        setsRef.current = chunk.sets
      } else {
        merge(chunk.sets)
      }
      setCapped(chunk.capped)
      if (chunk.sets.length || chunk.reset) setLoading(false)
      if (chunk.done) {
        setCrawling(false); setLoading(false); setRefreshing(false)
        setLastChecked(Date.now())
        if (chunk.status === 'error' && setsRef.current.length === 0) {
          setError(chunk.error ?? 'Could not load sets')
        }
      }
    })

    const load = forced
      ? window.api.library.refreshUserSets({ username })
      : window.api.library.startUserSets({ username })

    load.then(snap => {
      if (cancelled) return
      merge(snap.sets)
      setCapped(snap.capped)
      if (snap.sets.length) setLoading(false)
      if (snap.status === 'done' || snap.status === 'capped') {
        setCrawling(false); setLoading(false); setRefreshing(false); setLastChecked(Date.now())
      } else if (snap.status === 'error') {
        setCrawling(false); setLoading(false); setRefreshing(false)
        if (snap.sets.length === 0) setError(snap.error ?? 'Could not load sets')
      }
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false); setCrawling(false); setRefreshing(false)
    })

    return () => { cancelled = true; unsub() }
  }, [username, reloadKey])

  // Jump back to the first page whenever the view the user is paging changes.
  useEffect(() => { setPage(0) }, [username, tab, query])

  // Keep the "checked Xm ago" stamp honest while sitting on a creator
  useEffect(() => {
    if (!lastChecked) return
    const id = setInterval(() => setNowTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [lastChecked])

  useEffect(() => {
    window.api.scheduler.list().then(setSchedJobs).catch(() => { /* scheduler unavailable */ })
    return window.api.scheduler.onChange(setSchedJobs)
  }, [])

  // Deep search across the creator's whole catalog (beyond the browse cap): match
  // the query to the user's library, then fetch this creator's sets for those titles
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) { setSearchResults([]); setSearching(false); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(() => {
      window.api.library.creatorSearch({ username, query: term })
        .then(res => { if (!cancelled) setSearchResults(res.sets) })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 550)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, username])

  // In-library matches first, then the rest (keeps newest order within each)
  const q = query.trim().toLowerCase()
  const matchFirst = (a: MediuxUserSet, b: MediuxUserSet) => (a.matchedKey ? 0 : 1) - (b.matchedKey ? 0 : 1)
  const matchQuery = (s: MediuxUserSet) => !q || s.title.toLowerCase().includes(q) || s.setName.toLowerCase().includes(q)

  // Merge deep-search results (creator's sets for matching library titles) with
  // the browsed sets, deduped, so search finds art beyond MediUX's browse cap
  const allSets = useMemo(() => {
    if (!searchResults.length) return sets
    const seen = new Set(sets.map(s => s.id))
    return [...searchResults.filter(s => !seen.has(s.id)), ...sets]
  }, [sets, searchResults])

  // Tab data, filtered by the title search. While the crawl is streaming we keep
  // MediUX arrival order (newest-first) so the list never visibly reshuffles as
  // batches land; the matches-first sort is applied once, on settle. A creator's
  // uploads on MediUX are always single-title sets; multi-title boxsets live on
  // a separate URL space (/boxsets/N) and are handled by manual import, not here
  const setsFiltered = useMemo(() => {
    const list = allSets.filter(s => matchQuery(s))
    return crawling ? list : list.sort(matchFirst)
  }, [allSets, q, crawling])
  const flatFiles = useMemo(() => allSets.flatMap(s => s.posters.map(poster => ({ set: s, poster }))), [allSets])
  const sortFiles = (list: { set: MediuxUserSet; poster: PosterInfo }[]) =>
    crawling ? list : list.sort((a, b) => matchFirst(a.set, b.set))
  const posterItems = useMemo(
    () => sortFiles(flatFiles.filter(f => posterFileType(f.poster) === 'poster' && matchQuery(f.set))),
    [flatFiles, q, crawling],
  )
  const backdropItems = useMemo(
    () => sortFiles(flatFiles.filter(f => posterFileType(f.poster) === 'backdrop' && matchQuery(f.set))),
    [flatFiles, q, crawling],
  )
  const titleCardItems = useMemo(
    () => sortFiles(flatFiles.filter(f => posterFileType(f.poster) === 'title_card' && matchQuery(f.set))),
    [flatFiles, q, crawling],
  )

  // Unfiltered counts for the tab labels
  const counts = useMemo(() => {
    let p = 0, b = 0, tc = 0
    for (const s of sets) {
      for (const f of s.posters) { const t = posterFileType(f); if (t === 'poster') p++; else if (t === 'backdrop') b++; else if (t === 'title_card') tc++ }
    }
    return { sets: sets.length, posters: p, backdrops: b, titlecards: tc }
  }, [sets])

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  // Selection acts on the currently-shown (search-filtered) sets, so "Select all" /
  // "In library" reflect what the user is actually looking at, not the whole catalog
  const selectAll       = () => setSelected(new Set(setsFiltered.map(s => s.id)))
  const selectInLibrary = () => setSelected(new Set(setsFiltered.filter(s => s.matchedKey).map(s => s.id)))
  const clearSelection  = () => setSelected(new Set())

  async function applySet(s: MediuxUserSet) {
    if (!s.matchedKey && !s.posters.some(p => p.isCollection)) return
    // One poster per Plex slot, as in the Library view (see resolveVariants).
    const collectionArt = resolveVariants(s.posters.filter(p => p.isCollection), 'title')
    const mainPosters   = resolveVariants(s.posters.filter(p => !p.isCollectionMember && !p.isCollection), 'title')
    const memberPosters = resolveVariants(s.posters.filter(p => p.isCollectionMember), 'title')
    const enabledTotal  = [...collectionArt, ...mainPosters, ...memberPosters].filter(p => allTypes.has(posterFileType(p))).length
    setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: 0, total: enabledTotal } }))

    let totalDone = 0, totalFailed = 0
    const allAppliedUrls: string[] = []
    const allAppliedSlots: string[] = []

    if (s.matchedKey) {
      const mainRes = await applyPosters(s.matchedKey, mainPosters, allTypes,
        (d, _t) => setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: totalDone + d, total: enabledTotal } })))
      totalDone   += mainRes.done
      totalFailed += mainRes.failed
      allAppliedUrls.push(...mainRes.appliedUrls)
      allAppliedSlots.push(...mainRes.appliedSlots)
    } else if (mainPosters.length > 0) {
      totalFailed += mainPosters.filter(p => allTypes.has(posterFileType(p))).length
    }

    // Each collection the set names gets its own art.
    const byCollection = new Map<string, PosterInfo[]>()
    for (const p of collectionArt) {
      const name = collectionName(p.title)
      const list = byCollection.get(name)
      if (list) list.push(p)
      else byCollection.set(name, [p])
    }
    for (const posters of byCollection.values()) {
      const coll = await window.api.plex.findCollection(posters[0].title) as { key: string; title: string; thumb?: string } | null
      if (!coll) {
        totalFailed += posters.filter(p => allTypes.has(posterFileType(p))).length
        continue
      }
      const collRes = await applyPosters(coll.key, posters, allTypes,
        (d, _t) => setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: totalDone + d, total: enabledTotal } })))
      totalDone   += collRes.done
      totalFailed += collRes.failed
      allAppliedUrls.push(...collRes.appliedUrls)
      allAppliedSlots.push(...collRes.appliedSlots)
      if (collRes.done > 0) {
        void recordAppliedQuietly({
          itemKey: coll.key, title: coll.title, type: 'collection',
          source: 'mediux', thumb: posters[0].thumbUrl ?? posters[0].url,
          setId: s.id, uploader: s.uploader,
          posterUrls: collRes.appliedUrls, slots: collRes.appliedSlots, appliedAt: new Date().toISOString(),
        })
      }
    }

    if (memberPosters.length > 0) {
      const movieMap = new Map<string, { title: string; year?: number; posters: PosterInfo[] }>()
      for (const p of memberPosters) {
        const key = `${p.title.toLowerCase()}|${p.year ?? ''}`
        const existing = movieMap.get(key)
        if (existing) existing.posters.push(p)
        else movieMap.set(key, { title: p.title, year: p.year, posters: [p] })
      }
      for (const m of movieMap.values()) {
        const found = await window.api.plex.findItem(m.title, m.year) as { key: string; title: string; year?: number; type: string; thumb?: string } | null
        if (!found) {
          totalFailed += m.posters.filter(p => allTypes.has(posterFileType(p))).length
          continue
        }
        const memberRes = await applyPosters(found.key, m.posters, allTypes,
          (d, _t) => setApplyMap(mm => ({ ...mm, [s.id]: { status: 'applying', done: totalDone + d, total: enabledTotal } })))
        totalDone   += memberRes.done
        totalFailed += memberRes.failed
        allAppliedUrls.push(...memberRes.appliedUrls)
        allAppliedSlots.push(...memberRes.appliedSlots)
        if (memberRes.done > 0) {
          void recordAppliedQuietly({
            itemKey: found.key, title: found.title, year: found.year,
            type: (found.type === 'movie' ? 'movie' : 'show'),
            source: 'mediux', thumb: found.thumb,
            setId: s.id, uploader: s.uploader,
            posterUrls: memberRes.appliedUrls, slots: memberRes.appliedSlots, appliedAt: new Date().toISOString(),
          })
        }
      }
    }

    let historyError: string | undefined
    if (totalDone > 0 && s.matchedKey) {
      historyError = await recordApplied({
        itemKey: s.matchedKey, title: s.title, year: s.year, type: s.matchedType ?? 'movie',
        source: 'mediux', thumb: s.previewUrl, setId: s.id, uploader: s.uploader,
        posterUrls: allAppliedUrls, slots: allAppliedSlots, appliedAt: new Date().toISOString(),
      }).then(() => undefined, (err: unknown) => errorMessage(err))
      onApplied(setKey(s), s.matchedKey, s.title, s.year, allAppliedUrls)
    }
    setApplyMap(m => ({
      ...m,
      [s.id]: { status: totalFailed && !totalDone ? 'error' : 'done', done: totalDone, total: enabledTotal, error: applyError(totalFailed, historyError) },
    }))
  }

  /** Applies a single poster/backdrop file (from the Posters/Backdrops tabs). */
  async function applySingle(s: MediuxUserSet, file: PosterInfo) {
    const key = `${s.id}:${file.url}`
    setApplyMap(m => ({ ...m, [key]: { status: 'applying', done: 0, total: 1 } }))

    if (file.isCollection) {
      const coll = await window.api.plex.findCollection(file.title) as { key: string; title: string } | null
      if (!coll) {
        setApplyMap(m => ({ ...m, [key]: { status: 'error', done: 0, total: 1, error: 'No matching Plex Collection' } }))
        return
      }
      const { done, appliedUrls, appliedSlots, lastError } = await applyPosters(coll.key, [file], allTypes, () => {})
      if (done) {
        void recordAppliedQuietly({
          itemKey: coll.key, title: coll.title, type: 'collection',
          source: 'mediux', thumb: file.thumbUrl ?? file.url, setId: s.id, uploader: s.uploader,
          posterUrls: appliedUrls, slots: appliedSlots, appliedAt: new Date().toISOString(),
        })
      }
      setApplyMap(m => ({ ...m, [key]: { status: done ? 'done' : 'error', done, total: 1, error: lastError } }))
      return
    }

    if (!s.matchedKey) return
    const { done, appliedUrls, appliedSlots, lastError } = await applyPosters(s.matchedKey, [file], allTypes, () => {})
    if (done) {
      void recordAppliedQuietly({
        itemKey: s.matchedKey, title: s.title, year: s.year, type: s.matchedType ?? 'movie',
        source: 'mediux', thumb: file.thumbUrl ?? file.url, setId: s.id, uploader: s.uploader,
        posterUrls: appliedUrls, slots: appliedSlots, appliedAt: new Date().toISOString(),
      })
      onApplied(setKey(s), s.matchedKey, s.title, s.year, appliedUrls)
    }
    setApplyMap(m => ({ ...m, [key]: { status: done ? 'done' : 'error', done, total: 1, error: lastError } }))
  }

  /**
   * Syncs the selected sets, or the whole creator when none are selected,
   * merging into this creator's existing job instead of stacking new ones.
   */
  async function scheduleSync() {
    const chosen = setsFiltered.filter(s => selected.has(s.id))
    const urls = chosen.length
      ? chosen.map(s => `https://mediux.pro/sets/${s.id}`)
      : [creatorSyncUrl(username)]
    setScheduling(true)
    setScheduleError(null)
    setScheduledMsg(null)
    try {
      const plan = planQuickSync(await window.api.scheduler.list(), {
        urls,
        name: chosen.length ? `Sync @${username} (${urls.length} ${urls.length === 1 ? 'set' : 'sets'})` : `Sync @${username}`,
        cronExpr: quickCron,
        creator: username,
        groupByCreator: true,
      }, uuid)
      const saved = plan.kind === 'exists' ? plan.job : await window.api.scheduler.save(plan.job)
      setSchedJobs(await window.api.scheduler.list())
      setScheduledJobId(saved.id)
      setScheduledMsg(describeQuickSync({ ...plan, job: saved }, chosen.length, username))
    } catch (err) {
      setScheduleError(errorMessage(err))
    } finally {
      setScheduling(false)
    }
  }

  function openScheduledJob() {
    if (scheduledJobId) goScheduler(scheduledJobId)
    navigate('scheduler')
  }

  // Scoped to the visible (search-filtered) sets so the toolbar counts track the view
  const matchCount      = setsFiltered.filter(s => s.matchedKey).length
  const selectedVisible = setsFiltered.filter(s => selected.has(s.id)).length

  const renderSetCard = (s: MediuxUserSet) => {
    const isCurrent    = !!s.matchedKey && appliedIdx.currentByItem.get(s.matchedKey) === setKey(s)
    const wasApplied   = appliedIdx.setKeys.has(setKey(s))
    const titleApplied = appliedIdx.titles.has(appliedKey(s.title, s.year))
    const isScheduled  = !!coveringJob(coverage, s.id, username)
    const matchBadge = s.matchedKey
      ? isCurrent
        ? <span className={styles.matchBadge}><CheckCircle2 size={11} /> Applied</span>
        : wasApplied
          ? <span className={styles.downloadedBadge}><Download size={11} /> Downloaded</span>
          : titleApplied
            ? <span className={styles.scheduledBadge}><Library size={11} /> Has art</span>
            : <span className={styles.matchBadge}><Check size={11} /> In library</span>
      : <span className={styles.noMatchBadge}>Not in library</span>
    return (
      <SetCard
        key={s.id}
        set={s}
        apply={applyMap[s.id]}
        onApply={() => applySet(s)}
        enabledTypes={allTypes}
        title={s.year ? `${s.title} (${s.year})` : s.title}
        badge={<span className={styles.badgeRow}>{matchBadge}{isScheduled && <span className={styles.scheduledBadge}><CalendarClock size={11} /> Scheduled</span>}</span>}
        disabled={!s.matchedKey}
        selectable={following}
        checked={selected.has(s.id)}
        onToggleSelect={() => toggleSelect(s.id)}
      />
    )
  }

  const fileItems = tab === 'posters' ? posterItems : tab === 'backdrops' ? backdropItems : tab === 'titlecards' ? titleCardItems : []
  const fileLightboxImages = useMemo<LightboxImage[]>(
    () => fileItems.map(({ set, poster }) => ({ url: poster.url, label: set.year ? `${set.title} (${set.year})` : set.title, caption: poster.episode != null ? `Episode ${poster.episode}` : undefined })),
    [fileItems],
  )

  // Only the current page renders, so the DOM stays tiny regardless of catalog
  // size. As the crawl streams more sets in, the page count grows but the page
  // the user is on stays put.
  const perPage = tab === 'sets' ? CREATOR_SETS_PER_PAGE : CREATOR_FILES_PER_PAGE
  const activeLen = tab === 'sets' ? setsFiltered.length : fileItems.length
  const pageCount = Math.max(1, Math.ceil(activeLen / perPage))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * perPage
  const pageSets = setsFiltered.slice(pageStart, pageStart + perPage)
  const pageFiles = fileItems.slice(pageStart, pageStart + perPage)
  const goPage = (p: number) => { setPage(p); listRef.current?.scrollTo({ top: 0 }) }

  return (
    <div className={styles.creatorSets}>
      <div className={styles.creatorBar}>
        <div className={styles.creatorBarInfo}>
          <span className={styles.creatorBarName}>{username}</span>
          <span className={styles.creatorBarMeta}>
            {error && sets.length === 0 ? (
              'Could not load sets'
            ) : loading ? (
              'Loading…'
            ) : crawling ? (
              <>
                {sets.length} sets{matchCount > 0 ? ` · ${matchCount} in your library` : ''}
                <span className={styles.lastChecked}>· loading more…</span>
              </>
            ) : (
              <>
                {sets.length} sets · {matchCount} in your library
                {refreshing
                  ? <span className={styles.lastChecked}>· refreshing…</span>
                  : lastChecked && <span className={styles.lastChecked}>· checked {timeAgo(lastChecked)}</span>}
              </>
            )}
          </span>
        </div>
        <div className={styles.creatorBarActions}>
          {following ? (
            <Button variant="secondary" size="sm" icon={<Star size={12} />} onClick={() => onCreatorChange('none')}>Following</Button>
          ) : (
            <Button variant="primary" size="sm" icon={<UserPlus size={12} />} onClick={() => onCreatorChange('followed')}>Follow</Button>
          )}
          {creator === 'hidden' ? (
            <Button variant="secondary" size="sm" icon={<Eye size={12} />} onClick={() => onCreatorChange('none')}>Unhide</Button>
          ) : (
            <Button variant="ghost" size="sm" icon={<EyeOff size={12} />} onClick={() => onCreatorChange('hidden')}>Hide</Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={12} className={refreshing ? styles.spin : ''} />}
            onClick={refresh}
            disabled={loading || refreshing}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Tabs + title filter: skeleton on first load, real once sets exist */}
      {!error && loading && sets.length === 0 && <SkeletonTabs />}
      {!error && sets.length > 0 && (
        <div className={styles.creatorTabsRow}>
          <div className={styles.creatorTabs}>
            {([['sets', 'Sets', counts.sets], ['posters', 'Posters', counts.posters], ['backdrops', 'Backdrops', counts.backdrops], ['titlecards', 'Title Cards', counts.titlecards]] as const).map(([k, label, n]) => (
              <button
                key={k}
                className={`${styles.creatorTab} ${tab === k ? styles.creatorTabActive : ''}`}
                onClick={() => setTab(k)}
                disabled={n === 0}
              >
                {label}<span className={styles.creatorTabCount}>{n}</span>
              </button>
            ))}
          </div>
          <div className={styles.creatorSearch}>
            {searching ? <Loader2 size={13} className={`${styles.creatorSearchIcon} ${styles.spin}`} /> : <Search size={13} className={styles.creatorSearchIcon} />}
            <input
              ref={searchRef}
              className={styles.creatorSearchInput}
              placeholder="Search all their art by title…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              spellCheck={false}
            />
            {query && <button className={styles.creatorSearchClear} onClick={() => setQuery('')}><X size={12} /></button>}
          </div>
        </div>
      )}

      {/* Selection toolbar (Sets tab only) */}
      {following && !loading && !error && sets.length > 0 && tab === 'sets' && (
        <div className={styles.selectBar}>
          <span className={styles.selectCount}>
            {selectedVisible > 0 ? `${selectedVisible} of ${setsFiltered.length} selected` : 'Pick sets to sync, or sync all'}
          </span>
          <div className={styles.selectActions}>
            <button className={styles.selectBtn} onClick={selectAll}>Select all</button>
            <button className={styles.selectBtn} onClick={selectInLibrary} disabled={!matchCount}>In library ({matchCount})</button>
            <button className={styles.selectBtn} onClick={clearSelection} disabled={!selected.size}>Clear</button>
            <Button
              variant={creatorJob && selectedVisible === 0 ? 'secondary' : 'primary'}
              size="sm"
              icon={creatorJob && selectedVisible === 0 ? <CheckCircle2 size={12} /> : <CalendarClock size={12} />}
              onClick={scheduleSync}
              loading={scheduling}
              className={styles.syncWeeklyBtn}
              title={creatorJob
                ? `Every set from @${username} is synced by "${creatorJob.name}" (${describeCron(creatorJob.cronExpr)})`
                : `Apply new uploads automatically (${describeCron(quickCron)}). Change the default in the Scheduler.`}
            >
              {selectedVisible > 0 ? `Sync ${selectedVisible} selected` : creatorJob ? 'Syncing all' : 'Sync all'}
            </Button>
          </div>
        </div>
      )}

      {/* Post-schedule tip */}
      <AnimatePresence>
        {(scheduledMsg || scheduleError) && (
          <motion.div
            className={`${styles.scheduleTip} ${scheduleError ? styles.scheduleTipError : ''}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            role={scheduleError ? 'alert' : 'status'}
          >
            {scheduleError ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
            {scheduleError
              ? <span>Couldn&apos;t save the sync: {scheduleError}</span>
              : <span>{scheduledMsg} <button className={styles.tipLink} onClick={openScheduledJob}>Open in Scheduler</button></span>}
            <button className={styles.tipClose} onClick={() => { setScheduledMsg(null); setScheduleError(null) }}><X size={13} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={styles.creatorSetsList} ref={listRef}>
        {/* First paint only: skeletons until the buffer has anything to show.
            After that only the current page renders, so the DOM stays small. */}
        {loading && !error &&
          Array.from({ length: 6 }).map((_, i) => <SetCardSkeleton key={`skel-${i}`} />)}
        {error && sets.length === 0 && <div className={styles.panelNotice}><AlertCircle size={20} /><p>{error}</p></div>}

        {/* Sets tab */}
        {!loading && !error && tab === 'sets' && (
          pageSets.length
            ? pageSets.map(renderSetCard)
            : !crawling && (
                <div className={styles.panelNotice}><ImageIcon size={20} /><p>{query ? (searching ? 'Searching their full catalog…' : 'No matches found, try a different title.') : 'No sets found for this creator.'}</p></div>
              )
        )}

        {/* Posters / Backdrops / Title Cards tabs: individual files */}
        {!loading && !error && (tab === 'posters' || tab === 'backdrops' || tab === 'titlecards') && (
          pageFiles.length ? (
            <div className={`${styles.fileGrid} ${tab === 'backdrops' || tab === 'titlecards' ? styles.fileGridWide : ''}`}>
              {pageFiles.map(({ set, poster }, i) => {
                const key = `${set.id}:${poster.url}`
                const st = applyMap[key]?.status
                const done = st === 'done' || appliedIdx.posterUrls.has(poster.url)
                return (
                  <FileTile
                    key={key}
                    poster={poster}
                    set={set}
                    st={st}
                    done={done}
                    error={applyMap[key]?.error}
                    onLightbox={() => setFileLightbox(pageStart + i)}
                    onApply={() => applySingle(set, poster)}
                  />
                )
              })}
            </div>
          ) : !crawling && <div className={styles.panelNotice}><ImageIcon size={20} /><p>{query ? (searching ? 'Searching their full catalog…' : 'No matches found, try a different title.') : tab === 'titlecards' ? 'No title cards found.' : `No ${tab} found.`}</p></div>
        )}

        {/* Cap note (shown once the catalog has settled) */}
        {!crawling && !error && capped && sets.length > 0 && safePage >= pageCount - 1 && (
          <div className={styles.loadMoreNote}>
            Showing this creator's newest {sets.length} sets (MediUX's browse limit), with your library matches first.
            Don't see one of your titles? <button className={styles.noteSearchLink} onClick={() => searchRef.current?.focus()}>Search</button> their full catalog by title above.
          </div>
        )}
      </div>

      {/* Pager + status: always visible below the (short) current page. */}
      {!loading && !error && activeLen > 0 && (
        <div className={styles.pagerBar}>
          <span className={styles.pagerStatus}>
            Page {safePage + 1} of {pageCount}
            {crawling && <span className={styles.lastChecked}> · loading more…</span>}
          </span>
          <Pager page={safePage} pageCount={pageCount} onPage={goPage} />
        </div>
      )}

      <AnimatePresence>
        {fileLightbox !== null && (
          <Lightbox images={fileLightboxImages} index={fileLightbox} onClose={() => setFileLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
