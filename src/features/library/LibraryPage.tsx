import { useEffect, useRef, useState, useCallback, useMemo, createContext, useContext } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X, Upload, Check, AlertCircle, Loader2, User, Image as ImageIcon, ChevronDown, ChevronUp, Plus, UserPlus, Trash2, CalendarClock, CheckCircle2, RefreshCw, Star, Library, Download, LayoutGrid, Users, Film, Tv, Layers } from 'lucide-react'
import type { ScheduledJob } from '../../../electron/ipc/types'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import Checkbox from '../../components/ui/Checkbox'
import Spinner from '../../components/ui/Spinner'
import Lightbox, { type LightboxImage } from '../../components/ui/Lightbox'
import PlexConnectBanner from '../../components/ui/PlexConnectBanner'
import { groupPosters, posterFileType, ALL_TYPES, defaultSetApplyScope, type FileType, type SetApplyScope } from '../../utils/posterGroups'
import { recordApplied, recordAppliedBatch, appliedKey, loadAppliedIndex, type AppliedIndex } from '../../utils/appliedTracker'
import { useAppContext } from '../../app/AppContext'
import { useNavStore } from '../../app/navStore'
import type {
  LibrarySection, LibraryItem, MediuxSetSummary, BrowseSetsRes, PosterInfo, MediuxUserSet, UserSetsRes, AppliedRecord,
  PlexArtSlot,
} from '../../../electron/ipc/types'
import styles from './LibraryPage.module.css'

const PAGE_SIZE = 60
/** Sentinel activeKey for the movie-collections browser tab. */
const COLLECTIONS_TAB_KEY = '__collections__'

/**
 * Session cache for a creator's fully-paginated sets, so flipping between
 * creators (or re-opening one) is instant instead of re-scraping every time.
 * Lives for the renderer process lifetime; a manual Refresh or a stale entry
 * (older than the TTL) triggers a re-fetch.
 */
interface CreatorCacheEntry { sets: MediuxUserSet[]; capped: boolean; fetchedAt: number }
const creatorSetsCache = new Map<string, CreatorCacheEntry>()
const CREATOR_CACHE_TTL = 30 * 60 * 1000

interface BrowseCacheEntry {
  sets: MediuxSetSummary[]
  tmdbId?: string
  collectionMembers?: LibraryItem[]
  fetchedAt: number
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

/** Match a MediUX collection-member poster to a Plex collection child. */
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
 * Applies a set's posters to a Plex target, routing each by season/episode.
 *
 * @param targetKey - Plex ratingKey to apply onto.
 * @param posters - Candidate posters; filtered by the enabled types.
 * @param enabled - File types the user has switched on.
 * @param onProgress - Called after each poster with done/total counts.
 * @returns Done/failed counts, the URLs actually applied, and the last error.
 */
async function applyPosters(
  targetKey: string,
  posters: PosterInfo[],
  enabled: Set<FileType>,
  onProgress: (done: number, total: number) => void,
): Promise<{ done: number; failed: number; total: number; appliedUrls: string[]; lastError?: string }> {
  const list = posters.filter(p => enabled.has(posterFileType(p)))
  let done = 0, failed = 0
  const appliedUrls: string[] = []
  let lastError: string | undefined
  for (const p of list) {
    try {
      const res = await window.api.plex.uploadPoster(targetKey, p.url, p.source, p.season, p.episode, p.isCollection) as { success: boolean; error?: string }
      if (res.success) { done++; appliedUrls.push(p.url) } else { failed++; lastError = res.error }
    } catch (err) { failed++; lastError = err instanceof Error ? err.message : String(err) }
    onProgress(done, list.length)
  }
  return { done, failed, total: list.length, appliedUrls, lastError }
}

/** Lets any nested set card jump to a creator in the Creators tab. */
const CreatorNav = createContext<(username: string) => void>(() => {})

/**
 * Reads the followed-creator usernames from config.
 *
 * @returns Lowercased usernames, loaded once on mount.
 */
function useSubscriptions() {
  const [subs, setSubs] = useState<string[]>([])
  useEffect(() => {
    window.api.config.get().then(c => setSubs((c.mediuxSubscriptions ?? []).map(s => s.toLowerCase())))
  }, [])
  return subs
}

/** Plex library grid with per-section tabs, cross-library search, and the MediUX sets panel. */
function MyLibraryView({ subs, targetSection, targetItem }: { subs: string[]; targetSection: string | null; targetItem: LibraryItem | null }) {
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

  const offsetRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.config.get().then(c => setCollectionsEnabled(c.collectionsEnabled !== false))
  }, [reloadNonce])

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

  // Deep-link from the command palette: open a specific item's MediUX sets panel,
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
    // its MediUX panel, so a command-palette jump lands on just that item.
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

  const loadItems = useCallback(async (key: string, q: string, append: boolean) => {
    if (!key || key === COLLECTIONS_TAB_KEY) return
    setLoading(true)
    const offset = append ? offsetRef.current : 0
    try {
      const res = await window.api.library.items({ sectionKey: key, offset, limit: PAGE_SIZE, search: q })
      setTotal(res.total)
      offsetRef.current = offset + res.items.length
      setItems(prev => append ? [...prev, ...res.items] : res.items)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCollections = useCallback(async (q: string, append: boolean) => {
    setLoading(true)
    const offset = append ? offsetRef.current : 0
    try {
      const res = await window.api.library.collections({ offset, limit: PAGE_SIZE, search: q || undefined })
      setTotal(res.total)
      offsetRef.current = offset + res.items.length
      setItems(prev => append ? [...prev, ...res.items] : res.items)
    } finally {
      setLoading(false)
    }
  }, [])

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
            window.api.library.items({ sectionKey: s.key, offset: 0, limit: 24, search: q })
              .then(res => ({ section: s, items: res.items }))
              .catch(() => ({ section: s, items: [] as LibraryItem[] }))
          ),
        ),
        showCollections
          ? window.api.library.collections({ offset: 0, limit: 48, search: q })
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
  }, [search, isGlobalSearch, sections, showCollections, reloadNonce])

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
        await loadItems(activeKey, '', false)
      } else {
        setReloadNonce(n => n + 1)
      }
    } finally {
      const elapsed = Date.now() - started
      if (elapsed < 500) await new Promise(r => setTimeout(r, 500 - elapsed))
      setManualRefreshing(false)
    }
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
                <p>{isCollectionsView ? 'No movie collections found.' : 'This library is empty.'}</p>
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

      {/* Sets panel */}
      <AnimatePresence>
        {selected && (
          <SetsPanel
            key={selected.key}
            item={selected}
            subs={subs}
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
  const subs = useSubscriptions()
  const libraryIntent = useNavStore(s => s.libraryIntent)
  const clearLibrary  = useNavStore(s => s.clearLibrary)

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
            <h1 className="page-title">{mode === 'library' ? 'Library Browser' : 'MediUX Creators'}</h1>
            <p className="page-subtitle">
              {mode === 'library'
                ? 'Browse your Plex library and apply MediUX poster sets.'
                : 'Follow MediUX creators and apply their newest art to your library.'}
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
              {subs.length > 0 && (
                <span className={styles.tabBadge}>{subs.length}</span>
              )}
            </button>
          </div>
        </div>

        {!plexConnected ? (
          <PlexConnectBanner />
        ) : mode === 'library' ? (
          <MyLibraryView subs={subs} targetSection={sectionTarget} targetItem={itemTarget} />
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

function SetsPanel({ item, subs, onClose, onItemPoster }: {
  item: LibraryItem
  subs: string[]
  onClose: () => void
  onItemPoster: (key: string, thumb: string) => void
}) {
  const [sets, setSets]       = useState<MediuxSetSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const [hasTmdbKey, setHasTmdbKey] = useState(false)
  const [uploader, setUploader] = useState<string>('all')
  const [types, setTypes]       = useState<Set<FileType>>(new Set(ALL_TYPES))
  const [applyMap, setApplyMap] = useState<Record<string, ApplyState>>({})
  // Per-set apply scope: movies and collection poster are chosen independently.
  const [collectionScope, setCollectionScope] = useState<Record<string, SetApplyScope>>({})
  // TMDB id MediUX resolved for this item (set even when the Plex item uses a
  // tvdb/imdb agent), used to match the viewed item's collection-member poster.
  const [resolvedTmdbId, setResolvedTmdbId] = useState<string | undefined>(undefined)
  // Which collection-member movies actually exist in the Plex library, keyed by
  // tmdbId (or title|year). Resolved with the same findItem the apply uses, so
  // the "N movies" count matches exactly what "apply all" will touch.
  const [memberInLib, setMemberInLib] = useState<Map<string, boolean>>(new Map())
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>({ setIds: new Set(), titles: new Set(), posterUrls: new Set(), currentByItem: new Map(), currentPosterUrls: new Set() })
  const [scheduledSetIds, setScheduledSetIds] = useState<Set<string>>(new Set())
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [setsReloadKey, setSetsReloadKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [artSlots, setArtSlots] = useState<PlexArtSlot[]>([])
  const [artLoading, setArtLoading] = useState(true)
  const [artReloadKey, setArtReloadKey] = useState(0)
  const [collectionMembers, setCollectionMembers] = useState<LibraryItem[]>([])
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH_DEFAULT)
  const panelWidthRef = useRef(PANEL_WIDTH_DEFAULT)
  const [resizing, setResizing] = useState(false)

  const subSet = useMemo(() => new Set(subs), [subs])
  const isCollectionItem = item.type === 'collection'
  const itemApplied = isCollectionItem
    ? appliedIdx.currentByItem.has(item.key)
    : appliedIdx.titles.has(appliedKey(item.title, item.year))

  useEffect(() => { loadAppliedIndex().then(setAppliedIdx) }, [])

  // Which of this title's sets already have a scheduled sync job.
  useEffect(() => {
    window.api.scheduler.list().then((jobs: ScheduledJob[]) => {
      const ids = new Set<string>()
      for (const j of jobs) for (const u of j.urls) { const m = u.match(/\/sets\/(\d+)/); if (m) ids.add(m[1]) }
      setScheduledSetIds(ids)
    }).catch(() => { /* scheduler unavailable */ })
  }, [])

  // Create a weekly sync job for a single set, straight from the library.
  async function scheduleSet(s: MediuxSetSummary) {
    if (scheduledSetIds.has(s.id) || schedulingId) return
    setSchedulingId(s.id)
    try {
      await window.api.scheduler.save({
        id: crypto.randomUUID(),
        name: `${item.title}${item.year ? ` (${item.year})` : ''} - ${s.setName}`,
        urls: [`https://mediux.pro/sets/${s.id}`],
        cronExpr: '0 3 * * 0',
        enabled: true,
      })
      setScheduledSetIds(prev => new Set(prev).add(s.id))
    } finally {
      setSchedulingId(null)
    }
  }

  useEffect(() => {
    window.api.config.get().then(c => {
      if (c.mediuxFilters?.length) setTypes(new Set(c.mediuxFilters as FileType[]))
      setHasTmdbKey(Boolean(c.tmdbApiKey?.trim()))
      const w = clampPanelWidth(c.libraryPanelWidth ?? PANEL_WIDTH_DEFAULT)
      panelWidthRef.current = w
      setPanelWidth(w)
    })
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--library-panel-width', `${panelWidth}px`)
    return () => { document.documentElement.style.removeProperty('--library-panel-width') }
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

    if (cached) {
      setSets(cached.sets)
      setResolvedTmdbId(cached.tmdbId)
      setCollectionMembers(cached.collectionMembers ?? [])
      setLoading(false)
    } else {
      setSets([])
      setCollectionMembers([])
      setLoading(true)
    }

    if (fresh && !forced) return

    const hasCache = !!cached
    if (hasCache) setRefreshing(true)

    const load = isCollectionItem
      ? window.api.library.collectionSets({ collectionKey: item.key, title: item.title })
      : window.api.library.sets({
          type: item.type === 'show' ? 'show' : 'movie',
          tmdbId: item.tmdbId, tvdbId: item.tvdbId, imdbId: item.imdbId, anidbId: item.anidbId,
        })

    load.then((res: BrowseSetsRes) => {
      if (cancelled) return
      if (res.error === 'no_tmdb') setError('no_tmdb')
      else if (res.error === 'no_movies') setError('no_movies')
      else if (res.error) setError(res.error)
      setResolvedTmdbId(res.tmdbId)
      const sorted = [...res.sets].sort((a, b) => {
        const fa = subSet.has(a.uploader.toLowerCase()) ? 0 : 1
        const fb = subSet.has(b.uploader.toLowerCase()) ? 0 : 1
        return fa - fb || a.uploader.localeCompare(b.uploader)
      })
      browseSetsCache.set(key, {
        sets: sorted,
        tmdbId: res.tmdbId,
        collectionMembers: res.collectionMembers,
        fetchedAt: Date.now(),
      })
      setSets(sorted)
      setCollectionMembers(res.collectionMembers ?? [])
    }).catch((e: unknown) => {
      if (!cancelled && !hasCache) setError(e instanceof Error ? e.message : String(e))
    }).finally(() => {
      if (!cancelled) {
        setLoading(false)
        setRefreshing(false)
      }
    })
    return () => { cancelled = true }
  }, [item.key, item.type, item.title, item.tmdbId, item.tvdbId, item.imdbId, item.anidbId, isCollectionItem, subSet, setsReloadKey])

  function refreshSets() {
    browseSetsCache.delete(browseCacheKey(item))
    setSetsReloadKey(k => k + 1)
  }

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
      setPanelWidth(next)
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
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
    for (const s of sets) for (const p of s.posters) {
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
  }, [sets, item.tmdbId, resolvedTmdbId, isCollectionItem, collectionMembers])

  const uploaders = useMemo(() => {
    // Followed uploaders first, then the rest alphabetically
    const all = Array.from(new Set(sets.map(s => s.uploader)))
    all.sort((a, b) => {
      const fa = subSet.has(a.toLowerCase()) ? 0 : 1
      const fb = subSet.has(b.toLowerCase()) ? 0 : 1
      return fa - fb || a.localeCompare(b)
    })
    return ['all', ...all]
  }, [sets, subSet])

  const visibleSets = useMemo(
    () => {
      const byUploader = uploader === 'all' ? sets : sets.filter(s => s.uploader === uploader)
      // Hide sets that have nothing to apply under the current type filter, so
      // the chips actually narrow the result list instead of only dimming art.
      return byUploader.filter(s => s.posters.some(p => types.has(posterFileType(p))))
    },
    [sets, uploader, types],
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

  async function applySet(s: MediuxSetSummary) {
    const memberIds = [...new Set(s.posters.filter(p => p.isCollectionMember).map(p => p.tmdbId ?? `${p.title.toLowerCase()}|${p.year ?? ''}`))]
    const collectionInLib = memberIds.filter(k => memberInLib.get(k)).length
    const hasCollectionArt = s.posters.some(p => p.isCollection)
    const scope = collectionScope[s.id] ?? defaultSetApplyScope(hasCollectionArt, collectionInLib)

    const collectionArt = s.posters.filter(p => p.isCollection)
    const members       = s.posters.filter(p => p.isCollectionMember)
    const plain         = s.posters.filter(p => !p.isCollection && !p.isCollectionMember)

    if (isCollectionItem) {
      const memberPosters = scope.movies === 'none'
        ? []
        : scope.movies === 'all'
          ? members.filter(p => memberInLib.get(memberKey(p)))
          : members.filter(p => memberInLib.get(memberKey(p)))
      const applyCollArt = scope.collectionPoster && collectionArt.length > 0

      const willApply = [...memberPosters, ...(applyCollArt ? collectionArt : [])]
      const enabledTotal = willApply.filter(p => types.has(posterFileType(p))).length
      if (enabledTotal === 0) return
      setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: 0, total: enabledTotal } }))

      let totalDone = 0, totalFailed = 0
      const records: AppliedRecord[] = []
      const bump = (d: number) =>
        setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: totalDone + d, total: enabledTotal } }))

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
              source: 'mediux', thumb: thumb ?? child.thumb, setId: s.id, uploader: s.uploader,
              posterUrls: memberRes.appliedUrls, appliedAt: new Date().toISOString(),
            })
            if (thumb) onItemPoster(child.key, thumb)
          }
        }
      }

      if (applyCollArt) {
        const collRes = await applyPosters(item.key, collectionArt, types, bump)
        totalDone += collRes.done; totalFailed += collRes.failed
        if (collRes.done > 0) {
          const thumb = mainThumb(collectionArt) ?? item.thumb
          records.push({
            itemKey: item.key, title: item.title, type: 'collection',
            source: 'mediux', thumb, setId: s.id, uploader: s.uploader,
            posterUrls: collRes.appliedUrls, appliedAt: new Date().toISOString(),
          })
          if (thumb) onItemPoster(item.key, thumb)
        }
      }

      if (records.length > 0) {
        void recordAppliedBatch(records)
        const appliedUrls = records.flatMap(r => r.posterUrls ?? [])
        setAppliedIdx(prev => ({
          setIds: new Set(prev.setIds).add(s.id),
          titles: prev.titles,
          posterUrls: new Set([...prev.posterUrls, ...appliedUrls]),
          currentByItem: records.reduce((map, r) => map.set(r.itemKey, s.id), new Map(prev.currentByItem)),
          currentPosterUrls: new Set([...prev.currentPosterUrls, ...appliedUrls]),
        }))
        bumpArtReload()
      }
      setApplyMap(m => ({
        ...m,
        [s.id]: { status: totalFailed && !totalDone ? 'error' : 'done', done: totalDone, total: enabledTotal, error: totalFailed ? `${totalFailed} failed` : undefined },
      }))
      return
    }

    // A plain movie/show set has no collection dimension, so the scope toggle is
    // never shown for it (see `showScope`); its posters must always apply. Only
    // suppress the viewed item's own art when the scope control is actually
    // present and the user set it to "none".
    const scopeControllable = hasCollectionArt || collectionInLib > 1
    const viewedPosters = scopeControllable && scope.movies === 'none'
      ? []
      : [...plain, ...members.filter(isThisItem)]
    const siblingMembers = scope.movies === 'all'
      ? members.filter(p => !isThisItem(p) && memberInLib.get(memberKey(p)))
      : []
    const applyCollArt = scope.collectionPoster && collectionArt.length > 0

    const willApply = [
      ...viewedPosters,
      ...siblingMembers,
      ...(applyCollArt ? collectionArt : []),
    ]
    const enabledTotal = willApply.filter(p => types.has(posterFileType(p))).length
    if (enabledTotal === 0) return
    setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: 0, total: enabledTotal } }))

    let totalDone = 0, totalFailed = 0
    const records: AppliedRecord[] = []
    const bump = (d: number) =>
      setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: totalDone + d, total: enabledTotal } }))

    // 1. The viewed item's own art.
    const mainRes = await applyPosters(item.key, viewedPosters, types, bump)
    totalDone += mainRes.done; totalFailed += mainRes.failed
    if (mainRes.done > 0) {
      const thumb = mainThumb(viewedPosters)
      records.push({
        itemKey: item.key, title: item.title, year: item.year, type: item.type,
        source: 'mediux', thumb: thumb ?? item.thumb, setId: s.id, uploader: s.uploader,
        posterUrls: mainRes.appliedUrls, appliedAt: new Date().toISOString(),
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
            source: 'mediux', thumb: thumb ?? found.thumb, setId: s.id, uploader: s.uploader,
            posterUrls: memberRes.appliedUrls, appliedAt: new Date().toISOString(),
          })
          if (thumb) onItemPoster(found.key, thumb)
        }
      }
    }

    // 3. Collection-level art onto the matching Plex Collection object.
    if (applyCollArt) {
      const coll = await window.api.plex.findCollection(collectionArt[0].title) as { key: string; title: string; thumb?: string; libraryTitle?: string } | null
      // No matching Plex Collection object - skip quietly (the movies still applied).
      if (coll) {
        const collRes = await applyPosters(coll.key, collectionArt, types, bump)
        totalDone += collRes.done; totalFailed += collRes.failed
        if (collRes.done > 0) {
          records.push({
            itemKey: coll.key, title: coll.title, type: 'collection',
            source: 'mediux', thumb: mainThumb(collectionArt) ?? coll.thumb, setId: s.id, uploader: s.uploader,
            posterUrls: collRes.appliedUrls, appliedAt: new Date().toISOString(),
          })
        }
      }
    }

    // One atomic write so every touched item keeps its Reset Posters row.
    if (records.length > 0) {
      void recordAppliedBatch(records)
      const appliedUrls = records.flatMap(r => r.posterUrls ?? [])
      setAppliedIdx(prev => ({
        setIds: new Set(prev.setIds).add(s.id),
        titles: new Set([...prev.titles, ...records.map(r => appliedKey(r.title, r.year))]),
        posterUrls: new Set([...prev.posterUrls, ...appliedUrls]),
        currentByItem: records.reduce((map, r) => map.set(r.itemKey, s.id), new Map(prev.currentByItem)),
        currentPosterUrls: new Set([...prev.currentPosterUrls, ...appliedUrls]),
      }))
      bumpArtReload()
    }
    setApplyMap(m => ({
      ...m,
      [s.id]: { status: totalFailed && !totalDone ? 'error' : 'done', done: totalDone, total: enabledTotal, error: totalFailed ? `${totalFailed} failed` : undefined },
    }))
  }

  return (
    <motion.div
      className={styles.panel}
      style={{ width: panelWidth }}
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
        <div className={styles.panelTitleWrap}>
          <h2 className={styles.panelTitle}>{item.title}</h2>
          {isCollectionItem && item.childCount != null && (
            <span className={styles.panelYear}>{item.childCount} movie{item.childCount !== 1 ? 's' : ''}</span>
          )}
          {!isCollectionItem && item.year && <span className={styles.panelYear}>{item.year}</span>}
        </div>
        <div className={styles.panelHeaderActions}>
          <button
            className={styles.panelRefresh}
            onClick={refreshSets}
            disabled={loading && !refreshing}
            title="Refresh MediUX sets"
          >
            <RefreshCw size={14} className={refreshing ? styles.spin : undefined} />
          </button>
          <button className={styles.panelClose} onClick={onClose}><X size={16} /></button>
        </div>
      </div>

      <CurrentArtStrip slots={artSlots} loading={artLoading} />

      {/* Filters */}
      {!loading && !error && sets.length > 0 && (
        <div className={styles.filters}>
          <Select
            value={uploader}
            onChange={setUploader}
            searchable={uploaders.length > 6}
            options={uploaders.map(u => ({
              value: u,
              label: u === 'all' ? `All uploaders (${sets.length})` : u,
              icon: u === 'all' ? <User size={13} /> : undefined,
            }))}
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

      {/* Body */}
      <div className={styles.panelBody}>
        {loading && <div className={styles.panelLoading}><Spinner size="sm" /> <span>{isCollectionItem ? 'Finding collection sets on MediUX…' : 'Finding sets on MediUX…'}</span></div>}

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
            </div>
          )
        })()}
        {error && error !== 'no_tmdb' && (
          <div className={styles.panelNotice}><AlertCircle size={20} /><p>{error}</p></div>
        )}

        {!loading && !error && sets.length === 0 && (
          <div className={styles.panelNotice}><ImageIcon size={20} /><p>No MediUX sets found for this title.</p></div>
        )}

        {!loading && !error && sets.length > 0 && visibleSets.length === 0 && (
          <div className={styles.panelNotice}><ImageIcon size={20} /><p>No sets match the current filters.</p></div>
        )}

        {visibleSets.map(s => {
          // "Applied" = the set currently live on this item; "Downloaded" = a set
          // applied before but since overwritten; "Has art" = title has art elsewhere.
          const isCurrent = appliedIdx.currentByItem.get(item.key) === s.id
          const badge = isCurrent
            ? <span className={styles.matchBadge}><CheckCircle2 size={11} /> Applied</span>
            : appliedIdx.setIds.has(s.id)
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
          const hasCollectionArt = s.posters.some(p => p.isCollection)
          const applyScope = collectionScope[s.id] ?? defaultSetApplyScope(hasCollectionArt, collectionInLib)
          const showScope = hasCollectionArt || collectionInLib > 1
            || (isCollectionItem && memberIds.some(k => memberInLib.get(k)))
          return (
            <SetCard
              key={s.id}
              set={s}
              apply={applyMap[s.id]}
              onApply={() => applySet(s)}
              enabledTypes={types}
              followed={subSet.has(s.uploader.toLowerCase())}
              badge={badge}
              onSchedule={() => scheduleSet(s)}
              scheduled={scheduledSetIds.has(s.id)}
              scheduling={schedulingId === s.id}
              collectionMovies={collectionInLib}
              collectionTotal={collectionTotal}
              hasCollectionArt={hasCollectionArt}
              applyScope={showScope ? applyScope : undefined}
              scopeContext={isCollectionItem ? 'collection' : 'movie'}
              onApplyScopeChange={showScope ? (patch) => {
                setCollectionScope(m => ({
                  ...m,
                  [s.id]: { ...(m[s.id] ?? defaultSetApplyScope(hasCollectionArt, collectionInLib)), ...patch },
                }))
                setApplyMap(m => { const next = { ...m }; delete next[s.id]; return next })
              } : undefined}
            />
          )
        })}
      </div>
    </motion.div>
  )
}

/** Small skeleton-aware thumbnail button used in the SetCard expanded view. */
function ThumbButton({ url, label, episode, onClick }: { url: string; label: string; episode?: number; onClick: () => void }) {
  const [loaded, setLoaded] = useState(false)
  return (
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
}

/** Expandable card for one MediUX set: preview, uploader, counts, apply state, and grouped posters. */
function SetCard({ set, apply, onApply, enabledTypes, title, badge, disabled, followed, selectable, checked, onToggleSelect, onSchedule, scheduled, scheduling, collectionMovies, collectionTotal, hasCollectionArt, applyScope, scopeContext, onApplyScopeChange }: {
  set: MediuxSetSummary
  apply?: ApplyState
  onApply: () => void
  enabledTypes: Set<FileType>
  /** When shown (Creators view), the heading is the media title. */
  title?: string
  /** Optional match/applied badge. */
  badge?: React.ReactNode
  /** Disables Apply (e.g. no library match). */
  disabled?: boolean
  /** Uploader is a followed creator. */
  followed?: boolean
  /** Shows a selection checkbox (Creators sync). */
  selectable?: boolean
  checked?: boolean
  onToggleSelect?: () => void
  /** Creates a weekly sync job for this set (library view). */
  onSchedule?: () => void
  /** This set already has a scheduled job. */
  scheduled?: boolean
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
}) {
  const [err, setErr]               = useState(false)
  const [previewLoaded, setPreviewLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const status = apply?.status ?? 'idle'
  const openCreator = useContext(CreatorNav)

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
    <div className={`${styles.setCard} ${followed ? styles.setCardFollowed : ''} ${checked ? styles.setCardChecked : ''}`}>
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
              onClick={() => openCreator(set.uploader)}
              title={`View ${set.uploader} in Creators`}
            >
              {set.uploaderAvatar ? (
                <img className={styles.avatar} src={set.uploaderAvatar} alt={set.uploader} />
              ) : (
                <div className={styles.avatarFallback}><User size={11} /></div>
              )}
              <span className={styles.uploaderName}>{set.uploader}</span>
              {followed && <Star size={10} className={styles.followStar} />}
            </button>
            {!title && badge}
          </div>

          <div className={styles.setCounts}>
            {enabledTypes.has('poster')     && set.posterCount > 0    && <span className={styles.countBadge}>{set.posterCount} poster{set.posterCount !== 1 ? 's' : ''}</span>}
            {enabledTypes.has('title_card') && set.titleCardCount > 0 && <span className={styles.countBadge}>{set.titleCardCount} card{set.titleCardCount !== 1 ? 's' : ''}</span>}
            {enabledTypes.has('backdrop')   && set.backdropCount > 0  && <span className={styles.countBadge}>{set.backdropCount} backdrop{set.backdropCount !== 1 ? 's' : ''}</span>}
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
              scheduled
                ? <span className={styles.scheduledTag} title="A weekly sync is scheduled for this set"><CalendarClock size={12} /> Scheduled weekly</span>
                : <button className={styles.scheduleBtn} onClick={onSchedule} disabled={scheduling} title="Sync this set automatically every week">
                    {scheduling ? <Loader2 size={12} className={styles.spin} /> : <CalendarClock size={12} />} Schedule
                  </button>
            )}
          </div>
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
                      name={`scope-movies-${set.id}`}
                      checked={applyScope.movies === 'this'}
                      onChange={() => onApplyScopeChange({ movies: 'this' })}
                    />
                    This movie only
                  </label>
                  <label className={styles.scopeRadio}>
                    <input
                      type="radio"
                      name={`scope-movies-${set.id}`}
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
                      name={`scope-movies-${set.id}`}
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
                return (
                  <div key={g.label} className={styles.group}>
                    <div className={styles.groupLabel}>
                      {g.label}
                      <span className={styles.groupCount}>{g.posters.length}</span>
                    </div>
                    <div className={`${styles.groupThumbs} ${g.kind === 'title_card' || g.kind === 'backdrop' ? styles.groupThumbsWide : ''}`}>
                      {g.posters.map(p => {
                        flat++
                        const idx = flat
                        return (
                          <ThumbButton
                            key={p.url}
                            url={p.thumbUrl ?? p.url}
                            label={g.label}
                            episode={p.episode}
                            onClick={() => setLightbox(idx)}
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

/**
 * Normalises creator input.
 *
 * @param input - A full profile URL or a bare username.
 * @returns The bare username, with any leading @ stripped.
 */
function normalizeUsername(input: string): string {
  const t = input.trim()
  const m = t.match(/mediux\.pro\/user\/([^/?#]+)/i)
  return (m ? m[1] : t).replace(/^@/, '').trim()
}

/** Creators view: followed-creator rail plus the selected creator's sets. */
function CreatorsView({ initialCreator }: { initialCreator: string | null }) {
  const [subs, setSubs]       = useState<string[]>([])
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>({ setIds: new Set(), titles: new Set(), posterUrls: new Set(), currentByItem: new Map(), currentPosterUrls: new Set() })
  const [active, setActive]   = useState<string | null>(null)
  const [adding, setAdding]   = useState('')

  useEffect(() => {
    window.api.config.get().then(c => {
      const list = c.mediuxSubscriptions ?? []
      setSubs(list)
      if (list.length) setActive(prev => prev ?? list[0])
    })
    loadAppliedIndex().then(setAppliedIdx)
  }, [])

  // A username arriving from a clicked badge (preview, may not be followed)
  useEffect(() => {
    if (initialCreator) setActive(initialCreator)
  }, [initialCreator])

  async function persist(list: string[]) {
    setSubs(list)
    await window.api.config.set({ mediuxSubscriptions: list })
  }

  const isFollowing = (name: string) => subs.some(s => s.toLowerCase() === name.toLowerCase())

  async function follow(name: string) {
    if (isFollowing(name)) return
    await persist([...subs, name])
  }

  async function addCreator() {
    const name = normalizeUsername(adding)
    if (!name) return
    if (!isFollowing(name)) await persist([...subs, name])
    setActive(name)
    setAdding('')
  }

  async function removeCreator(name: string) {
    const next = subs.filter(s => s.toLowerCase() !== name.toLowerCase())
    await persist(next)
    if (active?.toLowerCase() === name.toLowerCase()) setActive(next[0] ?? null)
  }

  return (
    <div className={styles.creators}>
      {/* Subscriptions rail */}
      <div className={styles.creatorRail}>
        <div className={styles.railHeader}>Following</div>
        <div className={styles.creatorList}>
          {subs.length === 0 && <p className={styles.railEmpty}>No creators yet. Add one below.</p>}
          {subs.map(name => (
            <div
              key={name}
              className={`${styles.creatorItem} ${active?.toLowerCase() === name.toLowerCase() ? styles.creatorItemActive : ''}`}
              onClick={() => setActive(name)}
            >
              <Star size={12} className={styles.creatorStar} />
              <span className={styles.creatorName}>{name}</span>
              <button className={styles.creatorRemove} onClick={e => { e.stopPropagation(); removeCreator(name) }} title="Unfollow">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className={styles.addCreator}>
          <span className={styles.addLabel}>Follow a creator</span>
          <div className={styles.addField}>
            <UserPlus size={14} className={styles.addIcon} />
            <input
              className={styles.addInput}
              placeholder="username or mediux.pro/user/…"
              value={adding}
              onChange={e => setAdding(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCreator() }}
              spellCheck={false}
            />
            <button className={styles.addBtn} onClick={addCreator} disabled={!adding.trim()} title="Follow">
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Selected creator's recent sets */}
      <div className={styles.creatorMain}>
        {active ? (
          <CreatorSets
            key={active}
            username={active}
            following={isFollowing(active)}
            appliedIdx={appliedIdx}
            onFollow={() => follow(active)}
            onUnfollow={() => removeCreator(active)}
            onApplied={(setId, itemKey, title, year, urls) => setAppliedIdx(prev => ({
              setIds: new Set(prev.setIds).add(setId),
              titles: new Set(prev.titles).add(appliedKey(title, year)),
              posterUrls: new Set([...prev.posterUrls, ...urls]),
              currentByItem: new Map(prev.currentByItem).set(itemKey, setId),
              currentPosterUrls: new Set([...prev.currentPosterUrls, ...urls]),
            }))}
          />
        ) : (
          <div className={styles.creatorEmpty}>
            <UserPlus size={32} />
            <p>Follow a MediUX creator to browse their newest art.</p>
            <p className={styles.creatorEmptySub}>e.g. <code>aloha_alona</code> or a profile URL</p>
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

/** A creator's recent sets with tabs, deep search, selection, and weekly-sync scheduling. */
function CreatorSets({ username, following, appliedIdx, onFollow, onUnfollow, onApplied }: {
  username: string
  following: boolean
  appliedIdx: AppliedIndex
  onFollow: () => void
  onUnfollow: () => void
  onApplied: (setId: string, itemKey: string, title: string, year: number | undefined, urls: string[]) => void
}) {
  const { navigate } = useAppContext()
  const [sets, setSets]       = useState<MediuxUserSet[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
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

  // Sets already covered by a saved schedule, individually or by a
  // whole-creator "/user/{name}/sets" sync job
  const [scheduledSetIds, setScheduledSetIds] = useState<Set<string>>(new Set())
  const [creatorScheduled, setCreatorScheduled] = useState(false)

  const [allTypes, setAllTypes] = useState<Set<FileType>>(new Set(ALL_TYPES))
  useEffect(() => {
    window.api.config.get().then(c => {
      if (c.mediuxFilters?.length) setAllTypes(new Set(c.mediuxFilters as FileType[]))
    })
  }, [])

  const refresh = useCallback(() => setReloadKey(k => k + 1), [])

  // Auto-load the creator's full set catalog in the background. The backend
  // (library:userSets) crawls every MediUX page and dedupes by set id: MediUX
  // serves a ~24-set sliding window per page (+12 new each, not cumulative), so
  // one page is never the whole catalog. A large creator's first load can take a
  // while; it resolves in a single call. Cancels cleanly when switching creators.
  //
  // Backed by a session cache: a fresh cached entry is served instantly with no
  // network. A manual Refresh (reloadKey > 0) or a stale entry re-fetches; when
  // cached sets are already shown, the re-fetch happens quietly in the
  // background so the list never blanks or visibly re-sorts.
  useEffect(() => {
    let cancelled = false
    const cached = creatorSetsCache.get(username)
    const forced = reloadKey > 0
    const fresh  = !!cached && Date.now() - cached.fetchedAt < CREATOR_CACHE_TTL

    setError(null)
    setSelected(new Set())

    if (cached) {
      setSets(cached.sets); setCapped(cached.capped); setLastChecked(cached.fetchedAt)
      setLoading(false); setLoadingMore(false)
    } else {
      setSets([]); setCapped(false); setLoading(true); setLoadingMore(false)
    }

    // Fresh cache and not an explicit refresh: no network at all
    if (fresh && !forced) return

    const hasCache = !!cached
    if (hasCache) setRefreshing(true)

    ;(async () => {
      let res: UserSetsRes
      try { res = await window.api.library.userSets({ username }) }
      catch (e) {
        if (!cancelled) {
          if (!hasCache) setError(e instanceof Error ? e.message : String(e))
          setLoading(false); setLoadingMore(false); setRefreshing(false)
        }
        return
      }
      if (cancelled) return
      if (res.error) {
        if (!hasCache) setError(res.error)
        setLoading(false); setLoadingMore(false); setRefreshing(false)
        return
      }
      const now = Date.now()
      const capped = res.capped ?? false
      setSets(res.sets); setCapped(capped)
      setLoading(false); setLoadingMore(false); setRefreshing(false)
      setLastChecked(now)
      creatorSetsCache.set(username, { sets: res.sets, capped, fetchedAt: now })
    })()
    return () => { cancelled = true }
  }, [username, reloadKey])

  // Keep the "checked Xm ago" stamp honest while sitting on a creator
  useEffect(() => {
    if (!lastChecked) return
    const id = setInterval(() => setNowTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [lastChecked])

  const loadSchedule = useCallback(() => {
    window.api.scheduler.list().then((jobs) => {
      const ids = new Set<string>()
      let whole = false
      const userRe = new RegExp(`mediux\\.pro/user/${username}(?:/|$|\\?)`, 'i')
      for (const j of jobs) {
        if (!j.enabled) continue
        for (const url of j.urls) {
          const m = url.match(/\/sets\/(\d+)/)
          if (m) ids.add(m[1])
          if (userRe.test(url)) whole = true
        }
      }
      setScheduledSetIds(ids)
      setCreatorScheduled(whole)
    })
  }, [username])

  useEffect(() => { loadSchedule() }, [loadSchedule])

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

  // Tab data, filtered by the title search and sorted matches-first. A creator's
  // uploads on MediUX are always single-title sets; multi-title boxsets live on
  // a separate URL space (/boxsets/N) and are handled by manual import, not here
  const setsFiltered = useMemo(() => allSets.filter(s => matchQuery(s)).sort(matchFirst), [allSets, q])
  const flatFiles = useMemo(() => allSets.flatMap(s => s.posters.map(poster => ({ set: s, poster }))), [allSets])
  const posterItems = useMemo(
    () => flatFiles.filter(f => posterFileType(f.poster) === 'poster' && matchQuery(f.set)).sort((a, b) => matchFirst(a.set, b.set)),
    [flatFiles, q],
  )
  const backdropItems = useMemo(
    () => flatFiles.filter(f => posterFileType(f.poster) === 'backdrop' && matchQuery(f.set)).sort((a, b) => matchFirst(a.set, b.set)),
    [flatFiles, q],
  )
  const titleCardItems = useMemo(
    () => flatFiles.filter(f => posterFileType(f.poster) === 'title_card' && matchQuery(f.set)).sort((a, b) => matchFirst(a.set, b.set)),
    [flatFiles, q],
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
    const collectionArt = s.posters.filter(p => p.isCollection)
    const mainPosters   = s.posters.filter(p => !p.isCollectionMember && !p.isCollection)
    const memberPosters = s.posters.filter(p => p.isCollectionMember)
    const enabledTotal  = s.posters.filter(p => allTypes.has(posterFileType(p))).length
    setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: 0, total: enabledTotal } }))

    let totalDone = 0, totalFailed = 0
    const allAppliedUrls: string[] = []

    if (s.matchedKey) {
      const mainRes = await applyPosters(s.matchedKey, mainPosters, allTypes,
        (d, _t) => setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: totalDone + d, total: enabledTotal } })))
      totalDone   += mainRes.done
      totalFailed += mainRes.failed
      allAppliedUrls.push(...mainRes.appliedUrls)
    } else if (mainPosters.length > 0) {
      totalFailed += mainPosters.filter(p => allTypes.has(posterFileType(p))).length
    }

    if (collectionArt.length > 0) {
      const coll = await window.api.plex.findCollection(collectionArt[0].title) as { key: string; title: string; thumb?: string } | null
      if (coll) {
        const collRes = await applyPosters(coll.key, collectionArt, allTypes,
          (d, _t) => setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: totalDone + d, total: enabledTotal } })))
        totalDone   += collRes.done
        totalFailed += collRes.failed
        allAppliedUrls.push(...collRes.appliedUrls)
        if (collRes.done > 0) {
          void recordApplied({
            itemKey: coll.key, title: coll.title, type: 'collection',
            source: 'mediux', thumb: collectionArt[0].thumbUrl ?? collectionArt[0].url,
            setId: s.id, uploader: s.uploader,
            posterUrls: collRes.appliedUrls, appliedAt: new Date().toISOString(),
          })
        }
      } else {
        totalFailed += collectionArt.filter(p => allTypes.has(posterFileType(p))).length
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
        if (memberRes.done > 0) {
          void recordApplied({
            itemKey: found.key, title: found.title, year: found.year,
            type: (found.type === 'movie' ? 'movie' : 'show'),
            source: 'mediux', thumb: found.thumb,
            setId: s.id, uploader: s.uploader,
            posterUrls: memberRes.appliedUrls, appliedAt: new Date().toISOString(),
          })
        }
      }
    }

    if (totalDone > 0 && s.matchedKey) {
      void recordApplied({
        itemKey: s.matchedKey, title: s.title, year: s.year, type: s.matchedType ?? 'movie',
        source: 'mediux', thumb: s.previewUrl, setId: s.id, uploader: s.uploader,
        posterUrls: allAppliedUrls, appliedAt: new Date().toISOString(),
      })
      onApplied(s.id, s.matchedKey, s.title, s.year, allAppliedUrls)
    }
    setApplyMap(m => ({
      ...m,
      [s.id]: { status: totalFailed && !totalDone ? 'error' : 'done', done: totalDone, total: enabledTotal, error: totalFailed ? `${totalFailed} failed` : undefined },
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
      const { done, appliedUrls, lastError } = await applyPosters(coll.key, [file], allTypes, () => {})
      if (done) {
        void recordApplied({
          itemKey: coll.key, title: coll.title, type: 'collection',
          source: 'mediux', thumb: file.thumbUrl ?? file.url, setId: s.id, uploader: s.uploader,
          posterUrls: appliedUrls, appliedAt: new Date().toISOString(),
        })
      }
      setApplyMap(m => ({ ...m, [key]: { status: done ? 'done' : 'error', done, total: 1, error: lastError } }))
      return
    }

    if (!s.matchedKey) return
    const { done, appliedUrls, lastError } = await applyPosters(s.matchedKey, [file], allTypes, () => {})
    if (done) {
      void recordApplied({
        itemKey: s.matchedKey, title: s.title, year: s.year, type: s.matchedType ?? 'movie',
        source: 'mediux', thumb: file.thumbUrl ?? file.url, setId: s.id, uploader: s.uploader,
        posterUrls: appliedUrls, appliedAt: new Date().toISOString(),
      })
      onApplied(s.id, s.matchedKey, s.title, s.year, appliedUrls)
    }
    setApplyMap(m => ({ ...m, [key]: { status: done ? 'done' : 'error', done, total: 1, error: lastError } }))
  }

  /** Saves a weekly sync job for the selected sets, or the whole creator when none are selected. */
  async function scheduleWeekly() {
    const chosen = setsFiltered.filter(s => selected.has(s.id))
    const useSelection = chosen.length > 0
    const urls = useSelection
      ? chosen.map(s => `https://mediux.pro/sets/${s.id}`)
      : [`https://mediux.pro/user/${username}/sets`]
    const job: ScheduledJob = {
      id: crypto.randomUUID(),
      name: useSelection ? `Sync @${username} (${urls.length} sets)` : `Sync @${username}`,
      urls,
      cronExpr: '0 9 * * 1',   // Mondays at 09:00 local time
      enabled: true,
    }
    await window.api.scheduler.save(job)
    loadSchedule()
    setScheduledMsg(useSelection
      ? `Weekly sync saved for ${urls.length} selected set${urls.length !== 1 ? 's' : ''}.`
      : `Weekly sync saved - newest matching uploads apply automatically.`)
  }

  // Scoped to the visible (search-filtered) sets so the toolbar counts track the view
  const matchCount      = setsFiltered.filter(s => s.matchedKey).length
  const selectedVisible = setsFiltered.filter(s => selected.has(s.id)).length

  const renderSetCard = (s: MediuxUserSet) => {
    const isCurrent    = !!s.matchedKey && appliedIdx.currentByItem.get(s.matchedKey) === s.id
    const wasApplied   = appliedIdx.setIds.has(s.id)
    const titleApplied = appliedIdx.titles.has(appliedKey(s.title, s.year))
    const isScheduled  = creatorScheduled || scheduledSetIds.has(s.id)
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

  return (
    <div className={styles.creatorSets}>
      <div className={styles.creatorBar}>
        <div className={styles.creatorBarInfo}>
          <span className={styles.creatorBarName}>{username}</span>
          <span className={styles.creatorBarMeta}>
            {error ? (
              'Could not load sets'
            ) : loading ? (
              'Loading…'
            ) : loadingMore ? (
              `Loading… ${sets.length} sets`
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
            <Button variant="secondary" size="sm" icon={<Star size={12} />} onClick={onUnfollow}>Following</Button>
          ) : (
            <Button variant="primary" size="sm" icon={<UserPlus size={12} />} onClick={onFollow}>Follow</Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={12} className={refreshing ? styles.spin : ''} />}
            onClick={refresh}
            disabled={loading || loadingMore || refreshing}
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
              variant="primary"
              size="sm"
              icon={<CalendarClock size={12} />}
              onClick={scheduleWeekly}
              className={styles.syncWeeklyBtn}
            >
              {selectedVisible > 0 ? `Sync ${selectedVisible} weekly` : 'Sync all weekly'}
            </Button>
          </div>
        </div>
      )}

      {/* Post-schedule tip */}
      <AnimatePresence>
        {scheduledMsg && (
          <motion.div
            className={styles.scheduleTip}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <CheckCircle2 size={14} />
            <span>{scheduledMsg} Fine-tune timing &amp; URLs in the <button className={styles.tipLink} onClick={() => navigate('scheduler')}>Scheduler</button>.</span>
            <button className={styles.tipClose} onClick={() => setScheduledMsg(null)}><X size={13} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={styles.creatorSetsList}>
        {/* Gate the list until the background auto-load settles, so it appears
            once (already sorted) instead of visibly re-sorting as each page
            arrives; skeleton cards keep the layout in place meanwhile */}
        {(loading || loadingMore) && !error &&
          Array.from({ length: 6 }).map((_, i) => <SetCardSkeleton key={`skel-${i}`} />)}
        {error && <div className={styles.panelNotice}><AlertCircle size={20} /><p>{error}</p></div>}
        {!loading && !loadingMore && !error && sets.length === 0 && (
          <div className={styles.panelNotice}><ImageIcon size={20} /><p>No sets found for this creator.</p></div>
        )}

        {/* Sets tab */}
        {!loading && !loadingMore && !error && sets.length > 0 && tab === 'sets' && (
          setsFiltered.length
            ? setsFiltered.map(renderSetCard)
            : <div className={styles.panelNotice}><ImageIcon size={20} /><p>{query ? (searching ? 'Searching their full catalog…' : 'No matches found, try a different title.') : 'No sets loaded yet.'}</p></div>
        )}

        {/* Posters / Backdrops / Title Cards tabs: individual files */}
        {!loading && !loadingMore && !error && (tab === 'posters' || tab === 'backdrops' || tab === 'titlecards') && (
          fileItems.length ? (
            <div className={`${styles.fileGrid} ${tab === 'backdrops' || tab === 'titlecards' ? styles.fileGridWide : ''}`}>
              {fileItems.map(({ set, poster }, i) => {
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
                    onLightbox={() => setFileLightbox(i)}
                    onApply={() => applySingle(set, poster)}
                  />
                )
              })}
            </div>
          ) : <div className={styles.panelNotice}><ImageIcon size={20} /><p>{query ? (searching ? 'Searching their full catalog…' : 'No matches found, try a different title.') : tab === 'titlecards' ? 'No title cards loaded yet.' : `No ${tab} loaded yet.`}</p></div>
        )}

        {/* Cap note (shown once the catalog has settled) */}
        {!loading && !loadingMore && !error && capped && sets.length > 0 && (
          <div className={styles.loadMoreNote}>
            Showing this creator's newest {sets.length} sets (MediUX's browse limit), with your library matches first.
            Don't see one of your titles? <button className={styles.noteSearchLink} onClick={() => searchRef.current?.focus()}>Search</button> their full catalog by title above.
          </div>
        )}
      </div>

      <AnimatePresence>
        {fileLightbox !== null && (
          <Lightbox images={fileLightboxImages} index={fileLightbox} onClose={() => setFileLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
