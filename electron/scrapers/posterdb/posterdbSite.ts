import { USER_AGENTS } from '../baseScraper'
import { Logger } from '../../services/logger'
import { sitePageUrl, POSTERDB_SITE } from '../siteUrl'

/** ThePosterDB's origin; every page and asset URL starts here. */
export const BASE = 'https://theposterdb.com'

/** Plain HTTP budget per page before the browser takes over. */
const FETCH_TIMEOUT_MS = 15_000

/**
 * Rebuilds a ThePosterDB page URL on https://theposterdb.com (see sitePageUrl).
 *
 * @param url - Page URL to check; a missing scheme is treated as https.
 * @returns The page on the site's origin, or null when it is not a ThePosterDB page.
 */
export function posterdbPageUrl(url: string): string | null {
  return sitePageUrl(url, POSTERDB_SITE)
}

/**
 * Classifies a ThePosterDB URL.
 *
 * @param url - URL to inspect.
 * @returns set, poster, user, or unknown; unknown for any other host.
 */
export function posterdbUrlType(url: string): 'set' | 'poster' | 'media' | 'user' | 'unknown' {
  const page = posterdbPageUrl(url)
  if (!page) return 'unknown'
  const path = new URL(page).pathname
  if (/^\/set\/\d+/.test(path)) return 'set'
  if (/^\/poster\/\d+/.test(path)) return 'poster'
  if (/^\/posters\/\d+/.test(path)) return 'media'
  if (/^\/user\//.test(path)) return 'user'
  return 'unknown'
}

/**
 * Returns the original-quality image endpoint (matches the Python scraper:
 * /api/assets/{id}).
 *
 * @param posterId - The poster's data-poster-id.
 * @returns The asset URL.
 */
export function posterAssetUrl(posterId: string): string {
  return `${BASE}/api/assets/${posterId}`
}

/**
 * Fetches a page over plain HTTP. ThePosterDB serves its search, media, set
 * and profile pages to a browser-like client without a challenge, which is
 * many times faster than driving the headless browser; callers fall back to
 * the browser when this returns null.
 *
 * @param url - Page to fetch.
 * @returns The HTML, or null for a URL off ThePosterDB, a transport failure, or a non-2xx status.
 */
export async function fetchHtml(url: string): Promise<string | null> {
  const page = posterdbPageUrl(url)
  if (!page) {
    Logger.warn('PosterDB', `Refused to fetch a URL outside theposterdb.com: ${url}`)
    return null
  }
  try {
    const res = await fetch(page, {
      headers: {
        'User-Agent': USER_AGENTS[0],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      Logger.scrape('PosterDB', `HTTP ${res.status} for ${url}`)
      return null
    }
    return await res.text()
  } catch (err) {
    Logger.scrape('PosterDB', `HTTP fetch failed [${url}]: ${err instanceof Error ? err.message : err}`)
    return null
  }
}
