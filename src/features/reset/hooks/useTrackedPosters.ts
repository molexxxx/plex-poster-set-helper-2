import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LightboxImage } from '../../../components/ui/Lightbox'
import { SOURCE_LABEL } from '../../../utils/posterGroups'
import {
  enlarge, filterTracked, latestPerItem, trackedStats,
  type SourceFilter, type Stats, type TrackedItem, type TypeFilter,
} from '../resetText'

/** Rows per page in the tracked-poster list; keeps large histories smooth. */
const PAGE_SIZE = 20


/**
 * The applied history as one row per item, filtered and paged for the Reset
 * Posters list. It reloads quietly whenever the reset controller forgets an item.
 *
 * @param revision - Bumped by the reset controller after each item it forgets.
 * @returns The items and the filtered page of them, the filters and their
 *   setters, the stats, lightbox images, the list's scroll ref, and `load`.
 */
export function useTrackedPosters(revision: number) {
  const [items, setItems]           = useState<TrackedItem[]>([])
  const [loading, setLoading]       = useState(false)
  const [sourceFilter, setSource]   = useState<SourceFilter>('all')
  const [typeFilter, setType]       = useState<TypeFilter>('all')
  const [search, setSearch]         = useState('')
  const [page, setPage]             = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  /** Change page and snap the list back to the top. */
  const goToPage = (p: number) => { setPage(p); listRef.current?.scrollTo({ top: 0 }) }


  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const cfg = await window.api.config.get()
      const records = cfg.appliedPosters ?? []
      // One row per Plex item (latest record wins)
      setItems(latestPerItem(records))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  // The controller forgets items from history as they reset; pull the fresh list
  // so reset rows drop (without flashing the loading skeleton each time).
  useEffect(() => { if (revision > 0) void load(true) }, [revision, load])


  const filtered = filterTracked(items, sourceFilter, typeFilter, search)

  // Client-side pagination: the whole history is already in memory, so we just
  // slice it. safePage clamps the page as rows drop off (e.g. after a reset)
  // without needing to reach for state in an effect.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage  = Math.min(page, pageCount - 1)
  const pageStart = safePage * PAGE_SIZE
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE)

  const stats = useMemo<Stats>(() => trackedStats(items), [items])

  const lightboxImages: LightboxImage[] = filtered.map(i => ({
    url: enlarge(i.thumb) ?? i.thumb ?? '',
    label: i.year ? `${i.title} (${i.year})` : i.title,
    caption: `${SOURCE_LABEL[i.source]} · ${i.libraryTitle ?? ''}`.trim(),
  }))

  function searchFor(text: string) { setSearch(text); setPage(0) }
  function showSource(f: SourceFilter) { setSource(f); setPage(0) }
  function showType(f: TypeFilter) { setType(f); setPage(0) }

  return {
    items, loading, load, listRef, goToPage,
    filtered, pageItems, pageCount, safePage, pageStart, pageSize: PAGE_SIZE, stats, lightboxImages,
    search, searchFor, sourceFilter, showSource, typeFilter, showType,
  }
}
