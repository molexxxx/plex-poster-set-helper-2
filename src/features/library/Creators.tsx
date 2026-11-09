import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  AlertCircle, CalendarClock, Check, CheckCircle2, ExternalLink, Eye, EyeOff, History,
  Image as ImageIcon, ListChecks, Loader2, Plus, RefreshCw, Search, Star, Upload, User, UserPlus, X,
} from 'lucide-react'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Lightbox, { type LightboxImage } from '../../components/ui/Lightbox'
import Menu from '../../components/ui/Menu'
import Pager from '../../components/ui/Pager'
import Segmented from '../../components/ui/Segmented'
import type { CreatorCrawlStatus, MediuxUserSet, PosterInfo, ScheduledJob, UserSetsChunk, UserSetsSnapshot } from '../../../electron/ipc/types'
import {
  ALL_TYPES, SOURCE_LABEL, collectionName, groupPosters, posterFileType, posterPageUrl, resolveVariants, setKey, type FileType,
} from '../../utils/posterGroups'
import { useCreatorPrefs, parseCreatorInput, type CreatorState } from '../../utils/creatorPrefs'
import { recordApplied, recordAppliedQuietly, appliedKey, loadAppliedIndex, type AppliedIndex } from '../../utils/appliedTracker'
import { errorMessage } from '../../utils/errorMessage'
import { DEFAULT_QUICK_CRON, coveringJob, describeCron, scheduleCoverage, type ScheduleCoverage } from '../../../electron/services/scheduleUtils'
import { useAppContext } from '../../app/AppContext'
import { useNavStore } from '../../app/navStore'
import { useSmoothScroll } from '../../app/useSmoothScroll'
import { ThumbButton, applyError, applyPosters, creatorUrl, timeAgo, type ApplyState } from './libraryShared'
import CreatorSyncDialog, { type SyncScope } from './CreatorSyncDialog'
import libraryStyles from './LibraryPage.module.css'
import styles from './Creators.module.css'

type Tab = 'sets' | 'posters' | 'backdrops' | 'titlecards'
type LibraryFilter = 'library' | 'missing' | 'all'

interface CachedCatalog { rev: number; sets: MediuxUserSet[]; capped: boolean; fetchedAt: number; status: CreatorCrawlStatus }
interface ViewState { tab: Tab; page: number; query: string; filter: LibraryFilter }
interface TitleGroup { key: string; title: string; year?: number; matchedKey?: string; sets: MediuxUserSet[] }

/** Catalogs this window already holds: a revisit paints from here, then asks only whether anything changed. */
const catalogCache = new Map<string, CachedCatalog>()
const CATALOG_CACHE_LIMIT = 8
/** Where the user was in each creator's catalog, kept while they visit other pages. */
const viewStates = new Map<string, ViewState>()
let lastCreator: string | null = null

const GROUPS_PER_PAGE = 30
/** Poster tiles: minimum width and column gap, shared with the CSS grid so the detail shelf lands after the right row. */
const TILE_MIN = 150
const TILE_GAP = 16
const FILES_PER_PAGE = 60
const TAB_TYPE: Record<Exclude<Tab, 'sets'>, FileType> = { posters: 'poster', backdrops: 'backdrop', titlecards: 'title_card' }
const EMPTY_INDEX: AppliedIndex = { setKeys: new Set(), titles: new Set(), posterUrls: new Set(), currentByItem: new Map(), currentPosterUrls: new Set() }

const count = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`

function rememberCatalog(key: string, entry: CachedCatalog): void {
  catalogCache.delete(key)
  catalogCache.set(key, entry)
  while (catalogCache.size > CATALOG_CACHE_LIMIT) {
    const oldest = catalogCache.keys().next().value
    if (oldest === undefined) break
    catalogCache.delete(oldest)
  }
}

function titleKey(s: MediuxUserSet): string {
  return s.matchedKey ? `k:${s.matchedKey}` : `t:${s.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${s.year ?? ''}`
}

/** Groups sets by the title they are for, keeping the catalog's order. */
function groupByTitle(sets: MediuxUserSet[]): TitleGroup[] {
  const groups = new Map<string, TitleGroup>()
  for (const s of sets) {
    const key = titleKey(s)
    const group = groups.get(key)
    if (group) group.sets.push(s)
    else groups.set(key, { key, title: s.title, year: s.year, matchedKey: s.matchedKey, sets: [s] })
  }
  return [...groups.values()]
}

/**
 * How many columns an auto-fill grid currently shows, so a full-width panel
 * can be placed after the row that holds a given tile.
 *
 * @param min - The grid's minimum column width.
 * @param gap - The grid's column gap.
 * @returns The column count and a ref callback for the grid element.
 */
function useColumns(min: number, gap: number): [number, (el: HTMLElement | null) => void] {
  const [columns, setColumns] = useState(1)
  const observer = useRef<ResizeObserver | null>(null)
  const attach = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    const measure = (width: number) => setColumns(Math.max(1, Math.floor((width + gap) / (min + gap))))
    measure(el.clientWidth)
    observer.current = new ResizeObserver(entries => measure(entries[0].contentRect.width))
    observer.current.observe(el)
  }, [min, gap])
  return [columns, attach]
}

function appendNew(prev: MediuxUserSet[], incoming: MediuxUserSet[]): MediuxUserSet[] {
  if (!incoming.length) return prev
  const seen = new Set(prev.map(s => s.id))
  const fresh = incoming.filter(s => !seen.has(s.id))
  return fresh.length ? [...prev, ...fresh] : prev
}

function shortTypeCounts(s: MediuxUserSet): string {
  const parts: string[] = []
  if (s.posterCount) parts.push(plural(s.posterCount, 'poster'))
  if (s.titleCardCount) parts.push(plural(s.titleCardCount, 'title card'))
  if (s.backdropCount) parts.push(plural(s.backdropCount, 'backdrop'))
  return parts.join(' · ') || 'No files'
}

/**
 * A creator's catalog, painted from this window's cache when it has one and
 * kept current from the main process: the first call sends the revision it
 * holds, so an unchanged catalog costs no transfer, and later changes arrive
 * as deltas.
 */
function useCreatorCatalog(username: string) {
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

  const applySnapshot = useCallback((snap: UserSetsSnapshot) => {
    if (!snap.unchanged) {
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

  useEffect(() => {
    let cancelled = false
    const off = window.api.library.onUserSetsChunk((chunk: UserSetsChunk) => {
      if (cancelled || chunk.username.toLowerCase() !== key) return
      if (chunk.reset) setSets(chunk.sets)
      else if (chunk.upsert) {
        const ids = new Set(chunk.sets.map(s => s.id))
        setSets(prev => [...chunk.sets, ...prev.filter(s => !ids.has(s.id))])
      } else if (chunk.sets.length) setSets(prev => appendNew(prev, chunk.sets))
      setRev(chunk.rev)
      setStatus(chunk.status)
      setCapped(chunk.capped)
      if (chunk.fetchedAt) setFetchedAt(chunk.fetchedAt)
      if (chunk.sets.length || chunk.done) setReady(true)
      if (chunk.done) { setChecking(false); setRereading(false) }
      if (chunk.error) {
        if (chunk.collected) setNotice(chunk.error)
        else setError(chunk.error)
      }
    })
    window.api.library.startUserSets({ username, rev: revRef.current || undefined })
      .then(snap => { if (!cancelled) applySnapshot(snap) })
      .catch(err => { if (!cancelled) { setReady(true); if (!countRef.current) setError(errorMessage(err)) } })
    return () => { cancelled = true; off() }
  }, [username, key, applySnapshot])

  useEffect(() => {
    if (ready && sets.length) rememberCatalog(key, { rev, sets, capped, fetchedAt, status })
  }, [key, ready, rev, sets, capped, fetchedAt, status])

  const check = useCallback(() => {
    setNotice(null)
    setError(null)
    setChecking(true)
    window.api.library.refreshUserSets({ username, rev: revRef.current || undefined })
      .then(applySnapshot)
      .catch(err => { setChecking(false); setNotice(`Could not check for new sets: ${errorMessage(err)}`) })
  }, [username, applySnapshot])

  const reread = useCallback(() => {
    setNotice(null)
    setRereading(true)
    window.api.library.rereadUserSets({ username, rev: revRef.current || undefined })
      .then(applySnapshot)
      .catch(err => { setRereading(false); setNotice(`Could not re-read the catalog: ${errorMessage(err)}`) })
  }, [username, applySnapshot])

  return { sets, status, capped, fetchedAt, ready, checking, rereading, error, notice, dismissNotice: () => setNotice(null), check, reread }
}

/** The Creators view: followed creators beside the selected creator's catalog. */
export default function CreatorsView({ initialCreator }: { initialCreator: string | null }) {
  const { prefs, stateOf, setState } = useCreatorPrefs()
  const follows = prefs.mediuxFollows
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>(EMPTY_INDEX)
  const [picked, setPicked]   = useState<string | null>(initialCreator ?? lastCreator)
  const [adding, setAdding]   = useState('')
  const [prefsError, setPrefsError] = useState<string | null>(null)
  const [jobs, setJobs]       = useState<ScheduledJob[]>([])
  const [quickCron, setQuickCron] = useState(DEFAULT_QUICK_CRON)
  const [allTypes, setAllTypes] = useState<Set<FileType>>(new Set(ALL_TYPES))
  const coverage = useMemo(() => scheduleCoverage(jobs), [jobs])
  const railRef = useRef<HTMLDivElement>(null)
  const inputId = useId()
  const followingId = useId()
  const hiddenId = useId()

  const hiddenMediux = prefs.hidden.filter(h => h.source === 'mediux').map(h => h.username)
  const hiddenPosterdb = prefs.hidden.filter(h => h.source === 'posterdb').map(h => h.username)
  const browsable = [...follows, ...hiddenMediux]
  const active = picked ?? follows[0] ?? null

  useEffect(() => { void loadAppliedIndex().then(setAppliedIdx) }, [])
  useEffect(() => { if (initialCreator) setPicked(initialCreator) }, [initialCreator])
  useEffect(() => { lastCreator = active }, [active])
  useEffect(() => {
    window.api.config.get().then(c => {
      if (c.mediuxFilters?.length) setAllTypes(new Set(c.mediuxFilters as FileType[]))
      setQuickCron(c.schedulerQuickCron || DEFAULT_QUICK_CRON)
    }).catch(() => { /* keep the defaults */ })
    window.api.scheduler.list().then(setJobs).catch(() => { /* scheduler unavailable */ })
    return window.api.scheduler.onChange(setJobs)
  }, [])

  const isActive = (name: string) => active?.toLowerCase() === name.toLowerCase()

  function savePrefs(run: Promise<unknown>) {
    setPrefsError(null)
    run.catch((err: unknown) => setPrefsError(errorMessage(err)))
  }

  async function addCreator() {
    const parsed = parseCreatorInput(adding)
    if (!parsed) {
      setPrefsError('Enter a username or a MediUX or ThePosterDB profile link.')
      return
    }
    setPrefsError(null)
    try {
      if (stateOf(parsed.source, parsed.name) !== 'followed') await setState(parsed.source, parsed.name, 'followed')
      if (parsed.source === 'mediux') setPicked(parsed.name)
      setAdding('')
    } catch (err) {
      setPrefsError(errorMessage(err))
    }
  }

  function onRailKey(e: React.KeyboardEvent) {
    if (!browsable.length) return
    const i = Math.max(0, browsable.findIndex(isActive))
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, browsable.length - 1)
      : e.key === 'ArrowUp' ? Math.max(i - 1, 0)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? browsable.length - 1
      : -1
    if (next < 0) return
    e.preventDefault()
    setPicked(browsable[next])
    railRef.current?.querySelector<HTMLElement>(`[data-creator="${CSS.escape(browsable[next].toLowerCase())}"]`)?.focus()
  }

  function railOption(name: string, hidden: boolean) {
    const selected = isActive(name)
    const known = catalogCache.get(name.toLowerCase())
    const synced = coverage.creators.has(name.toLowerCase())
    const sub = [known ? plural(known.sets.length, 'set') : '', synced ? 'Synced' : ''].filter(Boolean).join(' · ')
    return (
      <div
        key={`${hidden ? 'hidden' : 'follow'}:${name}`}
        role="option"
        aria-selected={selected}
        tabIndex={selected || (!active && name === browsable[0]) ? 0 : -1}
        data-creator={name.toLowerCase()}
        className={`${styles.railItem} ${selected ? styles.railItemActive : ''}`}
        onClick={() => setPicked(name)}
      >
        {hidden ? <EyeOff size={13} className={styles.railIcon} aria-hidden /> : <Star size={13} className={styles.railIconFollowed} aria-hidden />}
        <span className={styles.railText}>
          <span className={styles.railName}>{name}</span>
          {sub && <span className={styles.railSub}>{sub}</span>}
        </span>
        {synced && <CalendarClock size={13} className={styles.railSynced} aria-hidden />}
      </div>
    )
  }

  return (
    <div className={styles.creators}>
      <aside className={styles.rail} aria-label="Creators">
        <div ref={railRef} className={styles.railScroll}>
          {browsable.length > 0 && (
            <div role="listbox" aria-label="MediUX creators" className={styles.railList} onKeyDown={onRailKey}>
              {follows.length > 0 && (
                <div role="group" aria-labelledby={followingId}>
                  <h2 id={followingId} className={styles.railHeading}>Following</h2>
                  {follows.map(name => railOption(name, false))}
                </div>
              )}
              {hiddenMediux.length > 0 && (
                <div role="group" aria-labelledby={hiddenId}>
                  <h2 id={hiddenId} className={styles.railHeading}>Hidden</h2>
                  {hiddenMediux.map(name => railOption(name, true))}
                </div>
              )}
            </div>
          )}

          {(prefs.posterdbFollows.length > 0 || hiddenPosterdb.length > 0) && (
            <section className={styles.railList} aria-label="ThePosterDB creators">
              <h2 className={styles.railHeading}>On ThePosterDB</h2>
              <p className={styles.railNote}>These open on ThePosterDB; only MediUX catalogs are browsed here.</p>
              {[...prefs.posterdbFollows.map(name => ({ name, hidden: false })), ...hiddenPosterdb.map(name => ({ name, hidden: true }))].map(({ name, hidden }) => (
                <div key={`posterdb:${name}`} className={styles.railExternal}>
                  <button type="button" className={styles.railExternalOpen} onClick={() => window.api.app.openExternal(creatorUrl('posterdb', name))}>
                    {hidden ? <EyeOff size={13} className={styles.railIcon} aria-hidden /> : <Star size={13} className={styles.railIconFollowed} aria-hidden />}
                    <span className={styles.railName}>{name}</span>
                    <ExternalLink size={12} className={styles.railIcon} aria-hidden />
                    <span className={styles.srOnly}>(opens ThePosterDB)</span>
                  </button>
                  <button
                    type="button"
                    className={styles.railRemove}
                    onClick={() => savePrefs(setState('posterdb', name, 'none'))}
                    aria-label={hidden ? `Unhide ${name}` : `Unfollow ${name}`}
                    title={hidden ? 'Unhide' : 'Unfollow'}
                  >
                    {hidden ? <Eye size={13} /> : <X size={13} />}
                  </button>
                </div>
              ))}
            </section>
          )}

          {!browsable.length && !prefs.posterdbFollows.length && (
            <p className={styles.railEmpty}>You are not following anyone yet.</p>
          )}
        </div>

        <div className={styles.follow}>
          <label htmlFor={inputId} className={styles.followLabel}>Follow a creator</label>
          <div className={styles.followField}>
            <UserPlus size={14} className={styles.followIcon} aria-hidden />
            <input
              id={inputId}
              className={styles.followInput}
              placeholder="Username or profile link"
              value={adding}
              onChange={e => setAdding(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void addCreator() }}
              spellCheck={false}
            />
            <button type="button" className={styles.followAdd} onClick={() => void addCreator()} disabled={!adding.trim()} aria-label="Follow" title="Follow">
              <Plus size={14} />
            </button>
          </div>
          {prefsError && <p className={styles.followError} role="alert">{prefsError}</p>}
        </div>
      </aside>

      <section className={styles.main} aria-label={active ? `@${active}` : 'Creator'}>
        {active ? (
          <CreatorCatalog
            key={active.toLowerCase()}
            username={active}
            creator={stateOf('mediux', active)}
            appliedIdx={appliedIdx}
            jobs={jobs}
            coverage={coverage}
            quickCron={quickCron}
            allTypes={allTypes}
            onCreatorChange={state => {
              setPicked(active)
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
          <div className={styles.emptyMain}>
            <h2 className={styles.emptyTitle}>Follow a creator to browse their catalog</h2>
            <p className={styles.emptyText}>
              Enter a MediUX username or profile link, such as <code>aloha_alona</code>. Their whole catalog appears here,
              matched against your library, and you can apply sets or keep them in sync. ThePosterDB creators open on their own site.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

interface CatalogProps {
  username: string
  creator: CreatorState
  appliedIdx: AppliedIndex
  jobs: ScheduledJob[]
  coverage: ScheduleCoverage
  quickCron: string
  allTypes: Set<FileType>
  onCreatorChange: (state: CreatorState) => void
  onApplied: (sKey: string, itemKey: string, title: string, year: number | undefined, urls: string[]) => void
}

/** One creator's catalog: a header with status and sync, then titles with their variant sets, or single files. */
function CreatorCatalog({ username, creator, appliedIdx, jobs, coverage, quickCron, allTypes, onCreatorChange, onApplied }: CatalogProps) {
  const key = username.toLowerCase()
  const catalog = useCreatorCatalog(username)
  const { navigate } = useAppContext()
  const goScheduler = useNavStore(s => s.goScheduler)
  const [initialView] = useState<ViewState>(() => viewStates.get(key) ?? { tab: 'sets', page: 0, query: '', filter: 'library' })
  const [tab, setTab]       = useState<Tab>(initialView.tab)
  const [page, setPage]     = useState(initialView.page)
  const [query, setQuery]   = useState(initialView.query)
  const [filter, setFilter] = useState<LibraryFilter>(initialView.filter)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [applyMap, setApplyMap]   = useState<Record<string, ApplyState>>({})
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [picks, setPicks]         = useState<Record<string, string>>({})
  const [fileLightbox, setFileLightbox] = useState<number | null>(null)
  const [syncScope, setSyncScope] = useState<SyncScope | null>(null)
  const [tip, setTip]             = useState<{ message: string; jobId: string } | null>(null)
  const [confirmReread, setConfirmReread] = useState(false)
  const [searchResults, setSearchResults] = useState<MediuxUserSet[]>([])
  const [searching, setSearching] = useState(false)
  const [, setTick] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const [columns, attachShelf] = useColumns(TILE_MIN, TILE_GAP)
  useSmoothScroll(listRef)

  const following = creator === 'followed'
  const creatorJob = coverage.creators.get(key)
  const crawling = catalog.status === 'crawling'
  const partial = catalog.capped || crawling

  useEffect(() => { viewStates.set(key, { tab, page, query, filter }) }, [key, tab, page, query, filter])

  useEffect(() => {
    if (!catalog.fetchedAt) return
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [catalog.fetchedAt])

  const q = query.trim().toLowerCase()
  useEffect(() => {
    if (!partial || q.length < 2) return
    let cancelled = false
    const t = setTimeout(() => {
      setSearching(true)
      window.api.library.creatorSearch({ username, query: q })
        .then(res => { if (!cancelled) setSearchResults(res.sets) })
        .catch(() => { if (!cancelled) setSearchResults([]) })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 550)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, partial, username])

  const merged = useMemo(() => {
    if (!partial || q.length < 2 || !searchResults.length) return catalog.sets
    const ids = new Set(catalog.sets.map(s => s.id))
    return [...searchResults.filter(s => !ids.has(s.id)), ...catalog.sets]
  }, [catalog.sets, searchResults, partial, q])

  const queried = useMemo(
    () => (q ? merged.filter(s => s.title.toLowerCase().includes(q) || s.setName.toLowerCase().includes(q)) : merged),
    [merged, q],
  )
  const libraryCount = useMemo(() => queried.filter(s => s.matchedKey).length, [queried])
  const visible = useMemo(() => {
    if (filter === 'all') return crawling ? queried : [...queried].sort((a, b) => (a.matchedKey ? 0 : 1) - (b.matchedKey ? 0 : 1))
    return queried.filter(s => (filter === 'library' ? !!s.matchedKey : !s.matchedKey))
  }, [queried, filter, crawling])
  const groups = useMemo(() => groupByTitle(visible), [visible])
  const files = useMemo(() => {
    if (tab === 'sets') return []
    const type = TAB_TYPE[tab]
    return visible.flatMap(set => set.posters.filter(p => posterFileType(p) === type).map(poster => ({ set, poster })))
  }, [visible, tab])
  const tabCounts = useMemo(() => {
    let posters = 0, backdrops = 0, titlecards = 0
    for (const s of visible) for (const p of s.posters) {
      const t = posterFileType(p)
      if (t === 'poster') posters++
      else if (t === 'backdrop') backdrops++
      else if (t === 'title_card') titlecards++
    }
    return { sets: visible.length, posters, backdrops, titlecards }
  }, [visible])

  const totalSets = catalog.sets.length
  const totalInLibrary = useMemo(() => catalog.sets.filter(s => s.matchedKey).length, [catalog.sets])
  const matchedTitles = useMemo(() => new Set(catalog.sets.filter(s => s.matchedKey).map(s => s.matchedKey)).size, [catalog.sets])
  const avatar = catalog.sets.find(s => s.uploaderAvatar)?.uploaderAvatar

  const perPage = tab === 'sets' ? GROUPS_PER_PAGE : FILES_PER_PAGE
  const total = tab === 'sets' ? groups.length : files.length
  const pageCount = Math.max(1, Math.ceil(total / perPage))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * perPage
  const pageGroups = groups.slice(pageStart, pageStart + perPage)
  const pageFiles = files.slice(pageStart, pageStart + perPage)

  const goPage = (p: number) => { setPage(p); setOpenGroup(null); listRef.current?.scrollTo({ top: 0 }) }
  const changeTab = (t: Tab) => { setTab(t); setPage(0); setOpenGroup(null); if (t !== 'sets') setSelecting(false) }
  const pickedSet = (group: TitleGroup) => group.sets.find(s => s.id === picks[group.key]) ?? group.sets[0]
  const openIndex = openGroup ? pageGroups.findIndex(g => g.key === openGroup) : -1
  const detailAfter = openIndex < 0 ? -1 : Math.min(pageGroups.length - 1, Math.floor(openIndex / columns) * columns + columns - 1)

  function toggleGroup(groupKey: string) {
    setOpenGroup(cur => (cur === groupKey ? null : groupKey))
  }
  const changeFilter = (f: LibraryFilter) => { setFilter(f); setPage(0) }
  const changeQuery = (v: string) => {
    setQuery(v)
    setPage(0)
    if (v.trim().length < 2) { setSearchResults([]); setSearching(false) }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const pageSelectable = pageGroups.flatMap(g => g.sets).filter(s => s.matchedKey)
  const selectedSets = catalog.sets.filter(s => selected.has(s.id))

  async function applySet(s: MediuxUserSet) {
    if (!s.matchedKey && !s.posters.some(p => p.isCollection)) return
    const collectionArt = resolveVariants(s.posters.filter(p => p.isCollection), 'title')
    const mainPosters   = resolveVariants(s.posters.filter(p => !p.isCollectionMember && !p.isCollection), 'title')
    const memberPosters = resolveVariants(s.posters.filter(p => p.isCollectionMember), 'title')
    const enabledTotal  = [...collectionArt, ...mainPosters, ...memberPosters].filter(p => allTypes.has(posterFileType(p))).length
    setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: 0, total: enabledTotal } }))

    let totalDone = 0, totalFailed = 0
    const allAppliedUrls: string[] = []
    const allAppliedSlots: string[] = []
    const progress = (d: number) => setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: totalDone + d, total: enabledTotal } }))

    if (s.matchedKey) {
      const res = await applyPosters(s.matchedKey, mainPosters, allTypes, progress)
      totalDone += res.done
      totalFailed += res.failed
      allAppliedUrls.push(...res.appliedUrls)
      allAppliedSlots.push(...res.appliedSlots)
    } else if (mainPosters.length > 0) {
      totalFailed += mainPosters.filter(p => allTypes.has(posterFileType(p))).length
    }

    const byCollection = new Map<string, PosterInfo[]>()
    for (const p of collectionArt) {
      const name = collectionName(p.title)
      const list = byCollection.get(name)
      if (list) list.push(p)
      else byCollection.set(name, [p])
    }
    for (const posters of byCollection.values()) {
      const coll = await window.api.plex.findCollection(posters[0].title) as { key: string; title: string } | null
      if (!coll) {
        totalFailed += posters.filter(p => allTypes.has(posterFileType(p))).length
        continue
      }
      const res = await applyPosters(coll.key, posters, allTypes, progress)
      totalDone += res.done
      totalFailed += res.failed
      allAppliedUrls.push(...res.appliedUrls)
      allAppliedSlots.push(...res.appliedSlots)
      if (res.done > 0) {
        void recordAppliedQuietly({
          itemKey: coll.key, title: coll.title, type: 'collection', source: 'mediux', thumb: posters[0].thumbUrl ?? posters[0].url,
          setId: s.id, uploader: s.uploader, posterUrls: res.appliedUrls, slots: res.appliedSlots, appliedAt: new Date().toISOString(),
        })
      }
    }

    if (memberPosters.length > 0) {
      const movies = new Map<string, { title: string; year?: number; posters: PosterInfo[] }>()
      for (const p of memberPosters) {
        const k = `${p.title.toLowerCase()}|${p.year ?? ''}`
        const found = movies.get(k)
        if (found) found.posters.push(p)
        else movies.set(k, { title: p.title, year: p.year, posters: [p] })
      }
      for (const m of movies.values()) {
        const found = await window.api.plex.findItem(m.title, m.year) as { key: string; title: string; year?: number; type: string; thumb?: string } | null
        if (!found) {
          totalFailed += m.posters.filter(p => allTypes.has(posterFileType(p))).length
          continue
        }
        const res = await applyPosters(found.key, m.posters, allTypes, progress)
        totalDone += res.done
        totalFailed += res.failed
        allAppliedUrls.push(...res.appliedUrls)
        allAppliedSlots.push(...res.appliedSlots)
        if (res.done > 0) {
          void recordAppliedQuietly({
            itemKey: found.key, title: found.title, year: found.year, type: found.type === 'movie' ? 'movie' : 'show', source: 'mediux',
            thumb: found.thumb, setId: s.id, uploader: s.uploader, posterUrls: res.appliedUrls, slots: res.appliedSlots, appliedAt: new Date().toISOString(),
          })
        }
      }
    }

    let historyError: string | undefined
    if (totalDone > 0 && s.matchedKey) {
      historyError = await recordApplied({
        itemKey: s.matchedKey, title: s.title, year: s.year, type: s.matchedType ?? 'movie', source: 'mediux', thumb: s.previewUrl,
        setId: s.id, uploader: s.uploader, posterUrls: allAppliedUrls, slots: allAppliedSlots, appliedAt: new Date().toISOString(),
      }).then(() => undefined, (err: unknown) => errorMessage(err))
      onApplied(setKey(s), s.matchedKey, s.title, s.year, allAppliedUrls)
    }
    setApplyMap(m => ({
      ...m,
      [s.id]: { status: totalFailed && !totalDone ? 'error' : 'done', done: totalDone, total: enabledTotal, error: applyError(totalFailed, historyError) },
    }))
  }

  async function applySingle(s: MediuxUserSet, file: PosterInfo) {
    const k = `${s.id}:${file.url}`
    setApplyMap(m => ({ ...m, [k]: { status: 'applying', done: 0, total: 1 } }))
    let target: { key: string; title: string; year?: number; type: 'movie' | 'show' | 'collection' } | null = null
    if (file.isCollection) {
      const coll = await window.api.plex.findCollection(file.title) as { key: string; title: string } | null
      if (coll) target = { key: coll.key, title: coll.title, type: 'collection' }
    } else if (s.matchedKey) {
      target = { key: s.matchedKey, title: s.title, year: s.year, type: s.matchedType ?? 'movie' }
    }
    if (!target) {
      setApplyMap(m => ({ ...m, [k]: { status: 'error', done: 0, total: 1, error: file.isCollection ? 'No matching Plex collection' : 'Not in your library' } }))
      return
    }
    const { done, appliedUrls, appliedSlots, lastError } = await applyPosters(target.key, [file], allTypes, () => {})
    if (done) {
      void recordAppliedQuietly({
        itemKey: target.key, title: target.title, year: target.year, type: target.type, source: 'mediux', thumb: file.thumbUrl ?? file.url,
        setId: s.id, uploader: s.uploader, posterUrls: appliedUrls, slots: appliedSlots, appliedAt: new Date().toISOString(),
      })
      if (target.type !== 'collection') onApplied(setKey(s), target.key, s.title, s.year, appliedUrls)
    }
    setApplyMap(m => ({ ...m, [k]: { status: done ? 'done' : 'error', done, total: 1, error: lastError } }))
  }

  function openJob() {
    if (tip?.jobId) goScheduler(tip.jobId)
    navigate('scheduler')
  }

  const fileLightboxImages = useMemo<LightboxImage[]>(
    () => pageFiles.map(({ set, poster }) => ({
      url: poster.url,
      label: set.year ? `${set.title} (${set.year})` : set.title,
      caption: fileCaption(poster),
    })),
    [pageFiles],
  )

  const statusLine = !catalog.ready
    ? 'Reading their catalog from MediUX…'
    : catalog.error && !totalSets
      ? 'Could not read their catalog'
      : `${plural(totalSets, 'set')} · ${count(totalInLibrary)} in your library${crawling ? ' · still reading the catalog' : catalog.capped ? ` · the newest ${count(totalSets)} (MediUX's browse limit)` : ''}`
  const syncLine = creatorJob
    ? `Synced ${describeCron(creatorJob.cronExpr).toLowerCase()}${creatorJob.since ? `, new uploads since ${new Date(creatorJob.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}${creatorJob.enabled ? '' : ' (paused)'}`
    : 'Not synced'

  const menuItems = [
    { label: catalog.checking ? 'Checking for new sets…' : 'Check for new sets', icon: <RefreshCw size={14} />, disabled: catalog.checking || catalog.rereading || crawling, onSelect: catalog.check },
    { label: 'Re-read the whole catalog…', icon: <History size={14} />, disabled: catalog.rereading || crawling, onSelect: () => setConfirmReread(true) },
    { label: 'Open on MediUX', icon: <ExternalLink size={14} />, onSelect: () => window.api.app.openExternal(creatorUrl('mediux', username)) },
    creator === 'hidden'
      ? { label: 'Unhide creator', icon: <Eye size={14} />, onSelect: () => onCreatorChange('none') }
      : { label: 'Hide creator', icon: <EyeOff size={14} />, onSelect: () => onCreatorChange('hidden') },
  ]

  const emptyText = !catalog.ready ? '' : q
    ? searching ? 'Searching their full catalog…' : `No ${filter === 'library' ? 'titles in your library' : filter === 'missing' ? 'titles outside your library' : 'titles'} match "${query.trim()}".`
    : filter === 'library'
      ? crawling ? 'No library matches yet. The catalog is still being read.' : `None of @${username}'s sets match titles in your library.`
      : filter === 'missing' ? 'Every set matches a title in your library.' : `@${username} has no sets on MediUX yet.`

  return (
    <div className={styles.catalog} aria-labelledby={titleId}>
      <header className={styles.head}>
        <div className={styles.identity}>
          {avatar ? <img className={styles.avatar} src={avatar} alt="" /> : <span className={styles.avatarFallback} aria-hidden><User size={18} /></span>}
          <div className={styles.identityText}>
            <h2 id={titleId} className={styles.name}>@{username}</h2>
            <p className={styles.status}>{statusLine}</p>
            <p className={styles.meta}>
              <span>{syncLine}</span>
              <span aria-hidden>·</span>
              {catalog.rereading
                ? <span className={styles.working}><Loader2 size={12} className={styles.spin} aria-hidden /> Re-reading the whole catalog; these sets stay in use until it finishes</span>
                : catalog.checking
                  ? <span className={styles.working}><Loader2 size={12} className={styles.spin} aria-hidden /> Checking for new sets</span>
                  : catalog.fetchedAt
                    ? <span>Checked {timeAgo(catalog.fetchedAt)} <button type="button" className={styles.inlineAction} onClick={catalog.check} disabled={crawling}>Check now</button></span>
                    : <span>{crawling ? 'First read in progress' : 'Not checked yet'}</span>}
            </p>
          </div>
        </div>
        <div className={styles.headActions}>
          <Button
            variant={following ? 'secondary' : 'primary'}
            size="sm"
            icon={following ? <Star size={12} fill="currentColor" /> : <UserPlus size={12} />}
            aria-pressed={following}
            onClick={() => onCreatorChange(following ? 'none' : 'followed')}
            title={following ? `Unfollow @${username}` : `Follow @${username}`}
          >
            {following ? 'Following' : 'Follow'}
          </Button>
          <Button
            variant={creatorJob ? 'secondary' : 'primary'}
            size="sm"
            icon={<CalendarClock size={12} />}
            onClick={() => setSyncScope({ kind: 'creator' })}
            disabled={!catalog.ready || (!totalSets && !!catalog.error)}
          >
            {creatorJob ? 'Sync settings…' : 'Set up sync…'}
          </Button>
          <Menu label={`More actions for @${username}`} items={menuItems} />
        </div>
      </header>

      {tip && (
        <div className={styles.tip} role="status">
          <CheckCircle2 size={14} aria-hidden />
          <span>{tip.message} <button type="button" className={styles.inlineAction} onClick={openJob}>Open in Scheduler</button></span>
          <button type="button" className={styles.tipClose} onClick={() => setTip(null)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}
      {catalog.notice && (
        <div className={`${styles.tip} ${styles.tipWarn}`} role="alert">
          <AlertCircle size={14} aria-hidden />
          <span>{catalog.notice}</span>
          <button type="button" className={styles.tipClose} onClick={catalog.dismissNotice} aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}

      {catalog.ready && totalSets > 0 && (
        <div className={styles.toolbar}>
          <div role="tablist" aria-label="Show" className={styles.tabs}>
            {([['sets', 'Sets', tabCounts.sets], ['posters', 'Posters', tabCounts.posters], ['backdrops', 'Backdrops', tabCounts.backdrops], ['titlecards', 'Title cards', tabCounts.titlecards]] as const).map(([value, label, n]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                tabIndex={tab === value ? 0 : -1}
                className={`${styles.tab} ${tab === value ? styles.tabActive : ''}`}
                onClick={() => changeTab(value)}
                onKeyDown={e => {
                  const order: Tab[] = ['sets', 'posters', 'backdrops', 'titlecards']
                  const i = order.indexOf(tab)
                  const next = e.key === 'ArrowRight' ? order[(i + 1) % 4] : e.key === 'ArrowLeft' ? order[(i + 3) % 4] : null
                  if (!next) return
                  e.preventDefault()
                  changeTab(next)
                  ;(e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-tab="${next}"]`))?.focus()
                }}
                data-tab={value}
              >
                {label}<span className={styles.tabCount}>{count(n)}</span>
              </button>
            ))}
          </div>

          <div className={styles.tools}>
            <Segmented
              ariaLabel="Library filter"
              value={filter}
              onChange={changeFilter}
              options={[
                { value: 'library', label: `In my library ${count(libraryCount)}` },
                { value: 'missing', label: `Not in library ${count(queried.length - libraryCount)}` },
                { value: 'all', label: `All ${count(queried.length)}` },
              ]}
            />
            <div className={styles.search}>
              {searching ? <Loader2 size={13} className={`${styles.searchIcon} ${styles.spin}`} aria-hidden /> : <Search size={13} className={styles.searchIcon} aria-hidden />}
              <input
                ref={searchRef}
                className={styles.searchInput}
                placeholder="Search titles"
                aria-label={`Search @${username}'s titles`}
                value={query}
                onChange={e => changeQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); changeQuery('') } }}
                spellCheck={false}
              />
              {query && (
                <button type="button" className={styles.searchClear} onClick={() => { changeQuery(''); searchRef.current?.focus() }} aria-label="Clear search">
                  <X size={12} />
                </button>
              )}
            </div>
            {tab === 'sets' && !creatorJob && (
              <Button
                variant={selecting ? 'secondary' : 'ghost'}
                size="sm"
                icon={<ListChecks size={13} />}
                aria-pressed={selecting}
                onClick={() => { setSelecting(v => !v); setSelected(new Set()) }}
              >
                {selecting ? 'Done' : 'Select'}
              </Button>
            )}
          </div>
        </div>
      )}

      {selecting && tab === 'sets' && (
        <div className={styles.selectBar}>
          <span className={styles.selectCount}>
            {selected.size ? `${plural(selected.size, 'set')} selected` : 'Pick sets to sync on a schedule'}
          </span>
          <button type="button" className={styles.inlineAction} onClick={() => setSelected(prev => new Set([...prev, ...pageSelectable.map(s => s.id)]))} disabled={!pageSelectable.length}>
            Select all on this page
          </button>
          <button type="button" className={styles.inlineAction} onClick={() => setSelected(new Set())} disabled={!selected.size}>Clear</button>
          <Button variant="primary" size="sm" icon={<CalendarClock size={12} />} disabled={!selected.size} onClick={() => setSyncScope({ kind: 'sets', sets: selectedSets })}>
            {selected.size ? `Sync ${plural(selected.size, 'set')}…` : 'Sync selected…'}
          </Button>
        </div>
      )}

      <div ref={listRef} className={styles.list} data-scroll-list>
        {!catalog.ready && (
          <div className={styles.skeletonList} aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.groupSkeleton}>
                <div className={styles.skelTitle} />
                <div className={styles.skelTiles}>{Array.from({ length: 3 }).map((__, j) => <div key={j} className={styles.skelTile} />)}</div>
              </div>
            ))}
          </div>
        )}

        {catalog.ready && catalog.error && !totalSets && (
          <div className={styles.notice}>
            <AlertCircle size={18} aria-hidden />
            <p>{catalog.error}</p>
            <Button variant="secondary" size="sm" icon={<RefreshCw size={12} />} onClick={catalog.check}>Try again</Button>
          </div>
        )}

        {catalog.ready && !catalog.error && tab === 'sets' && pageGroups.length > 0 && (
          <div ref={attachShelf} className={styles.shelf}>
            {pageGroups.map((group, i) => {
              const set = pickedSet(group)
              const openGroupData = i === detailAfter ? pageGroups[openIndex] : null
              return (
                <Fragment key={group.key}>
                  <TitleTile
                    group={group}
                    set={set}
                    username={username}
                    appliedIdx={appliedIdx}
                    coverage={coverage}
                    apply={applyMap[set.id]}
                    selecting={selecting}
                    checked={selected.has(set.id)}
                    open={openGroup === group.key}
                    onOpen={() => toggleGroup(group.key)}
                    onPick={id => setPicks(prev => ({ ...prev, [group.key]: id }))}
                    onToggleSelect={() => toggleSelect(set.id)}
                    onApply={() => void applySet(set)}
                  />
                  {openGroupData && (
                    <SetDetail
                      key={`detail:${openGroupData.key}`}
                      group={openGroupData}
                      set={pickedSet(openGroupData)}
                      appliedIdx={appliedIdx}
                      enabledTypes={allTypes}
                      apply={applyMap[pickedSet(openGroupData).id]}
                      onPick={id => setPicks(prev => ({ ...prev, [openGroupData.key]: id }))}
                      onApply={() => void applySet(pickedSet(openGroupData))}
                      onClose={() => setOpenGroup(null)}
                    />
                  )}
                </Fragment>
              )
            })}
          </div>
        )}

        {catalog.ready && !catalog.error && tab !== 'sets' && pageFiles.length > 0 && (
          <div className={`${styles.fileGrid} ${tab === 'posters' ? '' : styles.fileGridWide}`}>
            {pageFiles.map(({ set, poster }, i) => {
              const k = `${set.id}:${poster.url}`
              const st = applyMap[k]
              return (
                <FileTile
                  key={k}
                  set={set}
                  poster={poster}
                  state={st}
                  applied={st?.status === 'done' || appliedIdx.posterUrls.has(poster.url)}
                  onOpen={() => setFileLightbox(i)}
                  onApply={() => void applySingle(set, poster)}
                />
              )
            })}
          </div>
        )}

        {catalog.ready && !catalog.error && total === 0 && totalSets > 0 && (
          <div className={styles.notice}>
            <ImageIcon size={18} aria-hidden />
            <p>{emptyText}</p>
            {filter !== 'all' && !q && <Button variant="secondary" size="sm" onClick={() => changeFilter('all')}>Show all {count(totalSets)} sets</Button>}
          </div>
        )}

        {catalog.ready && !catalog.error && totalSets === 0 && !crawling && (
          <div className={styles.notice}><ImageIcon size={18} aria-hidden /><p>@{username} has no sets on MediUX yet.</p></div>
        )}

        {catalog.ready && !crawling && catalog.capped && totalSets > 0 && safePage >= pageCount - 1 && (
          <p className={styles.capNote}>
            These are @{username}&apos;s newest {count(totalSets)} sets, MediUX&apos;s browse limit. Missing one of your titles?{' '}
            <button type="button" className={styles.inlineAction} onClick={() => searchRef.current?.focus()}>Search</button> their full catalog by title.
          </p>
        )}
      </div>

      {catalog.ready && total > 0 && (
        <div className={styles.pagerBar}>
          <span className={styles.pagerStatus}>
            Page {count(safePage + 1)} of {count(pageCount)}
            {crawling && ' · still reading the catalog'}
          </span>
          <Pager page={safePage} pageCount={pageCount} onPage={goPage} />
        </div>
      )}

      <AnimatePresence>
        {fileLightbox !== null && (
          <Lightbox images={fileLightboxImages} index={fileLightbox} onClose={() => setFileLightbox(null)} />
        )}
      </AnimatePresence>

      {syncScope && (
        <CreatorSyncDialog
          open
          username={username}
          scope={syncScope}
          jobs={jobs}
          matchedTitles={syncScope.kind === 'sets' ? new Set(syncScope.sets.map(s => s.matchedKey).filter(Boolean)).size : matchedTitles}
          defaultCron={quickCron}
          enabledTypes={allTypes}
          onClose={() => setSyncScope(null)}
          onSaved={(message, jobId) => {
            setSyncScope(null)
            setSelecting(false)
            setSelected(new Set())
            setTip({ message, jobId })
          }}
        />
      )}

      <ConfirmDialog
        open={confirmReread}
        title={`Re-read @${username}'s whole catalog?`}
        body="Every page of their catalog is read from MediUX again, which takes several minutes for a large catalog. The sets you see stay in use until it finishes. Use this when sets look wrong or missing; Check for new sets is enough to pick up new uploads."
        confirmLabel="Re-read catalog"
        onConfirm={() => { setConfirmReread(false); catalog.reread() }}
        onCancel={() => setConfirmReread(false)}
      />
    </div>
  )
}

function fileCaption(p: PosterInfo): string | undefined {
  if (p.episode != null) return `${typeof p.season === 'number' ? `Season ${p.season}, ` : ''}Episode ${p.episode}`
  if (typeof p.season === 'number') return p.season === 0 ? 'Specials' : `Season ${p.season}`
  return undefined
}

interface TitleTileProps {
  group: TitleGroup
  /** The variant shown and applied; the group's first set until another is picked. */
  set: MediuxUserSet
  username: string
  appliedIdx: AppliedIndex
  coverage: ScheduleCoverage
  apply?: ApplyState
  selecting: boolean
  checked: boolean
  open: boolean
  onOpen: () => void
  onPick: (setId: string) => void
  onToggleSelect: () => void
  onApply: () => void
}

const MAX_SWATCHES = 5

/** One title on the poster wall: the picked set's art, with Apply on the art and the other sets as swatches. */
function TitleTile({ group, set, username, appliedIdx, coverage, apply, selecting, checked, open, onOpen, onPick, onToggleSelect, onApply }: TitleTileProps) {
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)
  const current = group.matchedKey ? appliedIdx.currentByItem.get(group.matchedKey) : undefined
  const setIsCurrent = setKey(set) === current
  const otherIsCurrent = !setIsCurrent && group.sets.some(s => setKey(s) === current)
  const hasOtherArt = !current && !!group.matchedKey && appliedIdx.titles.has(appliedKey(group.title, group.year))
  const synced = group.sets.some(s => !!coveringJob(coverage, s.id, username))
  const inLibrary = !!group.matchedKey
  const canApply = inLibrary || set.posters.some(p => p.isCollection)
  const status = apply?.status ?? 'idle'
  const heading = group.year ? `${group.title} (${group.year})` : group.title
  const fileCount = set.posters.length
  const meta = !inLibrary
    ? `${group.year ?? ''}${group.year ? ' · ' : ''}Not in library`
    : group.sets.length > 1
      ? `${group.year ?? ''}${group.year ? ' · ' : ''}${group.sets.length} sets`
      : `${group.year ?? ''}${group.year ? ' · ' : ''}${plural(fileCount, 'file')}`
  const extra = group.sets.length - MAX_SWATCHES

  return (
    <div className={`${styles.tile} ${open ? styles.tileOpen : ''} ${checked ? styles.tileChecked : ''} ${inLibrary ? '' : styles.tileMissing} ${status !== 'idle' ? styles.tileBusy : ''}`}>
      <div className={styles.poster}>
        <button
          type="button"
          className={styles.posterButton}
          onClick={selecting && inLibrary ? onToggleSelect : onOpen}
          aria-expanded={selecting ? undefined : open}
          aria-pressed={selecting ? checked : undefined}
          aria-label={selecting ? `Select ${heading}` : `${heading}: show sets and files`}
          title={group.sets.length > 1 ? `${heading} · ${set.setName}` : heading}
        >
          {set.previewUrl && !broken ? (
            <img
              src={set.previewUrl}
              alt=""
              loading="lazy"
              draggable={false}
              className={loaded ? styles.artLoaded : styles.artPending}
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
            />
          ) : (
            <span className={styles.artFallback}><ImageIcon size={22} aria-hidden /></span>
          )}
        </button>

        <div className={styles.posterTop}>
          {selecting
            ? inLibrary && <span className={`${styles.check} ${checked ? styles.checkOn : ''}`} aria-hidden>{checked && <Check size={12} strokeWidth={3} />}</span>
            : setIsCurrent || status === 'done'
              ? <span className={`${styles.pill} ${styles.pillSuccess}`}><CheckCircle2 size={11} aria-hidden /> Applied</span>
              : otherIsCurrent
                ? <span className={styles.pill}>Other set applied</span>
                : hasOtherArt && <span className={styles.pill}>Other art</span>}
          {synced && !selecting && <span className={`${styles.pill} ${styles.pillIcon}`} title="Synced on a schedule"><CalendarClock size={11} aria-hidden /><span className={styles.srOnly}>Synced</span></span>}
        </div>

        {!selecting && canApply && (
          <div className={styles.posterActions}>
            {status === 'applying' ? (
              <span className={styles.overlayStatus}><Loader2 size={12} className={styles.spin} aria-hidden /> {apply!.done}/{apply!.total}</span>
            ) : status === 'error' ? (
              <button type="button" className={`${styles.overlayButton} ${styles.overlayError}`} onClick={onApply} title={apply!.error}>
                <AlertCircle size={12} aria-hidden /> Retry
              </button>
            ) : status === 'done' ? (
              <span className={styles.overlayStatus} title={apply!.error}><Check size={12} aria-hidden /> Applied {apply!.done}{apply!.error ? ', some failed' : ''}</span>
            ) : (
              <button type="button" className={styles.overlayButton} onClick={onApply} aria-label={`Apply ${set.setName}`}>
                <Upload size={12} aria-hidden /> Apply
              </button>
            )}
          </div>
        )}
      </div>

      <div className={styles.tileText}>
        <span className={styles.tileTitle} title={heading}>{group.title}</span>
        <span className={styles.tileMeta} title={meta}>{meta}</span>
      </div>

      {group.sets.length > 1 && (
        <div className={styles.swatches} role="radiogroup" aria-label={`Sets for ${heading}`}>
          {group.sets.slice(0, MAX_SWATCHES).map(s => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === set.id}
              aria-label={s.setName}
              title={s.setName}
              className={`${styles.swatch} ${s.id === set.id ? styles.swatchOn : ''}`}
              onClick={() => onPick(s.id)}
            >
              {s.previewUrl ? <img src={s.previewUrl} alt="" loading="lazy" draggable={false} /> : <ImageIcon size={10} aria-hidden />}
              {setKey(s) === current && <span className={styles.swatchCurrent} aria-hidden />}
            </button>
          ))}
          {extra > 0 && (
            <button type="button" className={styles.swatchMore} onClick={onOpen} aria-label={`${extra} more sets; show all`}>
              +{extra}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface SetDetailProps {
  group: TitleGroup
  set: MediuxUserSet
  appliedIdx: AppliedIndex
  enabledTypes: Set<FileType>
  apply?: ApplyState
  onPick: (setId: string) => void
  onApply: () => void
  onClose: () => void
}

/** The shelf that opens under a title's row: the picked set large, every set for the title, and its files. */
function SetDetail({ group, set, appliedIdx, enabledTypes, apply, onPick, onApply, onClose }: SetDetailProps) {
  const ref = useRef<HTMLElement>(null)
  const headingId = useId()
  const heading = group.year ? `${group.title} (${group.year})` : group.title
  const [lightbox, setLightbox] = useState<number | null>(null)
  const fileRows = useMemo(() => {
    const groups = groupPosters(set.posters).filter(g => enabledTypes.has(g.kind))
    const posterItems = groups.filter(g => g.kind === 'poster')
      .flatMap(g => g.posters.map(p => ({ poster: p, caption: g.label.replace(/ Poster$/, '') })))
    const rows = posterItems.length ? [{ label: 'Posters', kind: 'poster' as FileType, items: posterItems }] : []
    for (const g of groups.filter(gr => gr.kind !== 'poster')) {
      rows.push({ label: g.label === 'Backdrop' ? 'Backdrops' : g.label, kind: g.kind, items: g.posters.map(p => ({ poster: p, caption: '' })) })
    }
    return rows
  }, [set.posters, enabledTypes])
  const images = useMemo<LightboxImage[]>(
    () => fileRows.flatMap(r => r.items.map(({ poster, caption }) => ({
      url: poster.url,
      label: heading,
      caption: poster.episode != null ? `${r.label}, episode ${poster.episode}` : caption || r.label,
    }))),
    [fileRows, heading],
  )
  const current = group.matchedKey ? appliedIdx.currentByItem.get(group.matchedKey) : undefined
  const status = apply?.status ?? 'idle'
  const canApply = !!group.matchedKey || set.posters.some(p => p.isCollection)

  useEffect(() => {
    const el = ref.current
    const list = el?.closest<HTMLElement>('[data-scroll-list]')
    if (!el || !list) return
    const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top
    if (top > list.clientHeight - 220) list.scrollBy({ top: top - list.clientHeight * 0.35, behavior: 'smooth' })
  }, [])

  let flat = -1
  return (
    <section
      ref={ref}
      className={styles.detail}
      aria-labelledby={headingId}
      onKeyDown={e => { if (e.key === 'Escape' && lightbox === null) { e.stopPropagation(); onClose() } }}
    >
      <div className={styles.detailArt}>
        {set.previewUrl ? <img src={set.previewUrl} alt="" draggable={false} /> : <span className={styles.artFallback}><ImageIcon size={26} aria-hidden /></span>}
      </div>

      <div className={styles.detailBody}>
        <div className={styles.detailHead}>
          <div className={styles.detailHeading}>
            <h3 id={headingId} className={styles.detailTitle}>{heading}</h3>
            <p className={styles.detailSub}>
              {set.setName} · {shortTypeCounts(set)}
              {set.downloads != null && ` · ${plural(set.downloads, 'download')}`}
            </p>
            <p className={styles.detailState}>
              {!group.matchedKey
                ? 'Not in your library'
                : setKey(set) === current
                  ? <span className={styles.applyDone}><CheckCircle2 size={12} aria-hidden /> This set is on Plex now</span>
                  : appliedIdx.setKeys.has(setKey(set)) ? 'Applied before; other art is on Plex now' : 'In your library'}
            </p>
          </div>
          <div className={styles.detailActions}>
            {status === 'applying' ? (
              <span className={styles.applyProgress}><Loader2 size={12} className={styles.spin} aria-hidden /> Applying {apply!.done}/{apply!.total}</span>
            ) : status === 'done' ? (
              <span className={styles.applyDone} title={apply!.error}><Check size={12} aria-hidden /> Applied {apply!.done}{apply!.error ? ` · ${apply!.error}` : ''}</span>
            ) : status === 'error' ? (
              <span className={styles.applyError}><AlertCircle size={12} aria-hidden /> {apply!.error ?? 'Failed'} <button type="button" className={styles.inlineAction} onClick={onApply}>Retry</button></span>
            ) : (
              <Button variant="primary" size="sm" icon={<Upload size={12} />} onClick={onApply} disabled={!canApply} title={canApply ? undefined : 'Not in your library'}>
                Apply set
              </Button>
            )}
            {set.setUrl && (
              <Button variant="ghost" size="sm" icon={<ExternalLink size={12} />} onClick={() => window.api.app.openExternal(set.setUrl!)}>MediUX</Button>
            )}
            <button type="button" className={styles.iconAction} onClick={onClose} aria-label="Close" title="Close (Esc)"><X size={15} /></button>
          </div>
        </div>

        {group.sets.length > 1 && (
          <div className={styles.detailSets} role="radiogroup" aria-label={`Sets for ${heading}`}>
            {group.sets.map(s => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={s.id === set.id}
                className={`${styles.detailSet} ${s.id === set.id ? styles.detailSetOn : ''}`}
                onClick={() => onPick(s.id)}
              >
                <span className={styles.detailSetArt}>{s.previewUrl ? <img src={s.previewUrl} alt="" loading="lazy" draggable={false} /> : <ImageIcon size={12} aria-hidden />}</span>
                <span className={styles.detailSetText}>
                  <span className={styles.detailSetName}>{s.setName}</span>
                  <span className={styles.detailSetMeta}>{setKey(s) === current ? 'On Plex now' : shortTypeCounts(s)}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {fileRows.length === 0 && <p className={styles.detailSub}>None of this set&apos;s files are of a type switched on in Settings.</p>}
        {fileRows.map(row => (
          <div key={row.label} className={styles.fileGroup}>
            <span className={styles.fileGroupLabel}>{row.label}<span className={styles.tabCount}>{count(row.items.length)}</span></span>
            <div className={`${libraryStyles.groupThumbs} ${row.kind === 'poster' ? '' : libraryStyles.groupThumbsWide}`}>
              {row.items.map(({ poster, caption }) => {
                flat++
                const idx = flat
                const thumb = (
                  <ThumbButton
                    key={poster.url}
                    url={poster.thumbUrl ?? poster.url}
                    label={caption || row.label}
                    episode={poster.episode}
                    onClick={() => setLightbox(idx)}
                    pageUrl={posterPageUrl(poster, set.setUrl)}
                    site={SOURCE_LABEL[poster.source]}
                  />
                )
                return caption
                  ? <figure key={poster.url} className={styles.thumbCell}>{thumb}<figcaption className={styles.thumbCaption}>{caption}</figcaption></figure>
                  : thumb
              })}
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {lightbox !== null && <Lightbox images={images} index={lightbox} onClose={() => setLightbox(null)} />}
      </AnimatePresence>
    </section>
  )
}

/** A single poster, backdrop, or title card, with Apply on the art. */
function FileTile({ set, poster, state, applied, onOpen, onApply }: {
  set: MediuxUserSet
  poster: PosterInfo
  state?: ApplyState
  applied: boolean
  onOpen: () => void
  onApply: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const title = set.year ? `${set.title} (${set.year})` : set.title
  const caption = poster.episode != null
    ? `${typeof poster.season === 'number' ? `S${poster.season} ` : ''}E${poster.episode}`
    : typeof poster.season === 'number' ? (poster.season === 0 ? 'Specials' : `Season ${poster.season}`) : null
  const inLibrary = !!set.matchedKey || !!poster.isCollection
  const status = state?.status ?? 'idle'

  return (
    <div className={`${styles.tile} ${inLibrary ? '' : styles.tileMissing} ${status !== 'idle' ? styles.tileBusy : ''}`}>
      <div className={styles.poster}>
        <button type="button" className={styles.posterButton} onClick={onOpen} aria-label={`View ${title}${caption ? `, ${caption}` : ''}`}>
          <img
            src={poster.thumbUrl ?? poster.url}
            alt=""
            loading="lazy"
            draggable={false}
            className={loaded ? styles.artLoaded : styles.artPending}
            onLoad={() => setLoaded(true)}
          />
        </button>
        <div className={styles.posterTop}>
          {(applied || status === 'done') && <span className={`${styles.pill} ${styles.pillSuccess}`}><CheckCircle2 size={11} aria-hidden /> Applied</span>}
        </div>
        {inLibrary && !applied && (
          <div className={styles.posterActions}>
            {status === 'applying' ? (
              <span className={styles.overlayStatus}><Loader2 size={12} className={styles.spin} aria-hidden /> Applying</span>
            ) : status === 'error' ? (
              <button type="button" className={`${styles.overlayButton} ${styles.overlayError}`} onClick={onApply} title={state?.error}>
                <AlertCircle size={12} aria-hidden /> Retry
              </button>
            ) : status !== 'done' && (
              <button type="button" className={styles.overlayButton} onClick={onApply} aria-label={`Apply ${title}${caption ? ` ${caption}` : ''}`}>
                <Upload size={12} aria-hidden /> Apply
              </button>
            )}
          </div>
        )}
      </div>
      <div className={styles.tileText}>
        <span className={styles.tileTitleRow}>
          <span className={styles.tileTitle} title={title}>{set.title}</span>
          {caption && <span className={styles.tileCaption}>{caption}</span>}
        </span>
        {!inLibrary && <span className={styles.tileMeta}>Not in library</span>}
      </div>
    </div>
  )
}
