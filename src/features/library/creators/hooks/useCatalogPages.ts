import { useMemo } from 'react'
import type { MediuxUserSet } from '../../../../../electron/ipc/types'
import { posterFileType, type FileType } from '../../../../utils/posterGroups'
import { groupByTitle, type LibraryFilter, type Tab } from '../catalogUtils'
const GROUPS_PER_PAGE = 30
const FILES_PER_PAGE = 60
const TAB_TYPE: Record<Exclude<Tab, 'sets'>, FileType> = { posters: 'poster', backdrops: 'backdrop', titlecards: 'title_card' }

interface CatalogPagesInput
{
  sets: MediuxUserSet[]
  /** Sets the full-catalog search found, merged in while the catalog is partial. */
  searchResults: MediuxUserSet[]
  partial: boolean
  q: string
  filter: LibraryFilter
  crawling: boolean
  tab: Tab
  page: number
}

/**
 * The catalog narrowed by the search and the library filter, grouped by title
 * or flattened to single files for the open tab, and cut to the current page.
 *
 * @returns The sets the search matches and how many are in the library, the
 *   count for each tab, and the page's groups or files with the page count.
 */
export function useCatalogPages({ sets, searchResults, partial, q, filter, crawling, tab, page }: CatalogPagesInput)
{
  const merged = useMemo(() => {
    if (!partial || q.length < 2 || !searchResults.length) return sets
    const ids = new Set(sets.map(s => s.id))
    return [...searchResults.filter(s => !ids.has(s.id)), ...sets]
  }, [sets, searchResults, partial, q])

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

  const perPage = tab === 'sets' ? GROUPS_PER_PAGE : FILES_PER_PAGE
  const total = tab === 'sets' ? groups.length : files.length
  const pageCount = Math.max(1, Math.ceil(total / perPage))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * perPage
  const pageGroups = groups.slice(pageStart, pageStart + perPage)
  const pageFiles = files.slice(pageStart, pageStart + perPage)

  return { queried, libraryCount, tabCounts, total, pageCount, safePage, pageGroups, pageFiles }
}
