import { isWebMode } from '../../runtime/runtime'
import type { PlexItem } from '../../ipc/types'

/**
 * Extracts external IDs (tmdb/tvdb/imdb) from a Plex item's guids. Handles both
 * the modern Guid[] array (plex agent) and legacy single-guid strings such as
 * com.plexapp.agents.themoviedb://1234 or com.plexapp.agents.hama://tvdb-458912.
 *
 * @param m - Raw Plex metadata node.
 * @returns Whichever of tmdbId / tvdbId / imdbId could be parsed.
 */
export function extractGuids(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  m: any,
): { tmdbId?: string; tvdbId?: string; imdbId?: string; anidbId?: string } {
  const out: { tmdbId?: string; tvdbId?: string; imdbId?: string; anidbId?: string } = {}

  const assign = (raw: string) => {
    const s = raw.toLowerCase()
    let mm: RegExpMatchArray | null
    if ((mm = s.match(/tmdb:\/\/(\d+)/)) || (mm = s.match(/themoviedb:\/\/(\d+)/))) out.tmdbId ??= mm[1]
    if ((mm = s.match(/tvdb[:-](\d+)/)) || (mm = s.match(/thetvdb:\/\/(\d+)/)))    out.tvdbId ??= mm[1]
    if ((mm = s.match(/imdb:\/\/(tt\d+)/)) || (mm = s.match(/imdb-(tt\d+)/)))       out.imdbId ??= mm[1]
    // HAMA's primary id for most anime (e.g. com.plexapp.agents.hama://anidb-47).
    if ((mm = s.match(/anidb[:-](\d+)/)))                                           out.anidbId ??= mm[1]
  }

  if (typeof m.guid === 'string') assign(m.guid)
  for (const g of (m.Guid ?? []) as Array<{ id?: string }>) if (g.id) assign(g.id)

  return out
}

/**
 * Builds a display URL for a Plex image. The desktop window loads it straight
 * from the server. The web UI loads it through this app instead, because the
 * browser may not reach the address the app uses, such as a Docker bridge IP
 * or a LAN address seen from outside the LAN.
 *
 * @param baseUrl - Server base URL.
 * @param token - Plex auth token.
 * @param thumbPath - Server-relative image path from Plex metadata.
 * @param w - Output width in pixels.
 * @param h - Output height in pixels.
 * @returns The URL, or undefined when the item has no image.
 */
export function thumbUrl(baseUrl: string, token: string, thumbPath: string | undefined, w = 240, h = 360): string | undefined
{
  if (!thumbPath) return undefined
  if (isWebMode()) return `/api/plex/photo?width=${w}&height=${h}&url=${encodeURIComponent(thumbPath)}`
  return `${baseUrl.replace(/\/$/, '')}/photo/:/transcode?width=${w}&height=${h}&minSize=1&upscale=1&url=${encodeURIComponent(thumbPath)}&X-Plex-Token=${token}`
}

/**
 * Clamps a requested image dimension.
 *
 * @param value - Requested size in pixels.
 * @param fallback - Size used when the request is missing or invalid.
 * @returns A whole number of pixels between 1 and 2000.
 */
export function photoSize(value: number, fallback: number): number
{
  return Number.isFinite(value) && value >= 1 ? Math.min(Math.round(value), 2000) : fallback
}

/**
 * Strips a trailing " Collection" word from a title in linear time. Avoids the
 * `/\s+Collection$/` form, whose `\s+` backtracks quadratically on a long
 * whitespace-only input (a ReDoS sink for the API-supplied collection title).
 *
 * @param s - Title to normalise (assumed already trimmed).
 * @returns The title without a trailing whitespace + "Collection" suffix.
 */
export function stripCollectionSuffix(s: string): string {
  if (!s.toLowerCase().endsWith('collection')) return s
  const head = s.slice(0, s.length - 'collection'.length)
  return /\s$/.test(head) ? head.trimEnd() : s
}

/**
 * Maps raw Plex metadata into a PlexItem.
 *
 * @param m - Raw Plex metadata node.
 * @param libraryTitle - Title of the owning library.
 * @param libraryType - Library type, which decides the item type.
 * @returns The normalised item.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMetadata(m: any, libraryTitle: string, libraryType: 'movie' | 'show'): PlexItem {
  return {
    key: m.ratingKey as string,
    title: m.title as string,
    year: m.year as number | undefined,
    type: libraryType === 'movie' ? 'movie' : 'show',
    libraryTitle,
    thumb: m.thumb as string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    labels: ((m.Label ?? []) as any[]).map(l => l.tag as string),
    ...extractGuids(m),
  }
}

/**
 * Reduces a title to a broader query for a second-pass library lookup: the part
 * before a subtitle separator (colon, then a spaced dash), or the first few
 * words. Recovers franchise entries Plex's relevance search drops for the full
 * title (e.g. "The Librarian: The Curse of the Judas Chalice").
 *
 * @param title - Full title.
 * @returns A shorter query, or null when no useful reduction exists.
 */
export function broadenTitle(title: string): string | null {
  const t = title.trim()
  const colon = t.indexOf(':')
  if (colon > 1) return t.slice(0, colon).trim()
  const dash = t.indexOf(' - ')
  if (dash > 1) return t.slice(0, dash).trim()
  const words = t.split(/\s+/)
  if (words.length > 3) return words.slice(0, 3).join(' ')
  return null
}
