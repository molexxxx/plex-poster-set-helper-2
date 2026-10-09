export type ScraperSource = 'posterdb' | 'mediux' | 'unknown'

/**
 * Classifies a URL by its scraping source site.
 *
 * Matches on the parsed hostname rather than a substring, so evil.com/?mediux.pro
 * and mediux.pro.evil.com are rejected.
 *
 * @param url - URL to inspect; a missing scheme is treated as https.
 * @returns posterdb, mediux, or unknown.
 */
export function classifyUrl(url: string): ScraperSource
{
  let host: string
  try
  {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase()
  }
  catch
  {
    return 'unknown'
  }
  if (host === 'theposterdb.com' || host.endsWith('.theposterdb.com')) return 'posterdb'
  if (host === 'mediux.pro' || host.endsWith('.mediux.pro')) return 'mediux'
  return 'unknown'
}
