import type { CreatorCrawlStatus, MediuxUserSet } from '../../../../electron/ipc/types'

/** A creator's catalog as last received, with its revision and crawl state. */
export interface CachedCatalog { rev: number; sets: MediuxUserSet[]; capped: boolean; fetchedAt: number; status: CreatorCrawlStatus }

/** Catalogs this window already holds: a revisit paints from here, then asks only whether anything changed. */
export const catalogCache = new Map<string, CachedCatalog>()
export const CATALOG_CACHE_LIMIT = 3

/** Stores a catalog as the newest entry, dropping the oldest beyond the limit. */
export function rememberCatalog(key: string, entry: CachedCatalog): void
{
  catalogCache.delete(key)
  catalogCache.set(key, entry)
  while (catalogCache.size > CATALOG_CACHE_LIMIT)
  {
    const oldest = catalogCache.keys().next().value
    if (oldest === undefined) break
    catalogCache.delete(oldest)
  }
}
