import * as cheerio from 'cheerio'
import { mapPool } from '../baseScraper'
import { Logger } from '../../services/logger'
import { BASE, fetchHtml } from './posterdbSite'

/** How long a resolved avatar (or the absence of one) is trusted. */
const AVATAR_TTL = 24 * 60 * 60 * 1000
/** Parallel profile-page fetches while resolving avatars. */
const AVATAR_FETCH_CONCURRENCY = 4
/**
 * Longest a browse waits for avatars once its sets are ready. Profile pages
 * can take several seconds; a lookup still running finishes in the background
 * and fills the cache for the next open.
 */
export const AVATAR_WAIT_MS = 2_000

/** Resolved avatars by lowercased username; null means "show the generic icon". */
const avatarCache = new Map<string, { url: string | null; at: number }>()
/** Profile lookups in flight by lowercased username, so concurrent browses read each page once. */
const avatarLookups = new Map<string, Promise<string | null>>()

/** Forgets every resolved avatar. */
export function clearAvatarCache(): void {
  avatarCache.clear()
}

/**
 * Where a custom upload would live: the CDN path is built from the username.
 * Only a fallback for when the profile page can't be read - users who never
 * uploaded an avatar 403 here, and the card then shows its generic icon.
 *
 * @param username - Uploader name as shown on the site.
 * @returns The guessed CDN URL.
 */
export function guessedAvatarUrl(username: string): string {
  return `https://images.theposterdb.com/prod/public/images/users/${encodeURIComponent(username)}/avatar.webp`
}

/**
 * Reads the avatar a profile page actually shows. That is either a custom
 * upload on the image CDN or one of the site's stock pictures, which it
 * assigns per user server-side - so it can only be learned from the page.
 *
 * @param $ - Cheerio handle over the profile HTML.
 * @returns The avatar URL, null for the site's gray "missing avatar"
 *   silhouette (the app's own icon looks the same and fits the theme), or
 *   undefined when the page has no avatar element at all.
 */
export function parseProfileAvatar($: cheerio.CheerioAPI): string | null | undefined {
  const $img = $('img.tpdb-avatar').first()
  if (!$img.length) return undefined
  const raw =
    $img.closest('picture').find('source[type="image/webp"]').first().attr('srcset') ||
    $img.attr('src') ||
    ''
  const src = raw.split(',')[0].trim().split(/\s+/)[0]
  if (!src || src.includes('missing_avatar')) return null
  return src.startsWith('http') ? src : `${BASE}${src}`
}

/**
 * Reads one uploader's avatar from their profile page, joining a lookup for
 * the same uploader that is already running. A found avatar is cached for a
 * day; a failed fetch answers the guessed CDN URL without caching, so a
 * hiccup isn't remembered.
 *
 * @param name - Uploader as shown on the site.
 * @returns The avatar URL, or null for the generic icon.
 */
function lookUpAvatar(name: string): Promise<string | null>
{
  const key = name.toLowerCase()
  const running = avatarLookups.get(key)
  if (running) return running
  const lookup = (async () =>
  {
    try
    {
      const html = await fetchHtml(`${BASE}/user/${encodeURIComponent(name)}`)
      if (html === null) throw new Error('profile page did not load')
      const found = parseProfileAvatar(cheerio.load(html))
      if (found === undefined) throw new Error('no avatar element on profile page')
      avatarCache.set(key, { url: found, at: Date.now() })
      return found
    }
    catch (err)
    {
      Logger.warn('PosterDB', `Avatar lookup failed for "${name}": ${err instanceof Error ? err.message : err}`)
      return guessedAvatarUrl(name)
    }
  })().finally(() => avatarLookups.delete(key))
  avatarLookups.set(key, lookup)
  return lookup
}

/** Avatar lookups started for a browse. */
export interface AvatarLookup
{
  /** Settles once every profile lookup has. */
  done: Promise<void>
  /**
   * The avatar for an uploader so far: the resolved one (null for the generic
   * icon), the guessed CDN URL while its lookup is still running, or undefined
   * for an unknown uploader.
   */
  avatarOf: (name: string) => string | null | undefined
}

/**
 * Starts resolving each uploader's avatar, answering cached ones at once.
 *
 * @param usernames - Uploaders to resolve; duplicates are fine.
 * @returns The lookup, readable at any time and complete once `done` settles.
 */
export function lookUpAvatars(usernames: string[]): AvatarLookup
{
  const found = new Map<string, string | null>()
  const asked = new Set<string>()
  for (const name of new Set(usernames))
  {
    if (!name || name === 'Unknown') continue
    const hit = avatarCache.get(name.toLowerCase())
    if (hit && Date.now() - hit.at < AVATAR_TTL) found.set(name.toLowerCase(), hit.url)
    else asked.add(name)
  }
  const done = mapPool([...asked], AVATAR_FETCH_CONCURRENCY, async name =>
  {
    found.set(name.toLowerCase(), await lookUpAvatar(name))
  }).then(() => undefined)
  const askedKeys = new Set([...asked].map(n => n.toLowerCase()))
  return {
    done,
    avatarOf: name =>
    {
      const key = name.toLowerCase()
      if (found.has(key)) return found.get(key)
      return askedKeys.has(key) ? guessedAvatarUrl(name) : undefined
    },
  }
}

/**
 * Resolves the avatar for each uploader by reading their profile page over
 * plain HTTP, waiting for every lookup.
 *
 * @param usernames - Uploaders to resolve; duplicates are fine.
 * @returns Lowercased username to avatar URL (null = generic icon).
 */
export async function resolveAvatars(usernames: string[]): Promise<Map<string, string | null>> {
  const lookup = lookUpAvatars(usernames)
  await lookup.done
  const out = new Map<string, string | null>()
  for (const name of new Set(usernames)) {
    const avatar = lookup.avatarOf(name)
    if (avatar !== undefined) out.set(name.toLowerCase(), avatar)
  }
  return out
}
