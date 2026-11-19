import type { ArtworkType, ScheduledJob } from '../../ipc/types'
import { describeCron } from './cronText'
import { urlKey, analyzeUrls } from './jobs'
import { creatorOfUrl, mediuxSetId, setRefOfUrl } from './coverage'
import { ARTWORK_TYPES, sameArtworkTypes } from './artworkTypes'
import { plural } from './runs'

/** Schedule the quick Schedule and Sync actions use until the user picks another. */
export const DEFAULT_QUICK_CRON = '0 3 * * 0'

/** Schedules offered for the quick Schedule and Sync actions. */
export const QUICK_SCHEDULES = ['0 3 * * *', '0 3 * * 0', '0 9 * * 1', '0 */12 * * *', '0 3 1 * *']

/**
 * The order a creator sync applies a catalog in: oldest to newest, so where a
 * title has several sets the newest one ends up on top. With `since`, only sets
 * added or updated after it are kept.
 *
 * @param sets - The creator's catalog, newest first as MediUX lists it.
 * @param since - ISO time from the job, when it syncs only new uploads.
 * @returns The sets to apply, oldest first.
 */
export function creatorSyncOrder<T extends { dateUpdated?: string }>(sets: T[], since?: string): T[]
{
  const time = (s: T) => (s.dateUpdated ? Date.parse(s.dateUpdated) : Number.NaN)
  const floor = since ? Date.parse(since) : Number.NaN
  const kept = Number.isNaN(floor) ? sets : sets.filter(s => time(s) > floor)
  return kept
    .map((set, i) => ({ set, i, t: time(set) }))
    .sort((a, b) =>
    {
      const at = Number.isNaN(a.t) ? -Infinity : a.t
      const bt = Number.isNaN(b.t) ? -Infinity : b.t
      return at - bt || b.i - a.i
    })
    .map(e => e.set)
}

function coversUrl(job: ScheduledJob, url: string, creator?: string): boolean
{
  const key = urlKey(url)
  if (job.urls.some(u => urlKey(u) === key)) return true
  // Creator-wide syncs are MediUX feeds; they never cover another site's set.
  if (!creator || setRefOfUrl(url)?.source === 'posterdb') return false
  const c = creator.toLowerCase()
  return job.urls.some(u => creatorOfUrl(u) === c)
}

const AUTO_NAME = /^Sync @(\S+?)(?: \(\d+ sets?\))?$/

function isCreatorJob(job: ScheduledJob, creator: string): boolean
{
  const c = creator.toLowerCase()
  if (job.creator) return job.creator.toLowerCase() === c
  const m = AUTO_NAME.exec(job.name)
  return !!m && m[1].toLowerCase() === c
}

/** What a quick Schedule or Sync action should do. */
export interface QuickSyncRequest
{
  urls: string[]
  /** Name for a newly created job. */
  name: string
  /** Schedule for a newly created job; existing jobs keep theirs. */
  cronExpr: string
  /** MediUX creator the URLs belong to; a creator-wide job for them already covers the URLs. */
  creator?: string
  /** Merge into the creator's existing sync job instead of creating another. */
  groupByCreator?: boolean
  /** Artwork types for a newly created job; a job that already covers the URLs keeps its own. */
  assetTypes?: ArtworkType[]
  /** Settings chosen in the sync dialog; they apply to the new or existing job alike. */
  overrides?: Partial<Pick<ScheduledJob, 'cronExpr' | 'fillGaps' | 'since' | 'assetTypes'>>
}

export type QuickSyncPlan =
  | { kind: 'exists'; job: ScheduledJob }
  | { kind: 'update'; job: ScheduledJob; added: number; reenabled: boolean }
  | { kind: 'create'; job: ScheduledJob }

/**
 * Decides how a quick Schedule or Sync action changes the job list, so
 * repeated clicks never stack duplicate jobs.
 *
 * An enabled job that already covers every URL (directly, or through a
 * creator-wide sync) is left alone; a disabled one is re-enabled. With
 * `groupByCreator`, the URLs merge into that creator's existing sync job, and
 * syncing the whole creator replaces its individual set URLs. Otherwise a new
 * job is created.
 *
 * Settings from the sync dialog (`overrides`) are applied to whichever job the
 * plan lands on, and an already-covering job that they change becomes an update.
 *
 * @param jobs - Current jobs.
 * @param req - The action's URLs, defaults, and creator.
 * @param makeId - Generates an id for a new job.
 * @returns The job to save (or the existing job when nothing changes).
 */
export function planQuickSync(jobs: ScheduledJob[], req: QuickSyncRequest, makeId: () => string): QuickSyncPlan
{
  const plan = planQuickSyncJob(jobs, req, makeId)
  const overrides = req.overrides
  if (!overrides) return plan
  const job: ScheduledJob = { ...plan.job, ...overrides }
  if ('since' in overrides && !overrides.since) delete job.since
  if (!overrides.fillGaps && 'fillGaps' in overrides) delete job.fillGaps
  if ('assetTypes' in overrides && !overrides.assetTypes?.length) delete job.assetTypes
  const changed = job.cronExpr !== plan.job.cronExpr || !!job.fillGaps !== !!plan.job.fillGaps || job.since !== plan.job.since
    || !sameJobArtwork(job, plan.job)
  if (plan.kind === 'exists') return changed ? { kind: 'update', job, added: 0, reenabled: false } : plan
  return { ...plan, job }
}

function planQuickSyncJob(jobs: ScheduledJob[], req: QuickSyncRequest, makeId: () => string): QuickSyncPlan
{
  const urls = analyzeUrls(req.urls).urls
  const covering = urls.length ? jobs.find(j => urls.every(u => coversUrl(j, u, req.creator))) : undefined
  if (covering)
  {
    if (covering.enabled) return { kind: 'exists', job: covering }
    return { kind: 'update', job: { ...covering, enabled: true }, added: 0, reenabled: true }
  }

  if (req.groupByCreator && req.creator)
  {
    const creator = req.creator
    const target = jobs.find(j => isCreatorJob(j, creator))
    if (target)
    {
      const merged = analyzeUrls([...target.urls, ...urls]).urls
      const wide = merged.find(u => creatorOfUrl(u) === creator.toLowerCase())
      const finalUrls = wide ? merged.filter(u => u === wide || !mediuxSetId(u)) : merged
      const before = new Set(target.urls.map(urlKey))
      const added = finalUrls.filter(u => !before.has(urlKey(u))).length
      const setCount = finalUrls.filter(u => mediuxSetId(u)).length
      const name = !AUTO_NAME.test(target.name)
        ? target.name
        : wide ? `Sync @${creator}` : `Sync @${creator} (${setCount} ${setCount === 1 ? 'set' : 'sets'})`
      return {
        kind: 'update',
        job: { ...target, urls: finalUrls, name, enabled: true, creator: target.creator ?? creator },
        added,
        reenabled: !target.enabled,
      }
    }
  }

  const job: ScheduledJob = { id: makeId(), name: req.name, urls, cronExpr: req.cronExpr, enabled: true, skipApplied: true }
  if (req.groupByCreator && req.creator) job.creator = req.creator
  if (req.assetTypes?.length) job.assetTypes = ARTWORK_TYPES.filter(t => req.assetTypes!.includes(t))
  return { kind: 'create', job }
}

function sameJobArtwork(a: ScheduledJob, b: ScheduledJob): boolean
{
  if (!a.assetTypes || !b.assetTypes) return !a.assetTypes === !b.assetTypes
  return sameArtworkTypes(a.assetTypes, b.assetTypes)
}

/**
 * Confirmation message for a finished quick Sync action.
 *
 * @param plan - What {@link planQuickSync} decided.
 * @param setCount - Number of individually selected sets, 0 for a whole-creator sync.
 * @param creator - The creator being synced.
 * @returns A one-line message naming the job and its schedule.
 */
export function describeQuickSync(plan: QuickSyncPlan, setCount: number, creator?: string): string
{
  const job = plan.job
  const when = describeCron(job.cronExpr)
  if (plan.kind === 'exists') return `Already synced by "${job.name}" (${when}).`
  if (plan.kind === 'update')
  {
    const wide = !!creator && job.urls.some(u => creatorOfUrl(u) === creator.toLowerCase())
    if (wide && setCount === 0) return `"${job.name}" now syncs every set from @${creator} (${when}).`
    if (plan.added > 0) return `Added ${plural(plan.added, 'set')} to "${job.name}" (${when}).`
    return `Turned "${job.name}" back on (${when}).`
  }
  if (setCount > 0) return `Syncing ${plural(setCount, 'set')} (${when}).`
  return creator ? `Syncing every set from @${creator} (${when}).` : `Saved "${job.name}" (${when}).`
}
