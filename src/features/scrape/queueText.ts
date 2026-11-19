import type { PosterResult } from './hooks/useScrapeStore'

/**
 * Detects the scraping source site from a URL.
 *
 * @param url - URL to inspect.
 * @returns posterdb, mediux, or null when unrecognized.
 */
export function sourceFromUrl(url: string): 'posterdb' | 'mediux' | null
{
  if (/theposterdb\.com/i.test(url)) return 'posterdb'
  if (/mediux\.pro/i.test(url)) return 'mediux'
  return null
}

/**
 * Compacts a URL for display.
 *
 * @param url - Full URL.
 * @returns Host and path without protocol or www.
 */
export function shortUrl(url: string): string
{
  try
  {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '') + u.pathname
  }
  catch
  {
    return url
  }
}

/**
 * Display label for a poster.
 *
 * @param p - The poster.
 * @returns Title plus season/episode markers.
 */
export function posterLabel(p: PosterResult): string
{
  if (p.season === 'Backdrop') return `${p.title} - Backdrop`
  if (p.season === 'Cover')    return `${p.title} - Cover`
  if (typeof p.season === 'number') return `${p.title} S${p.season}`
  if (p.episode != null)       return `${p.title} E${p.episode}`
  return p.title + (p.year ? ` (${p.year})` : '')
}

/**
 * Condenses an upload error to something short enough to fit in a
 * thumbnail's overlay.
 *
 * @param r - Why the upload failed.
 * @returns A short name for common errors, otherwise the first 18 characters.
 */
export function shortReason(r: string): string
{
  if (/not connected/i.test(r)) return 'Not connected'
  if (/403/.test(r))            return 'Auth error (403)'
  if (/404/.test(r))            return 'Not found (404)'
  if (/download failed/i.test(r)) return r.replace(/.*:\s*/, '').slice(0, 18)
  return r.slice(0, 18)
}

/**
 * Splits what was typed into the queue box into URLs, one per line or comma.
 *
 * @param text - The box's contents.
 * @returns The trimmed, non-empty entries.
 */
export function parseUrlList(text: string): string[]
{
  return text
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
}
