import { Logger } from '../logger'
import { ConfigService } from '../config'
import { AnimeMappingService } from '../animeMappingService'
import type { LibraryItem } from '../../ipc/types'

/** TMDB ids for Plex items and for the collections their movies belong to. */
export const plexIds = {
  /**
   * Resolves an item's TMDB id: direct, or via tvdb/imdb lookup when a TMDB
   * API key is configured.
   *
   * @param item - Library item carrying whatever external IDs Plex exposed.
   * @returns The TMDB id, or null when it can't be resolved.
   */
  /**
   * Looks up a TMDB collection id from a member movie (Plex collections often
   * only carry a Plex uuid guid, not tmdb://collection/…).
   */
  async resolveTmdbCollectionId(movieTmdbId: string): Promise<string | null> {
    const key = ConfigService.get().tmdbApiKey?.trim()
    if (!key) return null
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/movie/${movieTmdbId}?api_key=${key}`,
        { signal: AbortSignal.timeout(15_000) },
      )
      if (!res.ok) return null
      const body = await res.json() as { belongs_to_collection?: { id?: number } }
      const id = body.belongs_to_collection?.id
      return id ? String(id) : null
    } catch (err) {
      Logger.warn('Plex', `TMDB collection resolve failed: ${err instanceof Error ? err.message : err}`)
      return null
    }
  },

  async resolveTmdbId(item: LibraryItem): Promise<string | null> {
    if (item.tmdbId) return item.tmdbId

    let { tvdbId, imdbId } = item

    // HAMA anime carry an AniDB id that TMDB's /find can't resolve. Map it via
    // the Fribb dataset: most entries yield a direct TMDB id (no key needed),
    // and the rest backfill a tvdb/imdb id for the /find path below.
    if (item.anidbId) {
      const mapped = await AnimeMappingService.resolve(item.anidbId)
      if (mapped?.tmdbId) return mapped.tmdbId
      tvdbId ??= mapped?.tvdbId
      imdbId ??= mapped?.imdbId
    }

    const key = ConfigService.get().tmdbApiKey?.trim()
    if (!key) return null

    const external = tvdbId
      ? { source: 'tvdb_id', value: tvdbId }
      : imdbId ? { source: 'imdb_id', value: imdbId } : null
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
}
