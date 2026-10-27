import raw from './release.json'

export interface Asset
{
  name: string
  size: number | null
  url: string
}

export interface ReleaseData
{
  version: string
  tag: string
  date: string | null
  assets: { windows: Asset | null; appimage: Asset | null; deb: Asset | null }
  releases: { tag: string; date: string }[]
  downloads: number | null
  stars: number | null
  fetchedAt: string
}

/** Release facts written at build time by scripts/release-data.mjs. */
export const release = raw as ReleaseData

export const REPO_URL = 'https://github.com/molexxxx/plex-poster-set-helper-2'
export const RELEASES_URL = `${REPO_URL}/releases/latest`
export const ISSUES_URL = `${REPO_URL}/issues`
export const DOCKER_HUB_URL = 'https://hub.docker.com/r/tonywied17/plex-poster-helper-2'
export const UNRAID_URL = 'https://ca.unraid.net/apps/plex-poster-helper-2-1qbjs0q1mmwhy6'

/**
 * Formats a byte count in whole megabytes.
 *
 * @param bytes - Size in bytes, or null when unknown.
 * @returns For example "212 MB", or null.
 */
export function megabytes(bytes: number | null): string | null
{
  return bytes == null ? null : `${Math.round(bytes / 1024 / 1024)} MB`
}

/**
 * Formats an ISO timestamp as its calendar day.
 *
 * @param date - ISO timestamp, or null when unknown.
 * @returns For example "2026-10-26", or null.
 */
export function isoDay(date: string | null): string | null
{
  return date ? date.slice(0, 10) : null
}

/**
 * Formats a count with thousands separators.
 *
 * @param n - The count, or null when unknown.
 * @returns For example "1,084", or null.
 */
export function count(n: number | null): string | null
{
  return n == null ? null : n.toLocaleString('en-US')
}

/**
 * The release date of a tag, when the build could read it.
 *
 * @param tag - A tag such as "v2.11.0".
 * @returns Its ISO day, or null.
 */
export function releaseDay(tag: string): string | null
{
  return isoDay(release.releases.find(r => r.tag === tag)?.date ?? null)
}
