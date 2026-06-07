import type { IpcMain } from 'electron'
import { PlexService } from '../services/plexService'
import { ScraperFactory } from '../scrapers/scraperFactory'
import { Logger } from '../services/logger'
import type { SectionItemsReq, BrowseSetsReq, BrowseSetsRes, UserSetsReq, UserSetsRes } from './types'

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

      // Resolve which of these titles exist in the user's Plex library
      const resolved = await Promise.all(sets.map(async s => {
        if (!s.title) return s
        const match = await PlexService.findInLibrary({ title: s.title, year: s.year, libraries: [] })
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
}
