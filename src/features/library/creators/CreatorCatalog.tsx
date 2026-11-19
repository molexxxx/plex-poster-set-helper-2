import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AlertCircle, CheckCircle2, Image as ImageIcon, RefreshCw, X } from 'lucide-react'
import Button from '../../../components/ui/Button'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import Lightbox, { type LightboxImage } from '../../../components/ui/Lightbox'
import Pager from '../../../components/ui/Pager'
import type { ScheduledJob } from '../../../../electron/ipc/types'
import { ALL_TYPES, type FileType } from '../../../utils/posterGroups'
import type { CreatorState } from '../../../utils/creatorPrefs'
import type { AppliedIndex } from '../../../utils/appliedTracker'
import { describeArtworkTypes, type ScheduleCoverage } from '../../../../electron/services/scheduleUtils'
import { useAppContext } from '../../../app/AppContext'
import { useNavStore } from '../../../app/navStore'
import { useSmoothScroll } from '../../../app/useSmoothScroll'
import CreatorSyncDialog, { type SyncScope } from './CreatorSyncDialog'
import { useCreatorCatalog } from './hooks/useCreatorCatalog'
import { useColumns } from './hooks/useColumns'
import { useCatalogSearch } from './hooks/useCatalogSearch'
import { useCatalogPages } from './hooks/useCatalogPages'
import { useCatalogApply } from './hooks/useCatalogApply'
import { count, fileCaption, type LibraryFilter, type Tab, type TitleGroup } from './catalogUtils'
import CatalogHeader from './CatalogHeader'
import CatalogToolbar from './CatalogToolbar'
import SelectBar from './SelectBar'
import TitleTile from './TitleTile'
import SetDetail from './SetDetail'
import FileTile from './FileTile'
import shared from './catalogShared.module.css'
import tiles from './tiles.module.css'
import styles from './CreatorCatalog.module.css'
interface ViewState { tab: Tab; page: number; query: string; filter: LibraryFilter }

/** Where the user was in each creator's catalog, kept while they visit other pages. */
const viewStates = new Map<string, ViewState>()

/** Poster tiles: minimum width and column gap, shared with the CSS grid so the detail shelf lands after the right row. */
const TILE_MIN = 150
const TILE_GAP = 16

interface CatalogProps {
  username: string
  creator: CreatorState
  appliedIdx: AppliedIndex
  jobs: ScheduledJob[]
  coverage: ScheduleCoverage
  quickCron: string
  /** Types Apply uses here; they start from Settings. */
  types: Set<FileType>
  settingsTypes: FileType[]
  onTypesChange: (types: Set<FileType>) => void
  onCreatorChange: (state: CreatorState) => void
  onApplied: (sKey: string, itemKey: string, title: string, year: number | undefined, urls: string[]) => void
}

/** One creator's catalog: a header with status and sync, then titles with their variant sets, or single files. */
export default function CreatorCatalog({ username, creator, appliedIdx, jobs, coverage, quickCron, types: allTypes, settingsTypes, onTypesChange, onCreatorChange, onApplied }: CatalogProps) {
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
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [picks, setPicks]         = useState<Record<string, string>>({})
  const [fileLightbox, setFileLightbox] = useState<number | null>(null)
  const [syncScope, setSyncScope] = useState<SyncScope | null>(null)
  const [tip, setTip]             = useState<{ message: string; jobId: string } | null>(null)
  const [confirmReread, setConfirmReread] = useState(false)
  const [, setTick] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const [columns, attachShelf] = useColumns(TILE_MIN, TILE_GAP)
  useSmoothScroll(listRef)

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
  const { searchResults, setSearchResults, searching, setSearching } = useCatalogSearch(username, partial, q)
  const { queried, libraryCount, tabCounts, total, pageCount, safePage, pageGroups, pageFiles } = useCatalogPages({
    sets: catalog.sets, searchResults, partial, q, filter, crawling, tab, page,
  })
  const { applyMap, applySet, applySingle } = useCatalogApply(allTypes, onApplied)
  const totalSets = catalog.sets.length
  const totalInLibrary = useMemo(() => catalog.sets.filter(s => s.matchedKey).length, [catalog.sets])
  const matchedTitles = useMemo(() => new Set(catalog.sets.filter(s => s.matchedKey).map(s => s.matchedKey)).size, [catalog.sets])
  const avatar = catalog.sets.find(s => s.uploaderAvatar)?.uploaderAvatar

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

  const emptyText = !catalog.ready ? '' : q
    ? searching ? 'Searching their full catalog…' : `No ${filter === 'library' ? 'titles in your library' : filter === 'missing' ? 'titles outside your library' : 'titles'} match "${query.trim()}".`
    : filter === 'library'
      ? crawling ? 'No library matches yet. The catalog is still being read.' : `None of @${username}'s sets match titles in your library.`
      : filter === 'missing' ? 'Every set matches a title in your library.' : `@${username} has no sets on MediUX yet.`

  return (
    <div className={styles.catalog} aria-labelledby={titleId}>
      <CatalogHeader
        username={username}
        creator={creator}
        catalog={catalog}
        titleId={titleId}
        avatar={avatar}
        totalSets={totalSets}
        totalInLibrary={totalInLibrary}
        crawling={crawling}
        creatorJob={creatorJob}
        onCreatorChange={onCreatorChange}
        setSyncScope={setSyncScope}
        setConfirmReread={setConfirmReread}
      />
      {tip && (
        <div className={styles.tip} role="status">
          <CheckCircle2 size={14} aria-hidden />
          <span>{tip.message} <button type="button" className={shared.inlineAction} onClick={openJob}>Open in Scheduler</button></span>
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
        <CatalogToolbar
          tab={tab}
          tabCounts={tabCounts}
          changeTab={changeTab}
          filter={filter}
          changeFilter={changeFilter}
          queried={queried}
          libraryCount={libraryCount}
          query={query}
          changeQuery={changeQuery}
          searching={searching}
          searchRef={searchRef}
          username={username}
          creatorJob={creatorJob}
          selecting={selecting}
          setSelecting={setSelecting}
          setSelected={setSelected}
        />
      )}

      {selecting && tab === 'sets' && (
        <SelectBar selected={selected} setSelected={setSelected} pageSelectable={pageSelectable} selectedSets={selectedSets} setSyncScope={setSyncScope} />
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
          <div ref={attachShelf} className={tiles.shelf}>
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
                    applyHint={allTypes.size < ALL_TYPES.length ? `Applies ${describeArtworkTypes(allTypes)}` : undefined}
                  />
                  {openGroupData && (
                    <SetDetail
                      key={`detail:${openGroupData.key}`}
                      group={openGroupData}
                      set={pickedSet(openGroupData)}
                      appliedIdx={appliedIdx}
                      enabledTypes={allTypes}
                      onTypesChange={onTypesChange}
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
          <div className={`${tiles.fileGrid} ${tab === 'posters' ? '' : tiles.fileGridWide}`}>
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
            <button type="button" className={shared.inlineAction} onClick={() => searchRef.current?.focus()}>Search</button> their full catalog by title.
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
          pickedTypes={allTypes}
          settingsTypes={settingsTypes}
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
