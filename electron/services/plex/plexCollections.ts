import { ConfigService } from '../config'
import type { SectionItemsRes, LibraryItem, LibrarySort, SortDir } from '../../ipc/types'
import { plexConnection } from './plexConnection'
import { plexFetch } from './plexHttp'
import { extractGuids, thumbUrl } from './plexMetadata'

/** Plex collections: the Collections grid and the members of one collection. */
export const plexCollections = {
  /**
   * Lists movie-library Plex Collections for the library browser.
   *
   * @param req - Offset/limit, optional title filter, and sort choice.
   * @returns Collection items in the requested order (Plex collections only
   *   meaningfully support title and date-added; other sorts fall back to title).
   */
  async listCollections(req: { offset: number; limit: number; search?: string; sort?: LibrarySort; sortDir?: SortDir }): Promise<SectionItemsRes> {
    const conn = plexConnection.getConnection()
    if (!conn) return { items: [], total: 0 }
    const { baseUrl, token, libraries } = conn
    const excluded = ConfigService.get().excludedLibraries ?? []
    const all: LibraryItem[] = []
    const addedAt = new Map<LibraryItem, number>()

    for (const lib of libraries) {
      if (lib.type !== 'movie' || excluded.includes(lib.title)) continue
      try {
        const data = await plexFetch(
          baseUrl, token,
          `/library/sections/${lib.key}/collections`,
        ) as { MediaContainer?: { Metadata?: Array<{ ratingKey?: string; title?: string; childCount?: number; thumb?: string; addedAt?: number }> } }
        for (const c of data?.MediaContainer?.Metadata ?? []) {
          if (!c.ratingKey || !c.title) continue
          const item: LibraryItem = {
            key: c.ratingKey,
            title: c.title,
            type: 'collection',
            libraryTitle: lib.title,
            childCount: c.childCount,
            thumb: thumbUrl(baseUrl, token, c.thumb),
          }
          addedAt.set(item, typeof c.addedAt === 'number' ? c.addedAt : 0)
          all.push(item)
        }
      } catch {
        // section may not support collections
      }
    }

    const mul = req.sortDir === 'desc' ? -1 : 1
    if (req.sort === 'recentlyAdded') {
      all.sort((a, b) => mul * ((addedAt.get(a) ?? 0) - (addedAt.get(b) ?? 0)))
    } else {
      all.sort((a, b) => mul * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    }
    const q = req.search?.trim().toLowerCase()
    const filtered = q ? all.filter(c => c.title.toLowerCase().includes(q)) : all
    const slice = filtered.slice(req.offset, req.offset + req.limit)
    return { items: slice, total: filtered.length }
  },

  /**
   * Returns collection metadata plus member movies for MediUX discovery.
   */
  async getCollectionInfo(collectionKey: string): Promise<{
    title: string
    tmdbCollectionId?: string
    children: LibraryItem[]
  }> {
    const conn = plexConnection.getConnection()
    if (!conn) return { title: '', children: [] }
    const { baseUrl, token } = conn
    let title = ''
    let tmdbCollectionId: string | undefined
    try {
      const data = await plexFetch(
        baseUrl, token,
        `/library/metadata/${collectionKey}?includeGuids=1`,
      ) as {
        MediaContainer?: { Metadata?: Array<{ title?: string; guid?: string; Guid?: Array<{ id?: string }> }> }
      }
      const meta = data?.MediaContainer?.Metadata?.[0]
      title = meta?.title ?? ''
      const guidSources = [meta?.guid, ...(meta?.Guid ?? []).map(g => g.id)]
      for (const raw of guidSources) {
        if (!raw) continue
        const m = String(raw).match(/collection[/:](\d+)/i)
        if (m) { tmdbCollectionId = m[1]; break }
      }
    } catch {
      // metadata fetch failed - still try children
    }
    const children = await plexCollections.getCollectionChildren(collectionKey)
    return { title, tmdbCollectionId, children }
  },

  /**
   * Returns the movies inside a Plex Collection (for MediUX set discovery).
   *
   * @param collectionKey - Collection ratingKey.
   * @returns Member movies with external ids.
   */
  async getCollectionChildren(collectionKey: string): Promise<LibraryItem[]> {
    const conn = plexConnection.getConnection()
    if (!conn) return []
    const { baseUrl, token } = conn
    try {
      const data = await plexFetch(
        baseUrl, token,
        `/library/metadata/${collectionKey}/children?includeGuids=1`,
      ) as {
        MediaContainer?: { Metadata?: unknown[] }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data?.MediaContainer?.Metadata ?? []).map((m: any) => ({
        key: m.ratingKey as string,
        title: m.title as string,
        year: m.year as number | undefined,
        type: 'movie' as const,
        thumb: thumbUrl(baseUrl, token, m.thumb as string | undefined),
        ...extractGuids(m),
      }))
    } catch {
      return []
    }
  },
}
