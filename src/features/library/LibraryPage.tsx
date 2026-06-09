import { useEffect, useRef, useState, useCallback, useMemo, createContext, useContext } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X, Upload, Check, AlertCircle, Loader2, User, Image as ImageIcon, ChevronDown, ChevronUp, Plus, UserPlus, Trash2, CalendarClock, CheckCircle2, RefreshCw, Star, Library, Download, LayoutGrid, Users, Film, Tv } from 'lucide-react'
import type { ScheduledJob } from '../../../electron/ipc/types'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import Checkbox from '../../components/ui/Checkbox'
import Spinner from '../../components/ui/Spinner'
import Lightbox, { type LightboxImage } from '../../components/ui/Lightbox'
import PlexConnectBanner from '../../components/ui/PlexConnectBanner'
import { groupPosters, posterFileType, ALL_TYPES, type FileType } from '../../utils/posterGroups'
import { recordApplied, appliedKey, loadAppliedIndex, type AppliedIndex } from '../../utils/appliedTracker'
import { useAppContext } from '../../app/AppContext'
import type {
  LibrarySection, LibraryItem, MediuxSetSummary, BrowseSetsRes, PosterInfo, MediuxUserSet, UserSetsRes,
} from '../../../electron/ipc/types'
import styles from './LibraryPage.module.css'

const PAGE_SIZE = 60

// Session cache for a creator's fully-paginated sets, so flipping between
// creators (or re-opening one) is instant instead of re-scraping every time.
// Lives for the renderer process lifetime; a manual Refresh or a stale entry
// (older than the TTL) triggers a re-fetch.
interface CreatorCacheEntry { sets: MediuxUserSet[]; capped: boolean; fetchedAt: number }
const creatorSetsCache = new Map<string, CreatorCacheEntry>()
const CREATOR_CACHE_TTL = 30 * 60 * 1000   // 30 minutes

// Compact relative time for the "last checked" stamp.
function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Apply progress for a single set
interface ApplyState { status: 'idle' | 'applying' | 'done' | 'error'; done: number; total: number; error?: string }

// Apply a set's posters to a Plex target, routing each by season/episode.
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
      const res = await window.api.plex.uploadPoster(targetKey, p.url, p.source, p.season, p.episode) as { success: boolean; error?: string }
      if (res.success) { done++; appliedUrls.push(p.url) } else { failed++; lastError = res.error }
    } catch (err) { failed++; lastError = err instanceof Error ? err.message : String(err) }
    onProgress(done, list.length)
  }
  return { done, failed, total: list.length, appliedUrls, lastError }
}

// Lets any nested set card jump to a creator in the Creators tab.
const CreatorNav = createContext<(username: string) => void>(() => {})

// Shared: read the followed-creator usernames (lowercased) from config.
function useSubscriptions() {
  const [subs, setSubs] = useState<string[]>([])
  useEffect(() => {
    window.api.config.get().then(c => setSubs((c.mediuxSubscriptions ?? []).map(s => s.toLowerCase())))
  }, [])
  return subs
}

function MyLibraryView({ subs }: { subs: string[] }) {
  const [sections, setSections]   = useState<LibrarySection[]>([])
  const [activeKey, setActiveKey] = useState<string>('')

  const [items, setItems]     = useState<LibraryItem[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch]   = useState('')

  // Cross-library search state
  const [globalResults, setGlobalResults] = useState<{ section: LibrarySection; items: LibraryItem[] }[]>([])
  const [globalLoading, setGlobalLoading] = useState(false)

  const [selected, setSelected] = useState<LibraryItem | null>(null)

  const offsetRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const isGlobalSearch = search.trim().length > 0

  // -- Load sections (on mount + whenever the Plex connection becomes ready) ---
  const loadSections = useCallback(() => {
    window.api.library.sections().then((s: LibrarySection[]) => {
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

  // -- Single-tab load (only when not in global search mode) ------------------
  const loadItems = useCallback(async (key: string, q: string, append: boolean) => {
    if (!key) return
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

  useEffect(() => {
    if (!activeKey || isGlobalSearch) return
    offsetRef.current = 0
    const t = setTimeout(() => loadItems(activeKey, '', false), 0)
    return () => clearTimeout(t)
  }, [activeKey, isGlobalSearch, loadItems])

  // -- Cross-library search: fire all sections in parallel with debounce ------
  useEffect(() => {
    if (!isGlobalSearch || !sections.length) { setGlobalResults([]); return }
    setGlobalLoading(true)
    const q = search.trim()
    let cancelled = false
    const t = setTimeout(() => {
      Promise.all(
        sections.map(s =>
          window.api.library.items({ sectionKey: s.key, offset: 0, limit: 24, search: q })
            .then(res => ({ section: s, items: res.items }))
            .catch(() => ({ section: s, items: [] as LibraryItem[] }))
        )
      ).then(results => {
        if (cancelled) return
        setGlobalResults(results.filter(r => r.items.length > 0))
        setGlobalLoading(false)
      })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search, isGlobalSearch, sections])

  // -- Infinite scroll (single-tab mode only) ---------------------------------
  function onScroll() {
    const el = scrollRef.current
    if (!el || loading || isGlobalSearch) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400 && items.length < total) {
      loadItems(activeKey, '', true)
    }
  }

  const totalGlobalHits = globalResults.reduce((n, g) => n + g.items.length, 0)

  return (
    <>
      {/* -- Controls -------------------------------------------------------- */}
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
        </div>

        <div className={styles.searchBox}>
          <Search size={14} className={styles.searchIcon} />
          <input
            className={`${styles.searchInput} ${isGlobalSearch ? styles.searchInputActive : ''}`}
            placeholder={isGlobalSearch ? 'Searching all libraries…' : 'Search…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            spellCheck={false}
          />
          {search && (
            <button className={styles.searchClear} onClick={() => setSearch('')}><X size={13} /></button>
          )}
        </div>
      </div>

      {/* -- Grid area ------------------------------------------------------- */}
      <div className={styles.gridScroll} ref={scrollRef} onScroll={onScroll}>
        {isGlobalSearch ? (
          // Cross-library results
          globalLoading ? (
            <div className={styles.gridLoading}><Spinner size="sm" /><span>Searching all libraries…</span></div>
          ) : globalResults.length === 0 ? (
            <div className={styles.emptyGrid}>
              <ImageIcon size={32} />
              <p>No results across any library.</p>
            </div>
          ) : (
            <div className={styles.globalResults}>
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
          // Single-tab browsing
          <>
            {items.length === 0 && !loading ? (
              <div className={styles.emptyGrid}>
                <ImageIcon size={32} />
                <p>This library is empty.</p>
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

      {/* -- Sets panel ------------------------------------------------------ */}
      <AnimatePresence>
        {selected && (
          <SetsPanel
            key={selected.key}
            item={selected}
            subs={subs}
            onClose={() => setSelected(null)}
            onItemPoster={(key, thumb) => {
              setItems(prev => prev.map(it => it.key === key ? { ...it, thumb } : it))
              setSelected(prev => prev && prev.key === key ? { ...prev, thumb } : prev)
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// --- Shell: mode switch between My Library and Creators -------------------------

type Mode = 'library' | 'creators'

export default function LibraryPage() {
  const { plexConnected } = useAppContext()
  const [mode, setMode] = useState<Mode>('library')
  const [creatorTarget, setCreatorTarget] = useState<string | null>(null)
  const subs = useSubscriptions()

  const openCreator = useCallback((username: string) => {
    setCreatorTarget(username)
    setMode('creators')
  }, [])

  return (
    <CreatorNav.Provider value={openCreator}>
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className="page-title">Library Browser</h1>
            <p className="page-subtitle">
              {mode === 'library'
                ? 'Browse your Plex library and apply MediUX poster sets.'
                : 'Follow MediUX creators and apply their newest art to your library.'}
            </p>
          </div>

          {/* -- Mode switch (header right) -------------------------------- */}
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
          <MyLibraryView subs={subs} />
        ) : (
          <CreatorsView initialCreator={creatorTarget} />
        )}
      </div>
    </CreatorNav.Provider>
  )
}

// --- Plex item card ------------------------------------------------------------

function ItemCard({ item, active, onClick }: { item: LibraryItem; active: boolean; onClick: () => void }) {
  const [err, setErr]       = useState(false)
  const [loaded, setLoaded] = useState(false)
  return (
    <button className={`${styles.itemCard} ${active ? styles.itemCardActive : ''}`} onClick={onClick} title={item.title}>
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
          <div className={styles.itemPosterFallback}>{item.title.charAt(0)}</div>
        )}
        <div className={styles.itemOverlay} aria-hidden="true">
          <span className={styles.itemOverlayHint}>Browse Sets</span>
        </div>
      </div>
      <div className={styles.itemMeta}>
        <span className={styles.itemTitle}>{item.title}</span>
        {item.year && <span className={styles.itemYear}>{item.year}</span>}
      </div>
    </button>
  )
}

// --- Sets panel (right drawer) -------------------------------------------------

function SetsPanel({ item, subs, onClose, onItemPoster }: {
  item: LibraryItem
  subs: string[]
  onClose: () => void
  onItemPoster: (key: string, thumb: string) => void
}) {
  const [sets, setSets]       = useState<MediuxSetSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const [uploader, setUploader] = useState<string>('all')
  const [types, setTypes]       = useState<Set<FileType>>(new Set(ALL_TYPES))
  const [applyMap, setApplyMap] = useState<Record<string, ApplyState>>({})
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>({ setIds: new Set(), titles: new Set(), posterUrls: new Set(), currentByItem: new Map(), currentPosterUrls: new Set() })

  const subSet = useMemo(() => new Set(subs), [subs])
  const itemApplied = appliedIdx.titles.has(appliedKey(item.title, item.year))

  useEffect(() => { loadAppliedIndex().then(setAppliedIdx) }, [])

  useEffect(() => {
    window.api.config.get().then(c => {
      if (c.mediuxFilters?.length) setTypes(new Set(c.mediuxFilters as FileType[]))
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null); setSets([])
    window.api.library.sets({
      type: item.type, tmdbId: item.tmdbId, tvdbId: item.tvdbId, imdbId: item.imdbId,
    }).then((res: BrowseSetsRes) => {
      if (cancelled) return
      if (res.error === 'no_tmdb') setError('no_tmdb')
      else if (res.error) setError(res.error)
      // Pin followed creators' sets to the top
      const sorted = [...res.sets].sort((a, b) => {
        const fa = subSet.has(a.uploader.toLowerCase()) ? 0 : 1
        const fb = subSet.has(b.uploader.toLowerCase()) ? 0 : 1
        return fa - fb
      })
      setSets(sorted)
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [item, subSet])

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
    () => uploader === 'all' ? sets : sets.filter(s => s.uploader === uploader),
    [sets, uploader],
  )

  function toggleType(t: FileType) {
    setTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next.size ? next : prev   // keep at least one
    })
  }

  async function applySet(s: MediuxSetSummary) {
    const mainPosters       = s.posters.filter(p => !p.isCollectionMember)
    const memberPosters     = s.posters.filter(p => p.isCollectionMember)
    const enabledTotal      = s.posters.filter(p => types.has(posterFileType(p))).length
    setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: 0, total: enabledTotal } }))

    let totalDone = 0, totalFailed = 0
    const allAppliedUrls: string[] = []

    // 1. Apply collection-level / show-level posters to the main item key.
    const mainRes = await applyPosters(item.key, mainPosters, types,
      (d, _t) => setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: totalDone + d, total: enabledTotal } })))
    totalDone   += mainRes.done
    totalFailed += mainRes.failed
    allAppliedUrls.push(...mainRes.appliedUrls)

    // 2. For individual movies within a boxset/collection: look up each movie's
    //    own Plex key, upload to it, and record it separately in Reset Posters.
    if (memberPosters.length > 0) {
      const movieMap = new Map<string, { title: string; year?: number; posters: PosterInfo[] }>()
      for (const p of memberPosters) {
        const key = `${p.title.toLowerCase()}|${p.year ?? ''}`
        const existing = movieMap.get(key)
        if (existing) existing.posters.push(p)
        else movieMap.set(key, { title: p.title, year: p.year, posters: [p] })
      }
      for (const m of movieMap.values()) {
        const found = await window.api.plex.findItem(m.title, m.year) as { key: string; title: string; year?: number; type: string; thumb?: string; libraryTitle?: string } | null
        if (!found) {
          totalFailed += m.posters.filter(p => types.has(posterFileType(p))).length
          continue
        }
        const memberRes = await applyPosters(found.key, m.posters, types,
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

    if (totalDone > 0) {
      void recordApplied({
        itemKey: item.key, title: item.title, year: item.year, type: item.type,
        source: 'mediux', thumb: item.thumb, setId: s.id, uploader: s.uploader,
        posterUrls: allAppliedUrls, appliedAt: new Date().toISOString(),
      })
      setAppliedIdx(prev => ({
        setIds: new Set(prev.setIds).add(s.id),
        titles: new Set(prev.titles).add(appliedKey(item.title, item.year)),
        posterUrls: new Set([...prev.posterUrls, ...allAppliedUrls]),
        currentByItem: new Map(prev.currentByItem).set(item.key, s.id),
        currentPosterUrls: new Set([...prev.currentPosterUrls, ...allAppliedUrls]),
      }))
      const main = mainPosters.find(p => p.season == null && p.episode == null)
      if (main) onItemPoster(item.key, main.thumbUrl ?? main.url)
    }
    setApplyMap(m => ({
      ...m,
      [s.id]: { status: totalFailed && !totalDone ? 'error' : 'done', done: totalDone, total: enabledTotal, error: totalFailed ? `${totalFailed} failed` : undefined },
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
      <div className={styles.panelHeader}>
        <div className={styles.panelTitleWrap}>
          <h2 className={styles.panelTitle}>{item.title}</h2>
          {item.year && <span className={styles.panelYear}>{item.year}</span>}
        </div>
        <button className={styles.panelClose} onClick={onClose}><X size={16} /></button>
      </div>

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
        {loading && <div className={styles.panelLoading}><Spinner size="sm" /> <span>Finding sets on MediUX…</span></div>}

        {error === 'no_tmdb' && (
          <div className={styles.panelNotice}>
            <AlertCircle size={20} />
            <p><strong>No TMDB match for this item.</strong></p>
            <p className={styles.noticeSub}>
              This title uses a {item.tvdbId ? 'TVDB' : item.imdbId ? 'IMDb' : 'non-TMDB'} agent.
              Add a free TMDB API key in Settings to auto-convert {item.tvdbId || item.imdbId ? 'it' : 'these'} to TMDB.
            </p>
          </div>
        )}
        {error && error !== 'no_tmdb' && (
          <div className={styles.panelNotice}><AlertCircle size={20} /><p>{error}</p></div>
        )}

        {!loading && !error && sets.length === 0 && (
          <div className={styles.panelNotice}><ImageIcon size={20} /><p>No MediUX sets found for this title.</p></div>
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
          return (
            <SetCard
              key={s.id}
              set={s}
              apply={applyMap[s.id]}
              onApply={() => applySet(s)}
              enabledTypes={types}
              followed={subSet.has(s.uploader.toLowerCase())}
              badge={badge}
            />
          )
        })}
      </div>
    </motion.div>
  )
}

// Small skeleton-aware thumbnail button used in the SetCard expanded view.
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

// --- Set card ------------------------------------------------------------------

function SetCard({ set, apply, onApply, enabledTypes, title, badge, disabled, followed, selectable, checked, onToggleSelect }: {
  set: MediuxSetSummary
  apply?: ApplyState
  onApply: () => void
  enabledTypes: Set<FileType>
  title?: string          // when shown (Creators view), heading is the media title
  badge?: React.ReactNode // optional match/applied badge
  disabled?: boolean      // disable Apply (e.g. no library match)
  followed?: boolean      // uploader is a followed creator
  selectable?: boolean    // show a selection checkbox (Creators sync)
  checked?: boolean
  onToggleSelect?: () => void
}) {
  const [err, setErr]               = useState(false)
  const [previewLoaded, setPreviewLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const status = apply?.status ?? 'idle'
  const openCreator = useContext(CreatorNav)

  const groups = useMemo(() => groupPosters(set.posters), [set.posters])
  const totalCount = set.posterCount + set.titleCardCount + set.backdropCount

  // Flattened poster list (group order) for the full-screen lightbox
  const [lightbox, setLightbox] = useState<number | null>(null)
  const lightboxImages = useMemo<LightboxImage[]>(
    () => groups.flatMap(g => g.posters.map(p => ({
      url: p.url,
      label: g.label,
      caption: p.episode != null ? `Episode ${p.episode}` : (p.title || undefined),
    }))),
    [groups],
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
            {set.posterCount > 0    && <span className={styles.countBadge}>{set.posterCount} poster{set.posterCount !== 1 ? 's' : ''}</span>}
            {set.titleCardCount > 0 && <span className={styles.countBadge}>{set.titleCardCount} card{set.titleCardCount !== 1 ? 's' : ''}</span>}
            {set.backdropCount > 0  && <span className={styles.countBadge}>{set.backdropCount} backdrop{set.backdropCount !== 1 ? 's' : ''}</span>}
          </div>

          <div className={styles.setActions}>
            {status === 'idle' && (
              <Button variant="primary" size="sm" icon={<Upload size={12} />} onClick={onApply} disabled={disabled}>Apply</Button>
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
          </div>
        </div>
      </div>

      {/* Clear, full-width expand affordance */}
      <button className={`${styles.setExpandBar} ${open ? styles.setExpandBarOpen : ''}`} onClick={() => setOpen(v => !v)}>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span>{open ? 'Hide posters' : `Preview ${totalCount} poster${totalCount !== 1 ? 's' : ''}`}</span>
      </button>

      {/* Grouped contents - posters never mixed across types */}
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
              return groups.map(g => {
                const dim = !enabledTypes.has(g.kind)
                return (
                  <div key={g.label} className={`${styles.group} ${dim ? styles.groupDim : ''}`}>
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

// --- File tile (Posters / Backdrops tab in Creators) ---------------------------

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

// --- Creators view --------------------------------------------------------------

function normalizeUsername(input: string): string {
  const t = input.trim()
  // Accept a full profile URL or a bare username
  const m = t.match(/mediux\.pro\/user\/([^/?#]+)/i)
  return (m ? m[1] : t).replace(/^@/, '').trim()
}

function CreatorsView({ initialCreator }: { initialCreator: string | null }) {
  const [subs, setSubs]       = useState<string[]>([])
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>({ setIds: new Set(), titles: new Set(), posterUrls: new Set(), currentByItem: new Map(), currentPosterUrls: new Set() })
  const [active, setActive]   = useState<string | null>(null)
  const [adding, setAdding]   = useState('')

  // -- Load subscriptions + applied index -------------------------------------
  useEffect(() => {
    window.api.config.get().then(c => {
      const list = c.mediuxSubscriptions ?? []
      setSubs(list)
      if (list.length) setActive(prev => prev ?? list[0])
    })
    loadAppliedIndex().then(setAppliedIdx)
  }, [])

  // -- A username arriving from a clicked badge (preview, may not be followed) --
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
      {/* Left rail - subscriptions */}
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
          <UserPlus size={14} className={styles.addIcon} />
          <input
            className={styles.addInput}
            placeholder="username or profile URL"
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

      {/* Main - selected creator's recent sets */}
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

// --- A creator's recent sets ----------------------------------------------------

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
  const [, setNowTick] = useState(0)   // ticks the "checked Xm ago" stamp
  const [searchResults, setSearchResults] = useState<MediuxUserSet[]>([])
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Which sets are already covered by a saved schedule (individually, or by a
  // whole-creator "/user/{name}/sets" sync job).
  const [scheduledSetIds, setScheduledSetIds] = useState<Set<string>>(new Set())
  const [creatorScheduled, setCreatorScheduled] = useState(false)

  const [allTypes, setAllTypes] = useState<Set<FileType>>(new Set(ALL_TYPES))
  useEffect(() => {
    window.api.config.get().then(c => {
      if (c.mediuxFilters?.length) setAllTypes(new Set(c.mediuxFilters as FileType[]))
    })
  }, [])

  const refresh = useCallback(() => setReloadKey(k => k + 1), [])

  // Auto-load the creator's sets in the background. MediUX server-renders a
  // cumulative page (N = first N×12) but caps the creator's own sets after a
  // couple of pages, so we keep fetching higher pages until a page adds nothing
  // new (the cap), then stop. Cancels cleanly when switching creators.
  //
  // Backed by a session cache: a fresh cached entry is served instantly with no
  // network. A manual Refresh (reloadKey > 0) or a stale entry re-fetches; when
  // we already have cached sets to show, the re-fetch happens quietly in the
  // background so the list never blanks or visibly re-sorts.
  useEffect(() => {
    let cancelled = false
    const MAX_PAGES = 12   // safety bound on the cumulative re-fetch
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

    // Fresh cache and not an explicit refresh → no network at all.
    if (fresh && !forced) return

    const hasCache = !!cached
    if (hasCache) setRefreshing(true)

    ;(async () => {
      let prev = -1
      let latest: MediuxUserSet[] = []
      for (let n = 1; n <= MAX_PAGES && !cancelled; n++) {
        let res: UserSetsRes
        try { res = await window.api.library.userSets({ username, page: n }) }
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
        latest = res.sets
        if (!hasCache) { setSets(res.sets); setLoading(false) }  // progressive only when nothing is shown yet
        if (res.sets.length <= prev) break      // no growth → MediUX cap reached
        prev = res.sets.length
        if (!res.hasMore) break                 // server says no full page → done
        if (!hasCache) setLoadingMore(true)
      }
      if (cancelled) return
      const now = Date.now()
      setSets(latest); setCapped(true)
      setLoading(false); setLoadingMore(false); setRefreshing(false)
      setLastChecked(now)
      creatorSetsCache.set(username, { sets: latest, capped: true, fetchedAt: now })
    })()
    return () => { cancelled = true }
  }, [username, reloadKey])

  // Keep the "checked Xm ago" stamp honest while sitting on a creator.
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

  // Deep search across the creator's WHOLE catalog (beyond the browse cap): match
  // the query to the user's library, then fetch this creator's sets for those titles.
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

  // In-library matches first, then the rest (keeps newest order within each).
  const q = query.trim().toLowerCase()
  const matchFirst = (a: MediuxUserSet, b: MediuxUserSet) => (a.matchedKey ? 0 : 1) - (b.matchedKey ? 0 : 1)
  const matchQuery = (s: MediuxUserSet) => !q || s.title.toLowerCase().includes(q) || s.setName.toLowerCase().includes(q)

  // Merge deep-search results (creator's sets for matching library titles) with the
  // browsed sets, deduped — so search finds art beyond MediUX's browse cap.
  const allSets = useMemo(() => {
    if (!searchResults.length) return sets
    const seen = new Set(sets.map(s => s.id))
    return [...searchResults.filter(s => !seen.has(s.id)), ...sets]
  }, [sets, searchResults])

  // Tab data, all filtered by the title search and sorted matches-first. A creator's
  // uploads on MediUX are always single-title sets; multi-title boxsets live on a
  // separate URL space (/boxsets/N) and are handled by manual import, not here.
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

  // Unfiltered counts for the tab labels.
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
  // "In library" reflect what the user is actually looking at, not the whole catalog.
  const selectAll       = () => setSelected(new Set(setsFiltered.map(s => s.id)))
  const selectInLibrary = () => setSelected(new Set(setsFiltered.filter(s => s.matchedKey).map(s => s.id)))
  const clearSelection  = () => setSelected(new Set())

  async function applySet(s: MediuxUserSet) {
    if (!s.matchedKey) return
    const mainPosters   = s.posters.filter(p => !p.isCollectionMember)
    const memberPosters = s.posters.filter(p => p.isCollectionMember)
    const enabledTotal  = s.posters.filter(p => allTypes.has(posterFileType(p))).length
    setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: 0, total: enabledTotal } }))

    let totalDone = 0, totalFailed = 0
    const allAppliedUrls: string[] = []

    const mainRes = await applyPosters(s.matchedKey, mainPosters, allTypes,
      (d, _t) => setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: totalDone + d, total: enabledTotal } })))
    totalDone   += mainRes.done
    totalFailed += mainRes.failed
    allAppliedUrls.push(...mainRes.appliedUrls)

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

    if (totalDone > 0) {
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

  // Apply a single poster/backdrop file (from the Posters/Backdrops tabs).
  async function applySingle(s: MediuxUserSet, file: PosterInfo) {
    if (!s.matchedKey) return
    const key = `${s.id}:${file.url}`
    setApplyMap(m => ({ ...m, [key]: { status: 'applying', done: 0, total: 1 } }))
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

  async function scheduleWeekly() {
    // Selected (visible) sets → sync just those; otherwise sync the creator's newest uploads.
    const chosen = setsFiltered.filter(s => selected.has(s.id))
    const useSelection = chosen.length > 0
    const urls = useSelection
      ? chosen.map(s => `https://mediux.pro/sets/${s.id}`)
      : [`https://mediux.pro/user/${username}/sets`]
    const job: ScheduledJob = {
      id: crypto.randomUUID(),
      name: useSelection ? `Sync @${username} (${urls.length} sets)` : `Sync @${username}`,
      urls,
      cronExpr: '0 9 * * 1',   // Mondays at 09:00
      enabled: true,
    }
    await window.api.scheduler.save(job)
    loadSchedule()
    setScheduledMsg(useSelection
      ? `Weekly sync saved for ${urls.length} selected set${urls.length !== 1 ? 's' : ''}.`
      : `Weekly sync saved - newest matching uploads apply automatically.`)
  }

  // Scoped to the visible (search-filtered) sets so the toolbar counts track the view.
  const matchCount      = setsFiltered.filter(s => s.matchedKey).length
  const selectedVisible = setsFiltered.filter(s => selected.has(s.id)).length

  // Render one set as a SetCard (shared by the Sets + Boxsets tabs).
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

  // Individual-file tabs (Posters / Backdrops / Title Cards)
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
          {!loading && !error && (
            <span className={styles.creatorBarMeta}>
              {loadingMore ? (
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
          )}
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

      {/* Tabs + title filter */}
      {!loading && !error && sets.length > 0 && (
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
        {/* Gate the list until the background auto-load settles, so it appears once
            (already sorted) instead of visibly re-sorting as each page arrives. */}
        {(loading || loadingMore) && (
          <div className={styles.panelLoading}><Spinner size="sm" /> <span>Loading {username}'s art… {sets.length > 0 ? `${sets.length} sets` : ''}</span></div>
        )}
        {error && <div className={styles.panelNotice}><AlertCircle size={20} /><p>{error}</p></div>}
        {!loading && !loadingMore && !error && sets.length === 0 && (
          <div className={styles.panelNotice}><ImageIcon size={20} /><p>No sets found for this creator.</p></div>
        )}

        {/* Sets tab → SetCards */}
        {!loading && !loadingMore && !error && sets.length > 0 && tab === 'sets' && (
          setsFiltered.length
            ? setsFiltered.map(renderSetCard)
            : <div className={styles.panelNotice}><ImageIcon size={20} /><p>{query ? (searching ? 'Searching their full catalog…' : 'No matches found — try a different title.') : 'No sets loaded yet.'}</p></div>
        )}

        {/* Posters / Backdrops / Title Cards tabs → individual files */}
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
          ) : <div className={styles.panelNotice}><ImageIcon size={20} /><p>{query ? (searching ? 'Searching their full catalog…' : 'No matches found — try a different title.') : tab === 'titlecards' ? 'No title cards loaded yet.' : `No ${tab} loaded yet.`}</p></div>
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
