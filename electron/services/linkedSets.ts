import { ConfigService } from './config'
import { Logger } from './logger'
import { ScraperFactory } from '../scrapers/scraperFactory'
import { classifyUrl } from '../scrapers/urlSource'
import type { LinkedItemRef, LinkedSetsRes, PosterSetSummary } from '../ipc/types'

/** How long the sets read from a link are reused before the page is read again. */
const LINK_TTL = 30 * 60 * 1000

/** Resolved links, keyed by item and link, so reopening a title costs no page loads. */
const resolved = new Map<string, { sets: PosterSetSummary[]; at: number }>()

/**
 * Cleans a pasted link so the same page is stored once: scheme added when
 * missing, fragment and query dropped, trailing slash removed.
 *
 * @param raw - What the user pasted.
 * @returns The canonical https link, or null when the text is not a URL.
 */
export function normalizeLink(raw: string): string | null
{
  const text = raw.trim()
  if (!text) return null
  try
  {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    url.protocol = 'https:'
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  }
  catch
  {
    return null
  }
}

function errorText(err: unknown): string
{
  return err instanceof Error ? err.message : String(err)
}

async function resolveLink(item: LinkedItemRef, url: string, fresh: boolean): Promise<PosterSetSummary[]>
{
  const key = `${item.key}|${url}`
  const hit = resolved.get(key)
  if (hit && !fresh && Date.now() - hit.at < LINK_TTL) return hit.sets

  const source = classifyUrl(url)
  if (source === 'unknown') throw new Error('Only MediUX and ThePosterDB links can be used')
  const found = source === 'posterdb'
    ? await ScraperFactory.linkPosterdb(url, item.title, item.year, item.type)
    : await ScraperFactory.linkMediux(url)
  const sets = found.map(s => ({ ...s, linkedFrom: url }))
  resolved.set(key, { sets, at: Date.now() })
  return sets
}

/**
 * Set links the user attaches to library items when the sites' own matching
 * finds nothing, or the wrong thing. A link is a MediUX set, boxset, movie or
 * show page, or a ThePosterDB set, poster or title page; the sets behind it
 * join the title's list and are remembered across sessions.
 */
export const LinkedSetsService = {
  /**
   * The links attached to an item.
   *
   * @param itemKey - Plex ratingKey.
   * @returns The links, oldest first.
   */
  links(itemKey: string): string[]
  {
    return ConfigService.get().linkedSets?.[itemKey] ?? []
  },

  /**
   * Reads the sets behind every link attached to an item. A link that cannot
   * be read is reported, not thrown, so the others still show.
   *
   * @param item - The item being browsed.
   * @param fresh - Re-read the pages instead of reusing recent reads.
   * @returns The sets and any failed links.
   */
  async resolve(item: LinkedItemRef, fresh = false): Promise<LinkedSetsRes>
  {
    const urls = this.links(item.key)
    const out: LinkedSetsRes = { sets: [] }
    const settled = await Promise.allSettled(urls.map(url => resolveLink(item, url, fresh)))
    settled.forEach((result, i) =>
    {
      if (result.status === 'fulfilled') out.sets.push(...result.value)
      else (out.errors ??= []).push({ url: urls[i], error: errorText(result.reason) })
    })
    return out
  },

  /**
   * Attaches a link to an item once its page has been read and holds at
   * least one set.
   *
   * @param item - The item being browsed.
   * @param raw - The pasted link.
   * @returns The sets behind the link, or the reason it was refused.
   */
  async link(item: LinkedItemRef, raw: string): Promise<LinkedSetsRes>
  {
    const url = normalizeLink(raw)
    if (!url) return { sets: [], errors: [{ url: raw, error: 'That is not a link' }] }
    try
    {
      const sets = await resolveLink(item, url, true)
      if (!sets.length) return { sets: [], errors: [{ url, error: 'No sets were found at that link' }] }
      const all = { ...(ConfigService.get().linkedSets ?? {}) }
      const list = all[item.key] ?? []
      if (!list.includes(url)) ConfigService.set({ linkedSets: { ...all, [item.key]: [...list, url] } })
      Logger.info('Library', `Linked ${url} to "${item.title}": ${sets.length} set(s)`)
      return { sets }
    }
    catch (err)
    {
      const error = errorText(err)
      Logger.warn('Library', `Could not link ${url} to "${item.title}": ${error}`)
      return { sets: [], errors: [{ url, error }] }
    }
  },

  /**
   * Detaches a link from an item.
   *
   * @param itemKey - Plex ratingKey.
   * @param url - The link as it was stored.
   */
  unlink(itemKey: string, url: string): void
  {
    const all = { ...(ConfigService.get().linkedSets ?? {}) }
    const list = (all[itemKey] ?? []).filter(u => u !== url)
    if (list.length) all[itemKey] = list
    else delete all[itemKey]
    ConfigService.set({ linkedSets: all })
    resolved.delete(`${itemKey}|${url}`)
  },

  /** Forgets every read, so the next open reads the pages again. */
  clearCache(): void
  {
    resolved.clear()
  },
}
