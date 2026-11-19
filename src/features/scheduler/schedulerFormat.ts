import type { ArtworkType, JobRun, ScheduledJob } from '../../../electron/ipc/types'
import { creatorOfUrl, describeArtworkTypes } from '../../../electron/services/scheduleUtils'
import { classifyUrl } from '../../../electron/scrapers/urlSource'
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A run's or a job's status as the job list and the detail header show it. */
export type RowStatus = JobRun['status'] | 'running' | 'queued' | 'paused'

const STATUS_LABEL: Record<Exclude<RowStatus, 'queued'>, string> = {
  running: 'Running', paused: 'Paused', success: 'Succeeded', partial: 'Partly failed', error: 'Failed', stopped: 'Stopped',
}

/**
 * Describes the artwork a job applies.
 *
 * @param job - The job.
 * @param settingsTypes - Types picked in Settings.
 * @returns A line such as "Posters and backdrops, picked for this job".
 */
export function describeJobTypes(job: ScheduledJob, settingsTypes: ArtworkType[]): string
{
  return job.assetTypes
    ? `${capitalize(describeArtworkTypes(job.assetTypes))}, picked for this job`
    : `${capitalize(describeArtworkTypes(settingsTypes))}, as set in Settings`
}

/**
 * Formats a run time for display in the viewer's locale.
 *
 * @param iso - ISO timestamp.
 * @returns A label such as "Sun, Oct 11, 3:00 AM".
 */
export function formatWhen(iso: string): string
{
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** "1st", "2nd", "3rd", "4th". */
export function ordinal(n: number): string
{
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/**
 * Names what a job works on, in place of a URL count.
 *
 * @param job - The job.
 * @returns A label such as "@willtong93 · MediUX creator" or "2 sets · ThePosterDB and MediUX".
 */
export function jobIdentity(job: ScheduledJob): string
{
  const creators = [...new Set(job.urls.map(creatorOfUrl).filter((c): c is string => !!c))]
  if (job.creator && creators.length <= 1) return `@${job.creator} · MediUX creator`
  if (creators.length === 1 && job.urls.length === 1) return `@${creators[0]} · MediUX creator`
  const sites = [...new Set(job.urls.map(u => classifyUrl(u)).filter(s => s !== 'unknown'))]
    .map(s => (s === 'posterdb' ? 'ThePosterDB' : 'MediUX'))
  const n = job.urls.length
  return `${n} ${n === 1 ? 'set' : 'sets'}${sites.length ? ` · ${sites.join(' and ')}` : ''}`
}

/** Status shown for a job in the list and the detail header. */
export function jobStatus(job: ScheduledJob, starting: boolean): RowStatus | undefined
{
  if (starting || job.lastStatus === 'running') return 'running'
  if (job.queued) return 'queued'
  if (!job.enabled) return 'paused'
  return job.lastStatus as JobRun['status'] | undefined
}

/** Label for a status chip. */
export function statusLabel(job: ScheduledJob, status: RowStatus): string
{
  if (status !== 'queued') return STATUS_LABEL[status]
  return `Queued · ${job.queuePosition && job.queuePosition > 1 ? `${ordinal(job.queuePosition)} in line` : 'next'}`
}
