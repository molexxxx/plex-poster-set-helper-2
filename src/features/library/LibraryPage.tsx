import { useEffect, useRef, useState, useCallback, useMemo, createContext, useContext } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X, Upload, Check, AlertCircle, Loader2, User, Image as ImageIcon, ChevronDown, ChevronUp, Plus, UserPlus, Trash2, CalendarClock, CheckCircle2, RefreshCw, Star, Library } from 'lucide-react'
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

// Apply progress for a single set
interface ApplyState { status: 'idle' | 'applying' | 'done' | 'error'; done: number; total: number; error?: string }

// Apply a set's posters to a Plex target, routing each by season/episode.
async function applyPosters(
  targetKey: string,
  posters: PosterInfo[],
  enabled: Set<FileType>,
  onProgress: (done: number, total: number) => void,
): Promise<{ done: number; failed: number; total: number; appliedUrls: string[] }> {
  const list = posters.filter(p => enabled.has(posterFileType(p)))
  let done = 0, failed = 0
  const appliedUrls: string[] = []
  for (const p of list) {
    try {
      const res = await window.api.plex.uploadPoster(targetKey, p.url, p.source, p.season, p.episode) as { success: boolean }
      if (res.success) { done++; appliedUrls.push(p.url) } else failed++
    } catch { failed++ }
    onProgress(done, list.length)
  }
  return { done, failed, total: list.length, appliedUrls }
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

  const [selected, setSelected] = useState<LibraryItem | null>(null)

  const offsetRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  // -- Load sections (on mount + whenever the Plex connection becomes ready) ---
  // On boot the saved token marks us "authorized" before the server connection
  // finishes, so the first sections call can come back empty. Reload when the
  // post-connect auth event fires so the library populates without navigating.
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

  // -- Load items when section / search changes -------------------------------
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
    if (!activeKey) return
    offsetRef.current = 0
    const t = setTimeout(() => loadItems(activeKey, search, false), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [activeKey, search, loadItems])

  // -- Infinite scroll --------------------------------------------------------
  function onScroll() {
    const el = scrollRef.current
    if (!el || loading) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400 && items.length < total) {
      loadItems(activeKey, search, true)
    }
  }

  return (
    <>
      {/* -- Controls -------------------------------------------------------- */}
      <div className={styles.controls}>
        <div className={styles.sectionTabs}>
          {sections.map(s => (
            <button
              key={s.key}
              className={`${styles.sectionTab} ${activeKey === s.key ? styles.sectionTabActive : ''}`}
              onClick={() => { setActiveKey(s.key); setSelected(null) }}
            >
              {s.title}
              <span className={styles.sectionType}>{s.type === 'movie' ? 'Movies' : 'TV'}</span>
            </button>
          ))}
        </div>

        <div className={styles.searchBox}>
          <Search size={14} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Search this library…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            spellCheck={false}
          />
          {search && (
            <button className={styles.searchClear} onClick={() => setSearch('')}><X size={13} /></button>
          )}
        </div>
      </div>

      {/* -- Item grid ------------------------------------------------------- */}
      <div className={styles.gridScroll} ref={scrollRef} onScroll={onScroll}>
        {items.length === 0 && !loading ? (
          <div className={styles.emptyGrid}>
            <ImageIcon size={32} />
            <p>{search ? 'No matches in this library.' : 'This library is empty.'}</p>
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
        {loading && (
          <div className={styles.gridLoading}><Spinner size="sm" /> <span>Loading…</span></div>
        )}
        {!loading && items.length > 0 && (
          <div className={styles.gridCount}>{items.length} of {total}</div>
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
                ? 'Browse your Plex library and apply MediUX poster sets - filter by uploader.'
                : 'Follow MediUX creators and apply their newest art to matching titles in your library.'}
            </p>
          </div>
          <div className={styles.modeSwitch}>
            <button className={`${styles.modeBtn} ${mode === 'library' ? styles.modeBtnActive : ''}`} onClick={() => setMode('library')}>
              My Library
            </button>
            <button className={`${styles.modeBtn} ${mode === 'creators' ? styles.modeBtnActive : ''}`} onClick={() => setMode('creators')}>
              Creators
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
  const [err, setErr] = useState(false)
  return (
    <button className={`${styles.itemCard} ${active ? styles.itemCardActive : ''}`} onClick={onClick} title={item.title}>
      <div className={styles.itemPoster}>
        {!err && item.thumb ? (
          <img src={item.thumb} alt={item.title} loading="lazy" draggable={false} onError={() => setErr(true)} />
        ) : (
          <div className={styles.itemPosterFallback}>{item.title.charAt(0)}</div>
        )}
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
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>({ setIds: new Set(), titles: new Set(), posterUrls: new Set() })

  const subSet = useMemo(() => new Set(subs), [subs])
  const itemApplied = appliedIdx.titles.has(appliedKey(item.title, item.year))

  useEffect(() => { loadAppliedIndex().then(setAppliedIdx) }, [])

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
    setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: 0, total: s.posters.length } }))
    const { done, failed, total, appliedUrls } = await applyPosters(item.key, s.posters, types,
      (d, t) => setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: d, total: t } })))
    if (done) {
      void recordApplied({
        itemKey: item.key, title: item.title, year: item.year, type: item.type,
        source: 'mediux', thumb: item.thumb, setId: s.id, uploader: s.uploader,
        posterUrls: appliedUrls, appliedAt: new Date().toISOString(),
      })
      setAppliedIdx(prev => ({
        setIds: new Set(prev.setIds).add(s.id),
        titles: new Set(prev.titles).add(appliedKey(item.title, item.year)),
        posterUrls: new Set([...prev.posterUrls, ...appliedUrls]),
      }))
      // Optimistically update the library grid thumbnail to the applied main poster.
      const main = s.posters.find(p => p.season == null && p.episode == null)
      if (main) onItemPoster(item.key, main.thumbUrl ?? main.url)
    }
    setApplyMap(m => ({
      ...m,
      [s.id]: { status: failed && !done ? 'error' : 'done', done, total, error: failed ? `${failed} failed` : undefined },
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
          // "Applied" = this exact set; otherwise, if the title already has custom
          // art from another set/source, a lighter "Has art" marker.
          const badge = appliedIdx.setIds.has(s.id)
            ? <span className={styles.matchBadge}><CheckCircle2 size={11} /> Applied</span>
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
  const [err, setErr] = useState(false)
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
        <div className={styles.setPreview}>
          {!err && set.previewUrl ? (
            <img src={set.previewUrl} alt={set.setName} loading="lazy" draggable={false} onError={() => setErr(true)} />
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
                          <button
                            key={p.url}
                            className={styles.groupThumb}
                            title={`${p.episode != null ? `Episode ${p.episode}` : g.label} - click to enlarge`}
                            onClick={() => setLightbox(idx)}
                          >
                            <img src={p.thumbUrl ?? p.url} alt={g.label} loading="lazy" draggable={false} />
                            {p.episode != null && <span className={styles.epBadge}>E{p.episode}</span>}
                          </button>
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

// --- Creators view --------------------------------------------------------------

function normalizeUsername(input: string): string {
  const t = input.trim()
  // Accept a full profile URL or a bare username
  const m = t.match(/mediux\.pro\/user\/([^/?#]+)/i)
  return (m ? m[1] : t).replace(/^@/, '').trim()
}

function CreatorsView({ initialCreator }: { initialCreator: string | null }) {
  const [subs, setSubs]       = useState<string[]>([])
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>({ setIds: new Set(), titles: new Set(), posterUrls: new Set() })
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
            onApplied={(setId, title, year, urls) => setAppliedIdx(prev => ({
              setIds: new Set(prev.setIds).add(setId),
              titles: new Set(prev.titles).add(appliedKey(title, year)),
              posterUrls: new Set([...prev.posterUrls, ...urls]),
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
  onApplied: (setId: string, title: string, year: number | undefined, urls: string[]) => void
}) {
  const { navigate } = useAppContext()
  const [sets, setSets]       = useState<MediuxUserSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [applyMap, setApplyMap] = useState<Record<string, ApplyState>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scheduledMsg, setScheduledMsg] = useState<string | null>(null)

  // Which sets are already covered by a saved schedule (individually, or by a
  // whole-creator "/user/{name}/sets" sync job).
  const [scheduledSetIds, setScheduledSetIds] = useState<Set<string>>(new Set())
  const [creatorScheduled, setCreatorScheduled] = useState(false)

  const allTypes = useMemo(() => new Set<FileType>(ALL_TYPES), [])

  const load = useCallback(() => {
    setLoading(true); setError(null); setSelected(new Set())
    window.api.library.userSets({ username }).then((res: UserSetsRes) => {
      if (res.error) setError(res.error)
      setSets(res.sets)
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [username])

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

  useEffect(() => { load(); loadSchedule() }, [load, loadSchedule])

  // Sort: in-library matches first, then the rest (keeps newest order within each).
  const sortedSets = useMemo(
    () => [...sets].sort((a, b) => (a.matchedKey ? 0 : 1) - (b.matchedKey ? 0 : 1)),
    [sets],
  )

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAll       = () => setSelected(new Set(sets.map(s => s.id)))
  const selectInLibrary = () => setSelected(new Set(sets.filter(s => s.matchedKey).map(s => s.id)))
  const clearSelection  = () => setSelected(new Set())

  async function applySet(s: MediuxUserSet) {
    if (!s.matchedKey) return
    setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: 0, total: s.posters.length } }))
    const { done, failed, total, appliedUrls } = await applyPosters(s.matchedKey, s.posters, allTypes,
      (d, t) => setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: d, total: t } })))
    if (done) {
      void recordApplied({
        itemKey: s.matchedKey, title: s.title, year: s.year, type: s.matchedType ?? 'movie',
        source: 'mediux', thumb: s.previewUrl, setId: s.id, uploader: s.uploader,
        posterUrls: appliedUrls, appliedAt: new Date().toISOString(),
      })
      onApplied(s.id, s.title, s.year, appliedUrls)
    }
    setApplyMap(m => ({
      ...m,
      [s.id]: { status: failed && !done ? 'error' : 'done', done, total, error: failed ? `${failed} failed` : undefined },
    }))
  }

  async function scheduleWeekly() {
    // Selected sets → sync just those; otherwise sync the creator's newest uploads.
    const useSelection = selected.size > 0
    const urls = useSelection
      ? sets.filter(s => selected.has(s.id)).map(s => `https://mediux.pro/sets/${s.id}`)
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

  const matchCount = sets.filter(s => s.matchedKey).length

  return (
    <div className={styles.creatorSets}>
      <div className={styles.creatorBar}>
        <div className={styles.creatorBarInfo}>
          <span className={styles.creatorBarName}>{username}</span>
          {!loading && !error && (
            <span className={styles.creatorBarMeta}>{sets.length} recent · {matchCount} in your library</span>
          )}
        </div>
        <div className={styles.creatorBarActions}>
          {following ? (
            <Button variant="secondary" size="sm" icon={<Star size={12} />} onClick={onUnfollow}>Following</Button>
          ) : (
            <Button variant="primary" size="sm" icon={<UserPlus size={12} />} onClick={onFollow}>Follow</Button>
          )}
          <Button variant="ghost" size="sm" icon={<RefreshCw size={12} />} onClick={load} disabled={loading}>Refresh</Button>
          {following && (
            <Button
              variant="primary"
              size="sm"
              icon={<CalendarClock size={12} />}
              onClick={scheduleWeekly}
            >
              {selected.size > 0 ? `Sync ${selected.size} weekly` : 'Sync all weekly'}
            </Button>
          )}
        </div>
      </div>

      {/* Selection toolbar */}
      {following && !loading && !error && sets.length > 0 && (
        <div className={styles.selectBar}>
          <span className={styles.selectCount}>
            {selected.size > 0 ? `${selected.size} of ${sets.length} selected` : 'Pick sets to sync, or sync all'}
          </span>
          <div className={styles.selectActions}>
            <button className={styles.selectBtn} onClick={selectAll}>Select all</button>
            <button className={styles.selectBtn} onClick={selectInLibrary} disabled={!matchCount}>In library ({matchCount})</button>
            <button className={styles.selectBtn} onClick={clearSelection} disabled={!selected.size}>Clear</button>
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
        {loading && <div className={styles.panelLoading}><Spinner size="sm" /> <span>Loading {username}'s sets…</span></div>}
        {error && <div className={styles.panelNotice}><AlertCircle size={20} /><p>{error}</p></div>}
        {!loading && !error && sets.length === 0 && (
          <div className={styles.panelNotice}><ImageIcon size={20} /><p>No sets found for this creator.</p></div>
        )}

        {sortedSets.map(s => {
          const exactApplied = appliedIdx.setIds.has(s.id)
          const titleApplied = appliedIdx.titles.has(appliedKey(s.title, s.year))
          const isScheduled  = creatorScheduled || scheduledSetIds.has(s.id)
          const matchBadge = s.matchedKey
            ? exactApplied
              ? <span className={styles.matchBadge}><CheckCircle2 size={11} /> Applied</span>
              : titleApplied
                ? <span className={styles.scheduledBadge}><Library size={11} /> Has art</span>
                : <span className={styles.matchBadge}><Check size={11} /> In library</span>
            : <span className={styles.noMatchBadge}>Not in library</span>
          const badge = (
            <span className={styles.badgeRow}>
              {matchBadge}
              {isScheduled && <span className={styles.scheduledBadge}><CalendarClock size={11} /> Scheduled</span>}
            </span>
          )
          return (
            <SetCard
              key={s.id}
              set={s}
              apply={applyMap[s.id]}
              onApply={() => applySet(s)}
              enabledTypes={allTypes}
              title={s.year ? `${s.title} (${s.year})` : s.title}
              badge={badge}
              disabled={!s.matchedKey}
              selectable={following}
              checked={selected.has(s.id)}
              onToggleSelect={() => toggleSelect(s.id)}
            />
          )
        })}
      </div>
    </div>
  )
}
