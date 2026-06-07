import pLimit from 'p-limit'
import { PosterdbScraper, posterdbUrlType } from './posterdbScraper'
import { MediuxScraper } from './mediuxScraper'
import { BaseScraper } from './baseScraper'
import { Logger } from '../services/logger'
import { ConfigService } from '../services/config'
import type { PosterInfo, ScrapeProgress } from '../ipc/types'

// --- URL classification -------------------------------------------------------

export type ScraperSource = 'posterdb' | 'mediux' | 'unknown'

export function classifyUrl(url: string): ScraperSource {
  if (url.includes('theposterdb.com')) return 'posterdb'
  if (url.includes('mediux.pro')) return 'mediux'
  return 'unknown'
}

// --- Scraper instances (reused across calls within a session) -----------------

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

// --- Factory ------------------------------------------------------------------

export type ProgressCallback = (progress: ScrapeProgress) => void

export const ScraperFactory = {
  // -- Scrape a single URL ----------------------------------------------------
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

  // -- Scrape multiple URLs with concurrency cap ------------------------------
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

  // -- Abort all in-flight scrapes --------------------------------------------
  abort(): void {
    _aborted = true
    _posterdb?.abort()
    _mediux?.abort()
    Logger.info('ScraperFactory', 'Scrape session aborted')
  },

  // -- Close browser instances (end of session) -------------------------------
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

  // -- Library browser: list MediUX sets for a TMDB title --------------------
  async browseMediux(tmdbId: string, type: 'movie' | 'show') {
    return getMediux().browseSets(tmdbId, type)
  },

  // -- Library browser: list a creator's sets (cumulative page N = first N×12) -
  async browseMediuxUser(username: string, page = 1) {
    return getMediux().browseUserSets(username, page)
  },

  // -- Quick validation helper for the UI ------------------------------------
  isSupported(url: string): boolean {
    return classifyUrl(url) !== 'unknown'
  },

  sourceOf(url: string): 'posterdb' | 'mediux' | null {
    const src = classifyUrl(url)
    return src === 'unknown' ? null : src
  },

  // -- Expose internals so the scrape tab can show URL-type metadata ----------
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
