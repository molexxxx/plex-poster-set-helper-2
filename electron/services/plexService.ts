import Fuse from 'fuse.js'
import { Logger } from './logger'
import { ConfigService } from './config'
import type {
  ConnectReq, ConnectRes, Library,
  FindItemReq, PlexItem, UploadReq, UploadRes,
  FindCollectionReq, PlexCollection,
  LabelReq, ResetReq,
  LibrarySection, SectionItemsReq, SectionItemsRes, LibraryItem,
} from '../ipc/types'

// --- Internal state -----------------------------------------------------------

interface PlexConnection {
  baseUrl: string
  token: string
  serverName: string
  libraries: Library[]
}

let _conn: PlexConnection | null = null

// --- Helpers ------------------------------------------------------------------

function plexHeaders(token: string): Record<string, string> {
  return {
    'X-Plex-Token': token,
    'X-Plex-Client-Identifier': ConfigService.get().clientIdentifier,
    'X-Plex-Product': 'Plex Poster Set Helper',
    'Accept': 'application/json',
  }
}

async function plexFetch(
  baseUrl: string,
  token: string,
  path: string,
  options?: RequestInit,
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      ...plexHeaders(token),
      ...(options?.headers as Record<string, string> ?? {}),
    },
  })
  if (!res.ok) throw new Error(`Plex ${res.status} ${res.statusText} - ${path}`)
  const text = await res.text()
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch { return text }
}

// Extract external IDs (tmdb/tvdb/imdb) from a Plex item's guids. Handles both
// the modern Guid[] array (plex agent) and legacy single-guid strings such as
// com.plexapp.agents.themoviedb://1234, com.plexapp.agents.hama://tvdb-458912.
function extractGuids(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  m: any,
): { tmdbId?: string; tvdbId?: string; imdbId?: string } {
  const out: { tmdbId?: string; tvdbId?: string; imdbId?: string } = {}

  const assign = (raw: string) => {
    const s = raw.toLowerCase()
    let mm: RegExpMatchArray | null
    if ((mm = s.match(/tmdb:\/\/(\d+)/)) || (mm = s.match(/themoviedb:\/\/(\d+)/))) out.tmdbId ??= mm[1]
    if ((mm = s.match(/tvdb[:-](\d+)/)) || (mm = s.match(/thetvdb:\/\/(\d+)/)))    out.tvdbId ??= mm[1]
    if ((mm = s.match(/imdb:\/\/(tt\d+)/)))                                         out.imdbId ??= mm[1]
  }

  if (typeof m.guid === 'string') assign(m.guid)
  for (const g of (m.Guid ?? []) as Array<{ id?: string }>) if (g.id) assign(g.id)

  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMetadata(m: any, libraryTitle: string, libraryType: 'movie' | 'show'): PlexItem {
  return {
    key: m.ratingKey as string,
    title: m.title as string,
    year: m.year as number | undefined,
    type: libraryType === 'movie' ? 'movie' : 'show',
    libraryTitle,
    thumb: m.thumb as string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    labels: ((m.Label ?? []) as any[]).map(l => l.tag as string),
  }
}

// --- Service ------------------------------------------------------------------

export const PlexService = {
  getConnection: () => _conn,

  // -- Connect -----------------------------------------------------------------
  async connect(req: ConnectReq): Promise<ConnectRes> {
    try {
      const data = await plexFetch(req.baseUrl, req.token, '/') as { MediaContainer?: { friendlyName?: string } }
      const serverName = data?.MediaContainer?.friendlyName ?? 'Plex Server'
      const libraries = await PlexService.fetchLibraries(req.baseUrl, req.token)
      _conn = { baseUrl: req.baseUrl, token: req.token, serverName, libraries }
      Logger.success('Plex', `Connected to "${serverName}" - ${libraries.length} libraries`)
      return { success: true, serverName, libraryCount: libraries.length }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      Logger.error('Plex', `Connection failed: ${error}`)
      _conn = null
      return { success: false, error }
    }
  },

  // -- Libraries ----------------------------------------------------------------
  async fetchLibraries(baseUrl: string, token: string): Promise<Library[]> {
    const data = await plexFetch(baseUrl, token, '/library/sections') as {
      MediaContainer?: { Directory?: Array<{ key: string; title: string; type: string; agent?: string }> }
    }
    return (data?.MediaContainer?.Directory ?? [])
      .filter(d => d.type === 'movie' || d.type === 'show')
      .map(d => ({ key: d.key, title: d.title, type: d.type as 'movie' | 'show', agent: d.agent }))
  },

  async getLibraryCount(key: string, type: 'movie' | 'show'): Promise<number> {
    if (!_conn) return 0
    const { baseUrl, token } = _conn
    const plexType = type === 'movie' ? 1 : 2
    const data = await plexFetch(
      baseUrl, token,
      `/library/sections/${key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0&type=${plexType}`,
    ) as { MediaContainer?: { totalSize?: number; size?: number } }
    return data?.MediaContainer?.totalSize ?? data?.MediaContainer?.size ?? 0
  },

  // -- Find item (fuzzy) --------------------------------------------------------
  async findInLibrary(req: FindItemReq): Promise<PlexItem | null> {
    if (!_conn) return null
    const { baseUrl, token, libraries: allLibs } = _conn
    const { title, year, libraries: filterNames, type: mediaType } = req

    const excluded = ConfigService.get().excludedLibraries ?? []

    const candidates: PlexItem[] = []
    for (const lib of allLibs) {
      // When an explicit include-list is given, honour it; otherwise apply exclusions
      if (filterNames.length && !filterNames.includes(lib.title)) continue
      if (!filterNames.length && excluded.includes(lib.title)) continue
      // Restrict to the requested media type so a TV show set never matches a
      // same-named movie (e.g. the "Sugar" 2024 show vs the "Sugar" 2008 movie).
      if (mediaType && lib.type !== mediaType) continue
      const type = lib.type === 'movie' ? 1 : 2
      try {
        const data = await plexFetch(
          baseUrl, token,
          `/library/sections/${lib.key}/search?query=${encodeURIComponent(title)}&type=${type}&limit=20`,
        ) as { MediaContainer?: { Metadata?: unknown[] } }
        for (const m of data?.MediaContainer?.Metadata ?? []) {
          candidates.push(mapMetadata(m, lib.title, lib.type as 'movie' | 'show'))
        }
      } catch {
        // section may not support the search type - skip silently
      }
    }
    if (!candidates.length) return null

    // Exact title + year match
    const exact = candidates.find(
      i => i.title.toLowerCase() === title.toLowerCase() && (!year || i.year === year),
    )
    if (exact) return exact

    // Exact title only (when no year given or source year is unreliable)
    if (!year) {
      const exactTitle = candidates.find(i => i.title.toLowerCase() === title.toLowerCase())
      if (exactTitle) return exactTitle
    }

    // Fuzzy fallback: when a year is provided, only consider candidates within ±1
    // year so that e.g. "Toy Story (1995)" never fuzzy-matches "Toy Story 2 (1999)".
    const pool = year
      ? candidates.filter(c => c.year != null && Math.abs(c.year - year) <= 1)
      : candidates
    if (!pool.length) return null
    const fuse = new Fuse(pool, { keys: ['title'], threshold: 0.35 })
    return fuse.search(title)[0]?.item ?? null
  },

  // -- Find a Plex Collection by name (for boxset collection art) ----------------
  // MediUX boxsets include "collection sets" (e.g. "Toy Story Collection") whose
  // posters apply to a Plex Collection object, not an individual movie. Plex
  // auto-names these collections after the TMDB collection, so we match by title.
  async findCollection(req: FindCollectionReq): Promise<PlexCollection | null> {
    if (!_conn) return null
    const { baseUrl, token, libraries: allLibs } = _conn
    const title = req.title.trim()
    if (!title) return null

    // Also try a "<name>" without a trailing "Collection" word, since some users
    // rename Plex collections (e.g. "Toy Story" instead of "Toy Story Collection").
    const altTitle = title.replace(/\s+Collection$/i, '').trim()

    const candidates: PlexCollection[] = []
    for (const lib of allLibs) {
      if (lib.type !== 'movie' && lib.type !== 'show') continue
      try {
        const data = await plexFetch(
          baseUrl, token,
          `/library/sections/${lib.key}/collections`,
        ) as { MediaContainer?: { Metadata?: Array<{ ratingKey?: string; title?: string; childCount?: number; thumb?: string }> } }
        for (const c of data?.MediaContainer?.Metadata ?? []) {
          if (!c.ratingKey || !c.title) continue
          candidates.push({
            key: c.ratingKey,
            title: c.title,
            libraryTitle: lib.title,
            childCount: c.childCount,
            thumb: c.thumb,
          })
        }
      } catch {
        // section may not support collections - skip silently
      }
    }
    if (!candidates.length) return null

    const lc = title.toLowerCase()
    const lcAlt = altTitle.toLowerCase()
    // Exact match on the full name, then on the suffix-stripped name.
    const exact = candidates.find(c => c.title.toLowerCase() === lc)
      ?? candidates.find(c => c.title.toLowerCase() === lcAlt)
    if (exact) return exact

    // Fuzzy fallback on the full collection name.
    const fuse = new Fuse(candidates, { keys: ['title'], threshold: 0.3 })
    return fuse.search(title)[0]?.item ?? null
  },

  // -- Library browser: sections ------------------------------------------------
  async getSections(): Promise<LibrarySection[]> {
    if (!_conn) return []
    const excluded = ConfigService.get().excludedLibraries ?? []
    return _conn.libraries
      .filter(l => (l.type === 'movie' || l.type === 'show') && !excluded.includes(l.title))
      .map(l => ({ key: l.key, title: l.title, type: l.type as 'movie' | 'show' }))
  },

  // -- Library browser: paginated items with external IDs -----------------------
  async getSectionItems(req: SectionItemsReq): Promise<SectionItemsRes> {
    if (!_conn) return { items: [], total: 0 }
    const { baseUrl, token, libraries } = _conn
    const lib = libraries.find(l => l.key === req.sectionKey)
    if (!lib) return { items: [], total: 0 }

    const type = lib.type === 'movie' ? 1 : 2
    const params = new URLSearchParams({
      type: String(type),
      includeGuids: '1',
      'X-Plex-Container-Start': String(req.offset),
      'X-Plex-Container-Size': String(req.limit),
      sort: 'titleSort',
    })
    if (req.search?.trim()) params.set('title', req.search.trim())

    const data = await plexFetch(
      baseUrl, token,
      `/library/sections/${lib.key}/all?${params.toString()}`,
    ) as { MediaContainer?: { totalSize?: number; size?: number; Metadata?: unknown[] } }

    const mc = data?.MediaContainer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: LibraryItem[] = (mc?.Metadata ?? []).map((m: any) => {
      const guids = extractGuids(m)
      const thumbPath = m.thumb as string | undefined
      const thumb = thumbPath
        ? `${baseUrl.replace(/\/$/, '')}/photo/:/transcode?width=240&height=360&minSize=1&upscale=1&url=${encodeURIComponent(thumbPath)}&X-Plex-Token=${token}`
        : undefined
      return {
        key: m.ratingKey as string,
        title: m.title as string,
        year: m.year as number | undefined,
        type: lib.type as 'movie' | 'show',
        thumb,
        ...guids,
      }
    })

    return { items, total: mc?.totalSize ?? mc?.size ?? items.length }
  },

  // -- Library browser: resolve a TMDB id (direct, or via tvdb/imdb + key) -------
  async resolveTmdbId(item: LibraryItem): Promise<string | null> {
    if (item.tmdbId) return item.tmdbId

    const key = ConfigService.get().tmdbApiKey?.trim()
    if (!key) return null

    const external = item.tvdbId
      ? { source: 'tvdb_id', value: item.tvdbId }
      : item.imdbId ? { source: 'imdb_id', value: item.imdbId } : null
    if (!external) return null

    try {
      const url = `https://api.themoviedb.org/3/find/${external.value}?external_source=${external.source}&api_key=${key}`
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return null
      const body = await res.json() as {
        movie_results?: Array<{ id: number }>
        tv_results?: Array<{ id: number }>
      }
      const hit = item.type === 'movie' ? body.movie_results?.[0] : body.tv_results?.[0]
      return hit ? String(hit.id) : null
    } catch (err) {
      Logger.warn('Plex', `TMDB resolve failed: ${err instanceof Error ? err.message : err}`)
      return null
    }
  },

  // -- Labeled items ------------------------------------------------------------
  async getLabeledItems(req: LabelReq): Promise<PlexItem[]> {
    if (!_conn) return []
    const { baseUrl, token, libraries: allLibs } = _conn
    const items: PlexItem[] = []

    for (const lib of allLibs) {
      const type = lib.type === 'movie' ? 1 : 2
      try {
        const data = await plexFetch(
          baseUrl, token,
          `/library/sections/${lib.key}/all?type=${type}&label.tag.tag=${encodeURIComponent(req.label)}`,
        ) as { MediaContainer?: { Metadata?: unknown[] } }
        for (const m of data?.MediaContainer?.Metadata ?? []) {
          const item = mapMetadata(m, lib.title, lib.type as 'movie' | 'show')
          // Build a full, token-bearing transcode URL so thumbs load in the UI
          if (item.thumb) {
            item.thumb = `${baseUrl.replace(/\/$/, '')}/photo/:/transcode?width=120&height=180&minSize=1&upscale=1&url=${encodeURIComponent(item.thumb)}&X-Plex-Token=${token}`
          }
          items.push(item)
        }
      } catch {
        // label filter unsupported on this section version - skip
      }
    }
    return items
  },

  // -- Resolve the real target (show / season / episode) for a poster ----------
  // Given the show's ratingKey plus optional season/episode hints, walk the
  // Plex hierarchy to find the ratingKey the poster should actually apply to,
  // and whether it's a poster or a background ("art", for backdrops).
  async resolveTarget(
    showKey: string,
    season?: number | 'Cover' | 'Backdrop',
    episode?: number,
  ): Promise<{ key: string; kind: 'poster' | 'art' } | { kind: 'skip'; reason: string }> {
    if (!_conn) return { key: showKey, kind: 'poster' }
    const { baseUrl, token } = _conn

    // Backdrop → the show's background art
    if (season === 'Backdrop') return { key: showKey, kind: 'art' }

    // Show-level cover / no season info → the show poster itself
    if (season == null || season === 'Cover') return { key: showKey, kind: 'poster' }

    // Numeric season → find the season child by its index
    try {
      const seasonData = await plexFetch(baseUrl, token, `/library/metadata/${showKey}/children`) as {
        MediaContainer?: { Metadata?: Array<{ ratingKey: string; index?: number }> }
      }
      const seasons = seasonData?.MediaContainer?.Metadata ?? []
      const seasonNode = seasons.find(s => s.index === season)
      // Season not in this library → skip rather than clobbering the show poster
      // with a season poster / title card the user can't actually use.
      if (!seasonNode) {
        Logger.warn('Plex', `Season ${season} not found under show ${showKey} - skipping`)
        return { kind: 'skip', reason: `Season ${season} not in library` }
      }

      // No episode → the season poster
      if (episode == null) return { key: seasonNode.ratingKey, kind: 'poster' }

      // Episode → find the episode child by its index
      const epData = await plexFetch(baseUrl, token, `/library/metadata/${seasonNode.ratingKey}/children`) as {
        MediaContainer?: { Metadata?: Array<{ ratingKey: string; index?: number }> }
      }
      const episodes = epData?.MediaContainer?.Metadata ?? []
      const epNode = episodes.find(e => e.index === episode)
      // Episode not in this library → skip rather than overwriting the season
      // poster with this episode's title card (the cause of "all cards on the
      // season poster" when a set has more episodes than Plex has).
      if (!epNode) {
        Logger.warn('Plex', `S${season}E${episode} not found - skipping`)
        return { kind: 'skip', reason: `S${season}E${episode} not in library` }
      }
      return { key: epNode.ratingKey, kind: 'poster' }
    } catch (err) {
      Logger.warn('Plex', `Target resolution failed for show ${showKey}: ${err instanceof Error ? err.message : err}`)
      return { key: showKey, kind: 'poster' }
    }
  },

  // -- Upload poster ------------------------------------------------------------
  async uploadPoster(req: UploadReq): Promise<UploadRes> {
    if (!_conn) return { success: false, error: 'Not connected to Plex' }
    const { baseUrl, token } = _conn
    const { itemKey, imageUrl, source, season, episode } = req
    const labelTag = source === 'mediux' ? 'MediUX' : 'ThePosterDB'

    try {
      // Resolve the real target (season/episode) before uploading
      const target = await PlexService.resolveTarget(itemKey, season, episode)
      // The requested season/episode doesn't exist in this library - skip cleanly
      // instead of misapplying the art to a parent (season/show) poster.
      if (target.kind === 'skip') {
        Logger.scrape('Plex', `Skipped upload - ${target.reason} (key ${itemKey})`)
        return { success: false, error: target.reason }
      }
      const endpoint = target.kind === 'art' ? 'arts' : 'posters'

      // Download image from source URL
      const imgRes = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      })
      if (!imgRes.ok) throw new Error(`Image download failed: ${imgRes.status}`)
      const imgBuf = Buffer.from(await imgRes.arrayBuffer())
      const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg'

      // Upload binary to the resolved target (poster or background art)
      await plexFetch(baseUrl, token, `/library/metadata/${target.key}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: imgBuf,
      })

      // Tag the show (itemKey) with the source label for later reset/stats
      await plexFetch(
        baseUrl, token,
        `/library/metadata/${itemKey}?label[].tag.tag=${encodeURIComponent(labelTag)}&label.locked=1`,
        { method: 'PUT' },
      )

      const where = target.key === itemKey
        ? 'show' : `S${season ?? '?'}${episode != null ? `E${episode}` : ''}`
      Logger.success('Plex', `${target.kind} uploaded → ${where} (key ${target.key}) [${source}]`)
      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      Logger.error('Plex', `Upload failed - key ${itemKey}: ${error}`)
      return { success: false, error }
    }
  },

  // -- Reset poster -------------------------------------------------------------
  async resetPoster(req: ResetReq): Promise<void> {
    if (!_conn) throw new Error('Not connected to Plex')
    const { baseUrl, token } = _conn
    const { itemKey, hierarchical } = req

    // Get available posters and select the original provider poster
    const postersData = await plexFetch(baseUrl, token, `/library/metadata/${itemKey}/posters`) as {
      MediaContainer?: { Metadata?: Array<{ ratingKey?: string; thumb?: string; selected?: boolean; provider?: string }> }
    }
    const posters = postersData?.MediaContainer?.Metadata ?? []

    // Find any poster that isn't from the custom upload provider
    const original = posters.find(p => {
      const src = p.provider ?? ''
      return src !== 'custom' && src !== ''
    }) ?? posters.find(p => !p.selected)

    if (original) {
      const posterKey = original.ratingKey ?? original.thumb ?? ''
      if (posterKey) {
        await plexFetch(
          baseUrl, token,
          `/library/metadata/${itemKey}/poster?url=${encodeURIComponent(posterKey)}`,
          { method: 'PUT' },
        )
      }
    }

    // Remove source labels
    for (const label of ['MediUX', 'ThePosterDB']) {
      try {
        await plexFetch(
          baseUrl, token,
          `/library/metadata/${itemKey}?label[].tag.tag=${encodeURIComponent(label)}&label[].tag.locked=0`,
          { method: 'PUT' },
        )
      } catch {
        // label may not exist on this item
      }
    }

    // Recurse into children (seasons → episodes) when hierarchical
    if (hierarchical) {
      try {
        const childData = await plexFetch(baseUrl, token, `/library/metadata/${itemKey}/children`) as {
          MediaContainer?: { Metadata?: Array<{ ratingKey: string }> }
        }
        for (const child of childData?.MediaContainer?.Metadata ?? []) {
          await PlexService.resetPoster({ itemKey: child.ratingKey, hierarchical: true })
        }
      } catch {
        // no children or server error - skip
      }
    }

    Logger.info('Plex', `Poster reset - key ${itemKey}`)
  },

  // -- Stats --------------------------------------------------------------------
  async getStats(): Promise<Record<string, number>> {
    const [mediuxItems, posterdbItems] = await Promise.all([
      PlexService.getLabeledItems({ label: 'MediUX' }),
      PlexService.getLabeledItems({ label: 'ThePosterDB' }),
    ])
    const all = [...mediuxItems, ...posterdbItems]
    return {
      mediux:   mediuxItems.length,
      posterdb: posterdbItems.length,
      total:    all.length,
      movies:   all.filter(i => i.type === 'movie').length,
      shows:    all.filter(i => i.type === 'show').length,
    }
  },

  // -- Auto-reconnect from saved config -----------------------------------------
  async tryRestoreFromConfig(): Promise<{ success: boolean; serverName?: string; tokenInvalid?: boolean }> {
    const cfg = ConfigService.get()
    if (!cfg.baseUrl || !cfg.token) return { success: false }
    const result = await PlexService.connect({ baseUrl: cfg.baseUrl, token: cfg.token })
    if (!result.success && result.error?.includes('401')) {
      // Token was revoked (e.g. password change) - clear it so the UI prompts re-auth
      ConfigService.set({ token: '', plexAccountName: '', plexAccountEmail: '', plexAccountThumb: '' })
      Logger.warn('Plex', 'Stored token rejected (401) - cleared. Please sign in again.')
      return { success: false, tokenInvalid: true }
    }
    return { success: result.success, serverName: result.serverName }
  },
}
