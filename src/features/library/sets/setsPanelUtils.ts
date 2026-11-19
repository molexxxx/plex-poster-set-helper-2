import type { BrowseSetsRes, LibraryItem, PlexArtSlot, PosterInfo, SetSource } from '../../../../electron/ipc/types'
/** The sites the panel asks, in the order their sets are listed. */
export const SOURCES: SetSource[] = ['mediux', 'posterdb']

/**
 * A site's own failure to answer, as opposed to the panel-level notices
 * (no TMDB id, no movies) that describe the title rather than the site.
 *
 * @param src - The site that was asked.
 * @param res - Its answer.
 * @returns The reason it could not be searched, if any.
 */
export function sourceFailure(src: SetSource, res: BrowseSetsRes): string | undefined
{
  if (res.sourceErrors?.[src]) return res.sourceErrors[src]
  return res.error && res.error !== 'no_tmdb' && res.error !== 'no_movies' ? res.error : undefined
}

/** Human label for an art slot's kind, shown under the lightbox image. */
export const ART_KIND_LABEL: Record<PlexArtSlot['kind'], string> = {
  collection: 'Collection',
  movie: 'Movie',
  show: 'Show',
  season: 'Season',
}

/**
 * Upsizes a Plex thumb transcode URL for a crisp full-screen lightbox view.
 * The strip requests small posters (240x360); Plex transcodes from the full-res
 * source, so asking for a larger size yields a genuinely sharper image.
 *
 * @param thumb - The slot's transcode thumb URL.
 * @returns The same URL with the transcode dimensions bumped up.
 */
export function hiResArt(thumb: string): string
{
  return thumb.replace(/width=\d+&height=\d+/, 'width=800&height=1200')
}

/** The panel's width in pixels until the user resizes it. */
export const PANEL_WIDTH_DEFAULT = 560
const PANEL_WIDTH_MIN = 360
const PANEL_WIDTH_MAX = 900

/** Keeps a panel width between the minimum and the maximum, and within 90 percent of the window. */
export function clampPanelWidth(w: number): number
{
  const max = Math.min(PANEL_WIDTH_MAX, Math.round(window.innerWidth * 0.9))
  return Math.max(PANEL_WIDTH_MIN, Math.min(max, w))
}

/** Match a collection-member poster to a Plex collection child. */
export function matchCollectionChild(p: PosterInfo, children: LibraryItem[]): LibraryItem | undefined
{
  if (p.tmdbId)
  {
    const byTmdb = children.find(c => c.tmdbId === p.tmdbId)
    if (byTmdb) return byTmdb
  }
  const lt = p.title.toLowerCase().trim()
  return children.find(c =>
    c.title.toLowerCase().trim() === lt
    && (p.year == null || c.year == null || p.year === c.year),
  )
}
