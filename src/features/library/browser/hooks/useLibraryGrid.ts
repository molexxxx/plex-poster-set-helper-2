import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { SelectOption } from '../../../../components/ui/Select'
import type { LibraryItem, LibrarySection, LibrarySort, LibraryStatusFilter, SortDir } from '../../../../../electron/ipc/types'
import { SOURCE_LABEL, SOURCE_SHORT } from '../../../../utils/posterGroups'
import { appliedUploaders, type AppliedUploader } from '../../../../../electron/services/schedule/appliedArt'
import { ALL_SORTS, COLLECTIONS_TAB_KEY, COLLECTION_SORTS, PAGE_SIZE, toArtFilter, type ArtFilterValue } from '../gridOptions'

/**
 * The Library grid's data and controls: the sections, the items of the open
 * tab with paging, cross-library search, sort and filters, and refresh.
 *
 * @param scrollRef - The grid's scroll container; nearing its end loads the next page.
 * @returns The grid state with its setters, and the actions the toolbar and grid use.
 */
export function useLibraryGrid(scrollRef: RefObject<HTMLDivElement | null>)
{
  const [sections, setSections]   = useState<LibrarySection[]>([])
  const [activeKey, setActiveKey] = useState<string>('')

  const [items, setItems]     = useState<LibraryItem[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch]   = useState('')

  const [globalResults, setGlobalResults] = useState<{ section: LibrarySection; items: LibraryItem[] }[]>([])
  const [collectionHits, setCollectionHits] = useState<LibraryItem[]>([])
  const [globalLoading, setGlobalLoading] = useState(false)

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

  useEffect(() =>
  {
    window.api.config.get().then(c =>
    {
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

  const loadSections = useCallback(() =>
  {
    return window.api.library.sections().then((s: LibrarySection[]) =>
    {
      setSections(s)
      setActiveKey(prev => prev || s[0]?.key || '')
    })
  }, [])

  useEffect(() =>
  {
    loadSections()
    const unsub = window.api.auth.onStatusChange(st =>
    {
      if (st.status === 'authorized') loadSections()
    })
    return () => { unsub() }
  }, [loadSections])

  const loadItems = useCallback(async (key: string, q: string, append: boolean, fresh = false) =>
  {
    if (!key || key === COLLECTIONS_TAB_KEY) return
    setLoading(true)
    const offset = append ? offsetRef.current : 0
    try
    {
      const res = await window.api.library.items({
        sectionKey: key, offset, limit: PAGE_SIZE, search: q, sort, sortDir,
        artFilter: toArtFilter(artFilter), status: statusParam, fresh: fresh || undefined,
      })
      setTotal(res.total)
      offsetRef.current = offset + res.items.length
      setItems(prev => append ? [...prev, ...res.items] : res.items)
    }
    finally
    {
      setLoading(false)
    }
  }, [sort, sortDir, artFilter, statusParam])

  const loadCollections = useCallback(async (q: string, append: boolean) =>
  {
    setLoading(true)
    const offset = append ? offsetRef.current : 0
    try
    {
      const res = await window.api.library.collections({ offset, limit: PAGE_SIZE, search: q || undefined, sort, sortDir })
      setTotal(res.total)
      offsetRef.current = offset + res.items.length
      setItems(prev => append ? [...prev, ...res.items] : res.items)
    }
    finally
    {
      setLoading(false)
    }
  }, [sort, sortDir])

  useEffect(() =>
  {
    if (!activeKey || isGlobalSearch) return
    offsetRef.current = 0
    const q = search.trim()
    const t = setTimeout(() =>
    {
      if (activeKey === COLLECTIONS_TAB_KEY) void loadCollections(q, false)
      else void loadItems(activeKey, '', false)
    }, activeKey === COLLECTIONS_TAB_KEY && q ? 300 : 0)
    return () => clearTimeout(t)
  }, [activeKey, isGlobalSearch, search, loadItems, loadCollections, reloadNonce])

  // Cross-library search: fire all sections in parallel, debounced
  useEffect(() =>
  {
    if (!isGlobalSearch || !sections.length) { setGlobalResults([]); setCollectionHits([]); return }
    setGlobalLoading(true)
    const q = search.trim()
    let cancelled = false
    const t = setTimeout(() =>
    {
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
      ]).then(([results, collections]) =>
      {
        if (cancelled) return
        setGlobalResults(results.filter(r => r.items.length > 0))
        setCollectionHits(collections)
        setGlobalLoading(false)
      })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search, isGlobalSearch, sections, showCollections, reloadNonce, sort, sortDir, artFilter, statusParam])

  // Infinite scroll, single-tab mode only
  function onScroll()
  {
    const el = scrollRef.current
    if (!el || loading || isGlobalSearch) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400 && items.length < total)
    {
      if (isCollectionsView) void loadCollections(search.trim(), true)
      else void loadItems(activeKey, '', true)
    }
  }

  const totalGlobalHits = globalResults.reduce((n, g) => n + g.items.length, 0) + collectionHits.length

  // Manual refresh re-checks sections and reloads what's on screen, holding the
  // spin for a brief minimum so a fast local Plex doesn't flicker sub-frame
  const refreshing = manualRefreshing || loading || globalLoading
  async function handleRefresh()
  {
    if (manualRefreshing) return
    setManualRefreshing(true)
    const started = Date.now()
    try
    {
      await loadSections()
      if (!isGlobalSearch && activeKey === COLLECTIONS_TAB_KEY)
      {
        offsetRef.current = 0
        await loadCollections(search.trim(), false)
      }
      else if (!isGlobalSearch && activeKey)
      {
        offsetRef.current = 0
        await loadItems(activeKey, '', false, true)
      }
      else
      {
        setReloadNonce(n => n + 1)
      }
    }
    finally
    {
      const elapsed = Date.now() - started
      if (elapsed < 500) await new Promise(r => setTimeout(r, 500 - elapsed))
      setManualRefreshing(false)
    }
  }

  // Collections only support a subset of sorts; coerce the shown value so the
  // dropdown never displays an option it isn't offering on that tab.
  const sortList = isCollectionsView ? COLLECTION_SORTS : ALL_SORTS
  const shownSort: LibrarySort = sortList.includes(sort) ? sort : 'title'
  function changeSort(next: LibrarySort)
  {
    setSort(next)
    window.api.config.set({ librarySort: next }).catch(() => {})
  }
  function toggleSortDir()
  {
    const next: SortDir = sortDir === 'asc' ? 'desc' : 'asc'
    setSortDir(next)
    window.api.config.set({ librarySortDir: next }).catch(() => {})
  }

  return {
    sections, activeKey, setActiveKey, items, setItems, total, loading, search, setSearch,
    globalResults, setGlobalResults, collectionHits, globalLoading, sortDir, artFilter, setArtFilter, showStatus, setShowStatus,
    artFilterOptions, isCollectionsView, isGlobalSearch, showCollections, totalGlobalHits, refreshing, handleRefresh,
    sortList, shownSort, changeSort, toggleSortDir, onScroll,
  }
}

/** The grid state and actions `useLibraryGrid` returns. */
export type LibraryGrid = ReturnType<typeof useLibraryGrid>
