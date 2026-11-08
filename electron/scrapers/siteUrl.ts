/** A site the scrapers read pages from: its canonical origin and the hosts that serve the same pages. */
export interface ScrapedSite {
  origin: string
  hosts: readonly string[]
}

export const POSTERDB_SITE: ScrapedSite = { origin: 'https://theposterdb.com', hosts: ['theposterdb.com', 'www.theposterdb.com'] }
export const MEDIUX_SITE: ScrapedSite = { origin: 'https://mediux.pro', hosts: ['mediux.pro', 'www.mediux.pro'] }

/**
 * Rebuilds a page URL on a site's own https origin, so a link from a user or a
 * stored job can never point a fetch or the headless browser at another host
 * or another kind of address.
 *
 * Each path segment is decoded and encoded again as a single segment, so an
 * encoded slash cannot add path levels, and the query is carried over as is.
 *
 * @param url - Page URL to check; a missing scheme is treated as https.
 * @param site - The site the page must belong to.
 * @returns The page on the site's origin, or null for any other host,
 *   credentials in the URL, a non-default port, or a malformed path.
 */
export function sitePageUrl(url: string, site: ScrapedSite): string | null {
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
  } catch {
    return null
  }
  if (!site.hosts.includes(parsed.hostname.toLowerCase())) return null
  if (parsed.username || parsed.password || parsed.port) return null

  let path: string
  try {
    path = parsed.pathname.split('/').filter(Boolean).map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/')
  } catch {
    return null
  }
  const trailing = path && parsed.pathname.endsWith('/') ? '/' : ''
  const query = parsed.search.slice(1)
  return `${site.origin}/${path}${trailing}${query ? `?${query}` : ''}`
}
