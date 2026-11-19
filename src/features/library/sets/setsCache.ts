import type { LibraryItem, PlexArtSlot, PosterSetSummary, SetSource } from '../../../../electron/ipc/types'

/** A title's browse result as last read, with when it was read. */
export interface BrowseCacheEntry
{
  sets: PosterSetSummary[]
  tmdbId?: string
  tmdbMissing?: boolean
  collectionMembers?: LibraryItem[]
  sourceErrors?: Partial<Record<SetSource, string>>
  /** ThePosterDB has more sets than were read; the page to continue on. */
  posterdbUrl?: string
  fetchedAt: number
}

/** Browse results by item, kept for this window. */
export const browseSetsCache = new Map<string, BrowseCacheEntry>()
/** How long a browse result is shown before it is read again in the background. */
export const BROWSE_CACHE_TTL = 30 * 60 * 1000

/** An item's current Plex art as last read, with when it was read. */
export interface ArtCacheEntry { slots: PlexArtSlot[]; fetchedAt: number }
/** Current Plex art by item key, kept for this window. */
export const currentArtCache = new Map<string, ArtCacheEntry>()
/** How long current art is shown before it is read again in the background. */
export const ART_CACHE_TTL = 5 * 60 * 1000

/** The browse cache key for an item, which keeps collections and each type of title apart. */
export function browseCacheKey(item: LibraryItem): string
{
  return item.type === 'collection' ? `collection:${item.key}` : `sets:${item.type}:${item.key}`
}

/** Marks an item's cached art stale, so it refetches while the strip keeps showing the cached art. */
export function staleCurrentArt(key: string)
{
  const cached = currentArtCache.get(key)
  if (cached) currentArtCache.set(key, { ...cached, fetchedAt: 0 })
}
