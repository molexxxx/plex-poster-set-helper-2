import type { JobProgress, JobRun, JobRunDetails, ScheduledJob } from '../../ipc/types'

/** Runs kept per job. */
export const MAX_JOB_HISTORY = 10

/** Status message for a job that was running when the app stopped. */
export const INTERRUPTED_MESSAGE = 'Interrupted - the app stopped while this job was running'

/** Titles listed per category in a run's details before the list is cut off. */
export const MAX_RUN_DETAIL = 100

/**
 * Label for a title in run details.
 *
 * @param title - Media title.
 * @param year - Release year, when known.
 * @returns "Title (Year)" or the bare title.
 */
export function titleLabel(title: string, year?: number): string
{
  return year ? `${title} (${year})` : title
}

/** Counters collected while a job runs. */
export interface RunTally
{
  urlCount: number
  uploaded: number
  skipped: number
  unmatched: number
  failed: number
  urlErrors: number
  covered: number
  noTarget: number
  firstError?: string
  /** Title label to posters applied. */
  appliedTitles: Map<string, number>
  /** Title labels not found in the library. */
  unmatchedTitles: Set<string>
  /** Title label to the first upload error. */
  failedTitles: Map<string, string>
  /** Title label to posters left to other art. */
  coveredTitles: Map<string, number>
  /** Title label to posters whose season or episode is missing in Plex. */
  noTargetTitles: Map<string, number>
}

/**
 * Creates an empty tally for a run.
 *
 * @param urlCount - Number of URLs the job will scrape.
 * @returns Zeroed counters.
 */
export function emptyTally(urlCount: number): RunTally
{
  return {
    urlCount, uploaded: 0, skipped: 0, unmatched: 0, failed: 0, urlErrors: 0, covered: 0, noTarget: 0,
    appliedTitles: new Map(), unmatchedTitles: new Set(), failedTitles: new Map(),
    coveredTitles: new Map(), noTargetTitles: new Map(),
  }
}

function capList(items: string[]): string[]
{
  if (items.length <= MAX_RUN_DETAIL) return items
  return [...items.slice(0, MAX_RUN_DETAIL), `and ${items.length - MAX_RUN_DETAIL} more`]
}

/**
 * Builds the per-title details of a run from its tally.
 *
 * @param tally - Counters from the run.
 * @returns The details, or undefined when nothing was recorded.
 */
export function runDetails(tally: RunTally): JobRunDetails | undefined
{
  const counted = (m: Map<string, number>) => capList([...m].map(([t, n]) => `${t} · ${plural(n, 'poster')}`))
  if (!tally.appliedTitles.size && !tally.unmatchedTitles.size && !tally.failedTitles.size
    && !tally.coveredTitles.size && !tally.noTargetTitles.size) return undefined
  const details: JobRunDetails = {
    applied: counted(tally.appliedTitles),
    unmatched: capList([...tally.unmatchedTitles]),
    failed: capList([...tally.failedTitles].map(([t, e]) => `${t} · ${e}`)),
  }
  if (tally.coveredTitles.size) details.covered = counted(tally.coveredTitles)
  if (tally.noTargetTitles.size) details.noTarget = counted(tally.noTargetTitles)
  return details
}

/**
 * Turns a run's counters into its stored result. A run fails when no URL could
 * be read, is partial when some URLs or uploads failed, and succeeds otherwise.
 *
 * @param tally - Counters from the run.
 * @param startedAt - When the run started.
 * @param finishedAt - When the run finished.
 * @param trigger - What started the run.
 * @param stopped - The user stopped the run before it finished; what it did so far is kept.
 * @returns The run result.
 */
export function finishRun(tally: RunTally, startedAt: Date, finishedAt: Date, trigger: JobRun['trigger'], stopped = false): JobRun
{
  const status: JobRun['status'] = stopped
    ? 'stopped'
    : tally.urlCount > 0 && tally.urlErrors >= tally.urlCount
      ? 'error'
      : tally.failed > 0 || tally.urlErrors > 0 ? 'partial' : 'success'
  const run: JobRun = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    trigger,
    status,
    uploaded: tally.uploaded,
    skipped: tally.skipped,
    unmatched: tally.unmatched,
    failed: tally.failed,
    urlErrors: tally.urlErrors,
  }
  if (tally.covered) run.covered = tally.covered
  if (tally.noTarget) run.noTarget = tally.noTarget
  if (tally.firstError && status !== 'success') run.error = tally.firstError
  const details = runDetails(tally)
  if (details) run.details = details
  return run
}

/**
 * Builds the result for a run that stopped before doing any work.
 *
 * @param message - Why the run failed.
 * @param startedAt - When the run started.
 * @param finishedAt - When the run stopped.
 * @param trigger - What started the run.
 * @returns A failed run with zeroed counters.
 */
export function failedRun(message: string, startedAt: Date, finishedAt: Date, trigger: JobRun['trigger']): JobRun
{
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    trigger,
    status: 'error',
    uploaded: 0,
    skipped: 0,
    unmatched: 0,
    failed: 0,
    urlErrors: 0,
    error: message,
  }
}

function count(n: number): string
{
  return n.toLocaleString('en-US')
}

/**
 * Counts a noun, adding an "s" for any count but one.
 *
 * @param n - How many.
 * @param noun - The singular noun.
 * @returns The count and noun, such as "3 posters".
 */
export function plural(n: number, noun: string): string
{
  return `${count(n)} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * Summarizes a run in one line.
 *
 * @param run - The run result.
 * @returns A label such as "2 posters applied · 1,040 already applied".
 */
export function describeRun(run: JobRun): string
{
  const parts: string[] = []
  if (run.uploaded) parts.push(`${plural(run.uploaded, 'poster')} applied`)
  if (run.skipped) parts.push(`${count(run.skipped)} already applied`)
  if (run.covered) parts.push(`${count(run.covered)} left to other art`)
  if (run.noTarget) parts.push(`${count(run.noTarget)} without a season or episode in Plex`)
  if (run.unmatched) parts.push(`${plural(run.unmatched, 'title')} not in library`)
  if (run.failed) parts.push(`${count(run.failed)} failed`)
  if (run.urlErrors) parts.push(`${plural(run.urlErrors, 'link')} could not be read`)
  if (run.status === 'stopped') return parts.length ? `Stopped · ${parts.join(' · ')}` : 'Stopped before anything was applied'
  if (!parts.length) return run.status === 'error' ? run.error ?? 'Failed' : 'Nothing new to apply'
  if (!run.uploaded && run.status === 'success') parts.unshift('Up to date')
  return parts.join(' · ')
}

/**
 * Stores a finished run on its job.
 *
 * @param job - The job that ran.
 * @param run - The run result.
 * @returns The job with its status fields and history updated.
 */
export function recordRun(job: ScheduledJob, run: JobRun): ScheduledJob
{
  const updated: ScheduledJob = {
    ...job,
    lastRun: run.startedAt,
    lastStatus: run.status,
    history: [run, ...(job.history ?? [])].slice(0, MAX_JOB_HISTORY),
  }
  if (run.error) updated.lastError = run.error
  else delete updated.lastError
  return updated
}

/**
 * Marks jobs left in the running state by a previous process as interrupted.
 *
 * @param jobs - Stored jobs.
 * @returns The jobs, and whether any changed.
 */
export function recoverInterrupted(jobs: ScheduledJob[]): { jobs: ScheduledJob[]; changed: boolean }
{
  let changed = false
  const next = jobs.map(job =>
  {
    if (job.lastStatus !== 'running') return job
    changed = true
    return { ...job, lastStatus: 'error' as const, lastError: INTERRUPTED_MESSAGE }
  })
  return { jobs: next, changed }
}

/**
 * Describes where a running job is.
 *
 * @param p - The job's progress.
 * @returns A label such as "Reading @creator's sets · 312 found" or
 *   "Show (2020) · 4 of 1,876 · art 12 of 80".
 */
export function describeProgress(p: JobProgress): string
{
  if (p.phase === 'reading')
  {
    return `Reading ${p.current ?? 'the creator'}'s sets${p.done ? ` · ${p.done.toLocaleString()} found` : ''}`
  }
  const position = p.total ? ` · ${Math.min(p.done + 1, p.total).toLocaleString()} of ${p.total.toLocaleString()}` : ''
  const art = p.poster && p.poster.total > 1
    ? ` · art ${Math.min(p.poster.done + 1, p.poster.total).toLocaleString()} of ${p.poster.total.toLocaleString()}`
    : ''
  return `${p.current ?? 'Applying'}${position}${art}`
}

/**
 * Formats the distance between two instants, such as "in 2h 15m" or "3d ago".
 *
 * @param target - The instant to describe.
 * @param now - The reference instant.
 * @returns A short relative label.
 */
export function relativeTime(target: Date | string | number, now: Date | number = Date.now()): string
{
  const diff = new Date(target).getTime() - new Date(now).getTime()
  const abs = Math.abs(diff)
  if (abs < 45_000) return diff > 0 ? 'in a moment' : 'just now'
  const minutes = Math.round(abs / 60_000)
  let label: string
  if (minutes < 60)
  {
    label = `${minutes}m`
  }
  else if (minutes < 24 * 60)
  {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    label = m ? `${h}h ${m}m` : `${h}h`
  }
  else
  {
    const d = Math.floor(minutes / (24 * 60))
    const h = Math.floor((minutes % (24 * 60)) / 60)
    label = h ? `${d}d ${h}h` : `${d}d`
  }
  return diff > 0 ? `in ${label}` : `${label} ago`
}
