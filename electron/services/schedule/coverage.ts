import type { AppliedRecord, ScheduledJob } from '../../ipc/types'

/**
 * Feed URL that syncs every set a MediUX creator publishes.
 *
 * @param username - MediUX username.
 * @returns The creator's sets URL.
 */
export function creatorSyncUrl(username: string): string
{
  return `https://mediux.pro/user/${username}/sets`
}

/**
 * Reads the creator from a MediUX user URL.
 *
 * @param url - URL to inspect.
 * @returns The lowercased username, or null for other URLs.
 */
export function creatorOfUrl(url: string): string | null
{
  const m = /mediux\.pro\/user\/([^/?#]+)/i.exec(url)
  if (!m) return null
  try
  {
    return decodeURIComponent(m[1]).toLowerCase()
  }
  catch
  {
    return m[1].toLowerCase()
  }
}

/**
 * Reads the set id from a MediUX set URL.
 *
 * @param url - URL to inspect.
 * @returns The numeric set id, or null for other URLs.
 */
export function mediuxSetId(url: string): string | null
{
  const m = /mediux\.pro\/sets\/(\d+)/i.exec(url)
  return m ? m[1] : null
}

/**
 * Reads the set id from a ThePosterDB set URL.
 *
 * @param url - URL to inspect.
 * @returns The numeric set id, or null for other URLs.
 */
export function posterdbSetId(url: string): string | null
{
  const m = /theposterdb\.com\/set\/(\d+)/i.exec(url)
  return m ? m[1] : null
}

/**
 * Reads the set a URL points at on either site. Ids are only unique within a
 * site (MediUX and ThePosterDB both number sets from 1), so the source travels
 * with the id.
 *
 * @param url - URL to inspect.
 * @returns The set's source and id, or null for anything but a set URL.
 */
export function setRefOfUrl(url: string): { source: 'mediux' | 'posterdb'; id: string } | null
{
  const mediux = mediuxSetId(url)
  if (mediux) return { source: 'mediux', id: mediux }
  const posterdb = posterdbSetId(url)
  return posterdb ? { source: 'posterdb', id: posterdb } : null
}

/**
 * Coverage-map key for a set: "source:id". Set ids collide across sites, so
 * every index that must tell two sets apart keys by this.
 *
 * @param source - The set's site.
 * @param id - The set's id on that site.
 * @returns The qualified key.
 */
export function coverageKey(source: 'mediux' | 'posterdb', id: string): string
{
  return `${source}:${id}`
}

/**
 * Coverage key of the set an applied record came from.
 *
 * @param r - The record.
 * @returns The qualified key, or an empty string for a manual upload.
 */
export function recordCoverageKey(r: AppliedRecord): string
{
  return r.setId ? coverageKey(r.source, r.setId) : ''
}

/** Enabled jobs indexed by the sets and MediUX creators they sync. */
export interface ScheduleCoverage
{
  /** Keyed by "source:id" - set ids collide across sites. */
  sets: Map<string, ScheduledJob>
  creators: Map<string, ScheduledJob>
}

/**
 * Indexes enabled jobs by set (MediUX or ThePosterDB) and by MediUX
 * creator-wide sync.
 *
 * @param jobs - Current jobs.
 * @returns Lookups for the Library Browser's Scheduled badges.
 */
export function scheduleCoverage(jobs: ScheduledJob[]): ScheduleCoverage
{
  const coverage: ScheduleCoverage = { sets: new Map(), creators: new Map() }
  for (const job of jobs)
  {
    if (!job.enabled) continue
    for (const url of job.urls)
    {
      const ref = setRefOfUrl(url)
      const key = ref && coverageKey(ref.source, ref.id)
      if (key && !coverage.sets.has(key)) coverage.sets.set(key, job)
      const creator = creatorOfUrl(url)
      if (creator && !coverage.creators.has(creator)) coverage.creators.set(creator, job)
    }
  }
  return coverage
}

/**
 * Finds the enabled job that syncs a set.
 *
 * @param coverage - Index from {@link scheduleCoverage}.
 * @param setId - The set's id on its site.
 * @param creator - The set's uploader, matched against creator-wide jobs.
 * @param source - The set's site. Creator-wide jobs are MediUX feeds, so they
 *   only ever cover MediUX sets - a ThePosterDB uploader who shares a name
 *   with a synced MediUX creator is someone else.
 * @returns The covering job, if any.
 */
export function coveringJob(
  coverage: ScheduleCoverage,
  setId: string,
  creator?: string,
  source: 'mediux' | 'posterdb' = 'mediux',
): ScheduledJob | undefined
{
  const direct = coverage.sets.get(coverageKey(source, setId))
  if (direct || source !== 'mediux' || !creator) return direct
  return coverage.creators.get(creator.toLowerCase())
}
