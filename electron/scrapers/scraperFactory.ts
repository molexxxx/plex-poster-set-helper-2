import pLimit from 'p-limit'
import { PosterdbScraper, posterdbUrlType } from './posterdbScraper'
import { MediuxScraper } from './mediuxScraper'
import { BaseScraper } from './baseScraper'
import { Logger } from '../services/logger'
import { ConfigService } from '../services/config'
import type { PosterInfo, ScrapeProgress } from '../ipc/types'

export type ScraperSource = 'posterdb' | 'mediux' | 'unknown'

/**
 * Classifies a URL by its scraping source site.
 *
 * @param url - URL to inspect.
 * @returns posterdb, mediux, or unknown.
 */
export function classifyUrl(url: string): ScraperSource {
  // Match on the parsed hostname, not a substring: `includes('mediux.pro')`
  // would also accept evil.com/?mediux.pro or mediux.pro.evil.com.
  let host: string
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase()
  } catch {
    return 'unknown'
  }
  if (host === 'theposterdb.com' || host.endsWith('.theposterdb.com')) return 'posterdb'
  if (host === 'mediux.pro' || host.endsWith('.mediux.pro')) return 'mediux'
  return 'unknown'
}

// Scraper instances are reused across calls within a session
let _posterdb: PosterdbScraper | null = null
let _mediux: MediuxScraper | null = null
let _aborted = false

function getPosterdb(): PosterdbScraper {
  if (!_posterdb) _posterdb = new PosterdbScraper()
  return _posterdb
}

function getMediux(): MediuxScraper {
  if (!_mediux) _mediux = new MediuxScraper()
  return _mediux
}

function getScraper(source: ScraperSource): BaseScraper | null {
  if (source === 'posterdb') return getPosterdb()
  if (source === 'mediux')   return getMediux()
  return null
}

export type ProgressCallback = (progress: ScrapeProgress) => void

/** Routes scrape requests to the right site scraper and manages their shared lifecycle. */
export const ScraperFactory = {
  /**
   * Scrapes a single URL, reporting progress along the way.
   *
   * @param url - Page to scrape.
   * @param onProgress - Receives status transitions for the UI.
   * @param workerId - Worker slot shown in progress events.
   * @returns The posters found, empty on failure or unsupported URLs.
   */
  async scrapeUrl(
    url: string,
    onProgress: ProgressCallback,
    workerId = 0,
  ): Promise<PosterInfo[]> {
    if (_aborted) return []

    const source = classifyUrl(url)
    if (source === 'unknown') {
      Logger.warn('ScraperFactory', `Unknown URL source: ${url}`)
      onProgress({ url, status: 'error', error: 'Unsupported URL (must be theposterdb.com or mediux.pro)', workerId })
      return []
    }

    const scraper = getScraper(source)!
    onProgress({ url, status: 'scraping', workerId })

    try {
      const posters = await scraper.scrape(url)
      onProgress({ url, status: 'done', posterCount: posters.length, workerId })
      return posters
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      Logger.error('ScraperFactory', `scrapeUrl failed [${url}]: ${error}`)
      onProgress({ url, status: 'error', error, workerId })
      return []
    }
  },

  /**
   * Scrapes multiple URLs concurrently, capped at the configured worker count.
   *
   * @param urls - Pages to scrape.
   * @param onProgress - Receives status transitions for the UI.
   * @returns Posters keyed by their source URL.
   */
  async scrapeMany(
    urls: string[],
    onProgress: ProgressCallback,
  ): Promise<Map<string, PosterInfo[]>> {
    _aborted = false
    const cfg = ConfigService.get()
    const limit = pLimit(Math.max(1, cfg.maxWorkers))
    const results = new Map<string, PosterInfo[]>()

    const tasks = urls.map((url, i) =>
      limit(async () => {
        if (_aborted) return
        const workerId = (i % cfg.maxWorkers) + 1
        const posters = await ScraperFactory.scrapeUrl(url, onProgress, workerId)
        results.set(url, posters)
      })
    )

    await Promise.allSettled(tasks)
    return results
  },

  /** Aborts all in-flight scrapes. */
  abort(): void {
    _aborted = true
    _posterdb?.abort()
    _mediux?.abort()
    Logger.info('ScraperFactory', 'Scrape session aborted')
  },

  /** Closes scraper browser instances at the end of a session. */
  async close(): Promise<void> {
    await Promise.allSettled([
      _posterdb?.close(),
      _mediux?.close(),
    ])
    _posterdb = null
    _mediux = null
    _aborted = false
    Logger.info('ScraperFactory', 'Scraper browsers closed')
  },

  /**
   * Lists MediUX sets for a TMDB title (library browser).
   *
   * @param tmdbId - Resolved TMDB id.
   * @param type - Media type of the title.
   * @returns Set summaries with uploader metadata.
   */
  async browseMediux(tmdbId: string, type: 'movie' | 'show') {
    return getMediux().browseSets(tmdbId, type)
  },

  async browseMediuxCollection(
    collectionTitle: string,
    tmdbCollectionId: string | undefined,
    childTmdbIds: string[],
  ) {
    return getMediux().browseCollectionSets(collectionTitle, tmdbCollectionId, childTmdbIds)
  },

  /**
   * Lists a MediUX creator's sets.
   *
   * @param username - Creator to browse.
   * @param page - Cumulative page; page N returns their first N*12 sets.
   * @returns The creator's sets with parsed title/year per set.
   */
  async browseMediuxUser(username: string, page = 1) {
    return getMediux().browseUserSets(username, page)
  },

  /**
   * Checks whether a URL belongs to a supported scraping source.
   *
   * @param url - URL to inspect.
   * @returns true for theposterdb.com and mediux.pro URLs.
   */
  isSupported(url: string): boolean {
    return classifyUrl(url) !== 'unknown'
  },

  /**
   * Returns the URL's source site.
   *
   * @param url - URL to inspect.
   * @returns The source, or null when unsupported.
   */
  sourceOf(url: string): 'posterdb' | 'mediux' | null {
    const src = classifyUrl(url)
    return src === 'unknown' ? null : src
  },

  /**
   * Describes a URL's source and page type for display in the scrape tab.
   *
   * @param url - URL to inspect.
   * @returns The source plus a page-type hint when recognisable.
   */
  describeUrl(url: string): { source: ScraperSource; type?: string } {
    const source = classifyUrl(url)
    if (source === 'posterdb') return { source, type: posterdbUrlType(url) }
    if (source === 'mediux') {
      const type = url.includes('/boxsets/') ? 'boxset' : url.includes('/shows/') ? 'show' : 'set'
      return { source, type }
    }
    return { source }
  },
}
