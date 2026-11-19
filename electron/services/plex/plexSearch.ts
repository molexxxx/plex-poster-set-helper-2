import Fuse from 'fuse.js'
import { ConfigService } from '../config'
import { mappedPlexTitle, normTitle, pickLibraryMatch, pickMappedItem } from '../libraryMatch'
import type { FindItemReq, PlexItem, FindCollectionReq, PlexCollection, LabelReq } from '../../ipc/types'
import { plexConnection } from './plexConnection'
import { plexFetch } from './plexHttp'
import { thumbUrl, stripCollectionSuffix, mapMetadata, broadenTitle } from './plexMetadata'

/** Finding titles, collections, and labeled items in the Plex library. */
export const plexSearch = {
  /**
   * Finds a library item by title (and optional year). A library item with the
   * poster's TMDB id wins; then a Title Mappings entry for the title, when its
   * year and id agree with the poster; then exact titles, falling back to a
   * fuzzy search.
   *
   * @param req - Title, optional year, library include-list, and media type.
   * @returns The best match, or null when nothing qualifies.
   */
  async findInLibrary(req: FindItemReq): Promise<PlexItem | null>
  {
    const conn = plexConnection.getConnection()
    if (!conn) return null
    const { baseUrl, token, libraries: allLibs } = conn
    const { title, year, libraries: filterNames, type: mediaType, tmdbId } = req

    const excluded = ConfigService.get().excludedLibraries ?? []

    // Libraries eligible for this lookup: an explicit include-list wins, else
    // exclusions apply, and the requested media type is honoured so a TV show set
    // never matches a same-named movie ("Sugar" 2024 show vs "Sugar" 2008 movie).
    const searchLibs = allLibs.filter(lib =>
    {
      if (filterNames.length && !filterNames.includes(lib.title)) return false
      if (!filterNames.length && excluded.includes(lib.title)) return false
      if (mediaType && lib.type !== mediaType) return false
      return true
    })

    // Runs Plex's relevance search for one query across every eligible library.
    const gather = async (query: string): Promise<PlexItem[]> =>
    {
      const found: PlexItem[] = []
      for (const lib of searchLibs)
      {
        const type = lib.type === 'movie' ? 1 : 2
        try
        {
          const data = await plexFetch(
            baseUrl, token,
            `/library/sections/${lib.key}/search?query=${encodeURIComponent(query)}&type=${type}&limit=20&includeGuids=1`,
          ) as { MediaContainer?: { Metadata?: unknown[] } }
          for (const m of data?.MediaContainer?.Metadata ?? [])
          {
            found.push(mapMetadata(m, lib.title, lib.type as 'movie' | 'show'))
          }
        }
        catch
        {
          // section may not support the search type - skip silently
        }
      }
      return found
    }

    const candidates = await gather(title)
    const byId = tmdbId ? candidates.find(c => c.tmdbId === tmdbId) : undefined
    if (byId) return byId

    const mappedTitle = mappedPlexTitle(ConfigService.get().titleMappings, title, year)
    if (mappedTitle)
    {
      const mapped = pickMappedItem(await gather(mappedTitle), mappedTitle, { year, tmdbId })
      if (mapped) return mapped
    }

    const picked = pickLibraryMatch(candidates, { title, year, tmdbId })
    if (picked) return picked
    const wanted = normTitle(title)

    // Last resort when the TMDB id is known: Plex's relevance search can drop a
    // long, subtitled franchise entry ("The Librarian: The Curse of the Judas
    // Chalice") even though it's in the library, so the candidate never appears
    // to match against. Re-search with just the main title to pull it into the
    // pool, then match strictly by id.
    if (tmdbId)
    {
      const broad = broadenTitle(title)
      if (broad && normTitle(broad) !== wanted)
      {
        const byTmdb = (await gather(broad)).find(c => c.tmdbId === tmdbId)
        if (byTmdb) return byTmdb
      }
    }

    return null
  },

  /**
   * Finds a Plex Collection by name (for boxset collection art). MediUX boxsets
   * include "collection sets" (e.g. "Toy Story Collection") whose posters apply
   * to a Plex Collection object, not an individual movie. Plex auto-names these
   * collections after the TMDB collection, so matching is done by title.
   *
   * @param req - The collection name to match.
   * @returns The matched collection, or null.
   */
  async findCollection(req: FindCollectionReq): Promise<PlexCollection | null>
  {
    const conn = plexConnection.getConnection()
    if (!conn) return null
    const { baseUrl, token, libraries: allLibs } = conn
    const title = req.title.trim()
    if (!title) return null

    // Some users rename Plex collections without the trailing "Collection" word
    // (e.g. "Toy Story" instead of "Toy Story Collection")
    const altTitle = stripCollectionSuffix(title)

    const candidates: PlexCollection[] = []
    for (const lib of allLibs)
    {
      if (lib.type !== 'movie' && lib.type !== 'show') continue
      try
      {
        const data = await plexFetch(
          baseUrl, token,
          `/library/sections/${lib.key}/collections`,
        ) as { MediaContainer?: { Metadata?: Array<{ ratingKey?: string; title?: string; childCount?: number; thumb?: string }> } }
        for (const c of data?.MediaContainer?.Metadata ?? [])
        {
          if (!c.ratingKey || !c.title) continue
          candidates.push({
            key: c.ratingKey,
            title: c.title,
            libraryTitle: lib.title,
            childCount: c.childCount,
            thumb: c.thumb,
          })
        }
      }
      catch
      {
        // section may not support collections - skip silently
      }
    }
    if (!candidates.length) return null

    const lc = title.toLowerCase()
    const lcAlt = altTitle.toLowerCase()
    const exact = candidates.find(c => c.title.toLowerCase() === lc)
      ?? candidates.find(c => c.title.toLowerCase() === lcAlt)
    if (exact) return exact

    const fuse = new Fuse(candidates, { keys: ['title'], threshold: 0.3 })
    const best = fuse.search(title)[0]?.item
    if (!best) return null
    // Guard the fuzzy result: only accept it when the normalised collection
    // title contains (or is contained by) the normalised query. This still
    // allows "Toy Story" -> "Toy Story Collection" but rejects loose lookalike
    // hits such as "8 Mile" -> "One Mile Collection".
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const nc = norm(best.title)
    const accepted = [norm(title), norm(altTitle)]
      .filter(Boolean)
      .some(nq => nc.includes(nq) || nq.includes(nc))
    return accepted ? best : null
  },

  /**
   * Resolves a Plex Collection by its exact name (case-insensitive), optionally
   * scoped to a single library section. Maps a movie's real collection
   * membership (its metadata Collection tags) to the collection's key, thumb
   * and children with no fuzzy matching, so lookalike titles are never picked
   * up. Scoping to the item's own library also avoids listing collections in
   * every library.
   */
  async resolveCollectionByName(name: string, librarySectionId?: string): Promise<PlexCollection | null>
  {
    const conn = plexConnection.getConnection()
    if (!conn) return null
    const { baseUrl, token, libraries: allLibs } = conn
    const wanted = name.trim().toLowerCase()
    if (!wanted) return null
    const scoped = librarySectionId
      ? allLibs.filter(l => String(l.key) === String(librarySectionId))
      : []
    const libs = scoped.length ? scoped : allLibs
    for (const lib of libs)
    {
      if (lib.type !== 'movie' && lib.type !== 'show') continue
      try
      {
        const data = await plexFetch(
          baseUrl, token,
          `/library/sections/${lib.key}/collections`,
        ) as { MediaContainer?: { Metadata?: Array<{ ratingKey?: string; title?: string; childCount?: number; thumb?: string; smart?: string | number }> } }
        for (const c of data?.MediaContainer?.Metadata ?? [])
        {
          if (!c.ratingKey || !c.title) continue
          if (c.title.trim().toLowerCase() === wanted)
          {
            return {
              key: c.ratingKey,
              title: c.title,
              libraryTitle: lib.title,
              childCount: c.childCount,
              thumb: c.thumb,
              smart: c.smart === '1' || c.smart === 1,
            }
          }
        }
      }
      catch
      {
        // section may not support collections - skip silently
      }
    }
    return null
  },

  /**
   * Returns all items tagged with the given label across every library.
   *
   * @param req - The label to filter on.
   * @returns Matching items with display-ready thumb URLs.
   */
  async getLabeledItems(req: LabelReq): Promise<PlexItem[]>
  {
    const conn = plexConnection.getConnection()
    if (!conn) return []
    const { baseUrl, token, libraries: allLibs } = conn
    const items: PlexItem[] = []

    for (const lib of allLibs)
    {
      const type = lib.type === 'movie' ? 1 : 2
      try
      {
        const data = await plexFetch(
          baseUrl, token,
          `/library/sections/${lib.key}/all?type=${type}&label.tag.tag=${encodeURIComponent(req.label)}`,
        ) as { MediaContainer?: { Metadata?: unknown[] } }
        for (const m of data?.MediaContainer?.Metadata ?? [])
        {
          const item = mapMetadata(m, lib.title, lib.type as 'movie' | 'show')
          item.thumb = thumbUrl(baseUrl, token, item.thumb, 120, 180)
          items.push(item)
        }
      }
      catch
      {
        // label filter unsupported on this section version - skip
      }
    }
    return items
  },
}
