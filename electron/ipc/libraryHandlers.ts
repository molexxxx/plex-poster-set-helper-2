import type { IpcMain } from 'electron'
import { PlexService } from '../services/plexService'
import { ScraperFactory } from '../scrapers/scraperFactory'
import { Logger } from '../services/logger'
import type { SectionItemsReq, BrowseSetsReq, BrowseSetsRes, UserSetsReq, UserSetsRes, CreatorSearchReq, MediuxUserSet } from './types'

export function registerLibraryHandlers(ipcMain: IpcMain) {
  ipcMain.handle('library:sections', () => PlexService.getSections())

  ipcMain.handle('library:items', (_e, req: SectionItemsReq) =>
    PlexService.getSectionItems(req),
  )

  ipcMain.handle('library:sets', async (_e, req: BrowseSetsReq): Promise<BrowseSetsRes> => {
    try {
      // Resolve a TMDB id: direct, or via tvdb/imdb when a TMDB key is configured
      const tmdbId = await PlexService.resolveTmdbId({
        key: '', title: '', type: req.type,
        tmdbId: req.tmdbId, tvdbId: req.tvdbId, imdbId: req.imdbId,
      })
      if (!tmdbId) return { sets: [], error: 'no_tmdb' }

      const sets = await ScraperFactory.browseMediux(tmdbId, req.type)
      return { sets, tmdbId }
    } catch (err) {
      Logger.error('Library', `browseMediux failed: ${err instanceof Error ? err.message : err}`)
      return { sets: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('library:userSets', async (_e, req: UserSetsReq): Promise<UserSetsRes> => {
    const page = Math.max(1, req.page ?? 1)
    try {
      const sets = await ScraperFactory.browseMediuxUser(req.username, page)

      // Resolve which of these titles exist in the user's Plex library, restricting
      // to the set's detected media type so TV shows never match same-named movies.
      const resolved = await Promise.all(sets.map(async s => {
        if (!s.title) return s
        const match = await PlexService.findInLibrary({ title: s.title, year: s.year, libraries: [], type: s.mediaType })
        return match ? { ...s, matchedKey: match.key, matchedType: match.type as 'movie' | 'show' } : s
      }))

      // Cumulative pages return N×12; if we got a full page, more likely exist.
      const hasMore = resolved.length >= page * 12
      return { username: req.username, sets: resolved, page, hasMore }
    } catch (err) {
      Logger.error('Library', `browseMediuxUser failed: ${err instanceof Error ? err.message : err}`)
      return { username: req.username, sets: [], page, hasMore: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Deep search: MediUX only browse-serves a creator's newest ~24 sets, so to find
  // their art for OLDER titles we search the user's library for the query, then
  // fetch each matched title's sets and keep the ones uploaded by this creator.
  ipcMain.handle('library:creatorSearch', async (_e, req: CreatorSearchReq): Promise<UserSetsRes> => {
    const username = req.username
    const q = req.query.trim()
    if (q.length < 2) return { username, sets: [], page: 1, hasMore: false }
    try {
      const target = username.toLowerCase()
      const sections = await PlexService.getSections()

      // Gather library items matching the query (a few per section).
      const items = []
      for (const sec of sections) {
        const res = await PlexService.getSectionItems({ sectionKey: sec.key, offset: 0, limit: 6, search: q })
        items.push(...res.items)
        if (items.length >= 12) break
      }

      // For each match, pull the title's sets and keep this creator's.
      const out: MediuxUserSet[] = []
      const seen = new Set<string>()
      for (const item of items.slice(0, 10)) {
        const tmdbId = await PlexService.resolveTmdbId({
          key: item.key, title: item.title, type: item.type,
          tmdbId: item.tmdbId, tvdbId: item.tvdbId, imdbId: item.imdbId,
        })
        if (!tmdbId) continue
        const sets = await ScraperFactory.browseMediux(tmdbId, item.type)
        for (const s of sets) {
          if (s.uploader.toLowerCase() !== target || seen.has(s.id)) continue
          seen.add(s.id)
          out.push({ ...s, title: item.title, year: item.year, matchedKey: item.key, matchedType: item.type })
        }
      }
      return { username, sets: out, page: 1, hasMore: false }
    } catch (err) {
      Logger.error('Library', `creatorSearch failed: ${err instanceof Error ? err.message : err}`)
      return { username, sets: [], page: 1, hasMore: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
