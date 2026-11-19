import type { ScheduledJob } from '../../ipc/types'
import { classifyUrl } from '../../scrapers/urlSource'
import { nextCronRuns, cronExpressionError } from './cron'
import { parseArtworkTypes } from './artworkTypes'

const MAX_NAME_LENGTH = 120

/** Raised for job payloads the scheduler refuses to save; the message is shown to the user. */
export class ScheduleValidationError extends Error
{
  /** Read by Fastify so the web API replies 400 instead of 500. */
  readonly statusCode = 400

  constructor(message: string)
  {
    super(message)
    this.name = 'ScheduleValidationError'
  }
}

/**
 * Attaches each enabled job's next firing time for display.
 *
 * @param jobs - Stored jobs.
 * @param now - Reference time.
 * @returns Copies with nextRun set on enabled jobs and cleared on the rest.
 */
export function withNextRun(jobs: ScheduledJob[], now: Date): ScheduledJob[]
{
  return jobs.map(job =>
  {
    const rest = { ...job }
    delete rest.nextRun
    if (!job.enabled) return rest
    try
    {
      const [next] = nextCronRuns(job.cronExpr, now, 1)
      return next ? { ...rest, nextRun: next.toISOString() } : rest
    }
    catch
    {
      return rest
    }
  })
}

/**
 * Comparison key for URLs: case, scheme, a leading www., and trailing slashes
 * are ignored.
 *
 * @param url - URL to normalize.
 * @returns The comparison key.
 */
export function urlKey(url: string): string
{
  const key = url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
  let end = key.length
  while (end > 0 && key[end - 1] === '/') end--
  return key.slice(0, end)
}

/** Result of checking the editor's URL list. */
export interface UrlAnalysis
{
  /** Trimmed, de-duplicated URLs in their original order. */
  urls: string[]
  /** URLs from sites the scrapers do not support. */
  unsupported: string[]
  /** Lines dropped as repeats of an earlier URL. */
  duplicates: number
}

/**
 * Trims, de-duplicates, and checks a list of job URLs.
 *
 * @param input - Newline-separated text or an array of URLs.
 * @returns The usable URLs with any unsupported entries and the duplicate count.
 */
export function analyzeUrls(input: string | string[]): UrlAnalysis
{
  const lines = (Array.isArray(input) ? input : input.split(/\r?\n/)).map(l => l.trim()).filter(Boolean)
  const seen = new Set<string>()
  const result: UrlAnalysis = { urls: [], unsupported: [], duplicates: 0 }
  for (const line of lines)
  {
    const key = urlKey(line)
    if (seen.has(key))
    {
      result.duplicates++
      continue
    }
    seen.add(key)
    result.urls.push(line)
    if (classifyUrl(line) === 'unknown') result.unsupported.push(line)
  }
  return result
}

/** Options for {@link normalizeJob}. */
export interface NormalizeOptions
{
  /** Generates an id for jobs saved without one. */
  makeId: () => string
  /** Authoritative cron check, node-cron's validate on the server. */
  isValidCron?: (expr: string) => boolean
  /** Reference time for the never-fires check. */
  now?: Date
}

/**
 * Validates and cleans a job payload before it is stored. Run status and
 * history are owned by the scheduler, so they are taken from the stored job
 * rather than the payload.
 *
 * @param input - Payload from the renderer or the web API.
 * @param existing - The stored job with the same id, when updating.
 * @param options - Id generation and cron validation hooks.
 * @returns The job to store.
 * @throws ScheduleValidationError with a user-facing message.
 */
export function normalizeJob(input: unknown, existing: ScheduledJob | undefined, options: NormalizeOptions): ScheduledJob
{
  if (!input || typeof input !== 'object') throw new ScheduleValidationError('Job data is missing')
  const raw = input as Record<string, unknown>

  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) throw new ScheduleValidationError('Give the job a name')
  if (name.length > MAX_NAME_LENGTH) throw new ScheduleValidationError(`Job names are limited to ${MAX_NAME_LENGTH} characters`)

  const urlInput = Array.isArray(raw.urls) ? raw.urls.filter((u): u is string => typeof u === 'string') : []
  const { urls, unsupported } = analyzeUrls(urlInput)
  if (!urls.length) throw new ScheduleValidationError('Add at least one ThePosterDB or MediUX URL')
  if (unsupported.length) throw new ScheduleValidationError(`Unsupported URL: ${unsupported[0]} (use theposterdb.com or mediux.pro links)`)

  const cronExpr = typeof raw.cronExpr === 'string' ? raw.cronExpr.trim().replace(/\s+/g, ' ') : ''
  const cronError = cronExpressionError(cronExpr, options.now)
  if (cronError) throw new ScheduleValidationError(cronError)
  if (options.isValidCron && !options.isValidCron(cronExpr))
  {
    throw new ScheduleValidationError(`"${cronExpr}" is not a supported cron expression`)
  }

  let id: string
  if (raw.id === undefined || raw.id === null || raw.id === '')
  {
    id = options.makeId()
  }
  else if (typeof raw.id === 'string' && /^[\w-]{1,100}$/.test(raw.id))
  {
    id = raw.id
  }
  else
  {
    throw new ScheduleValidationError('Invalid job id')
  }

  const assetTypes = parseArtworkTypes(raw.assetTypes)
  if (assetTypes && !assetTypes.length) throw new ScheduleValidationError('Pick at least one type of artwork for the job')

  const creator = typeof raw.creator === 'string' && raw.creator.trim() ? raw.creator.trim() : undefined
  const job: ScheduledJob = {
    id,
    name,
    urls,
    cronExpr,
    enabled: raw.enabled !== false,
    skipApplied: raw.skipApplied !== false,
  }
  if (raw.fillGaps === true) job.fillGaps = true
  if (assetTypes) job.assetTypes = assetTypes
  if (creator) job.creator = creator
  if (typeof raw.since === 'string' && !Number.isNaN(Date.parse(raw.since))) job.since = new Date(raw.since).toISOString()
  if (existing?.lastRun) job.lastRun = existing.lastRun
  if (existing?.lastStatus) job.lastStatus = existing.lastStatus
  if (existing?.lastError) job.lastError = existing.lastError
  if (existing?.history?.length) job.history = existing.history
  return job
}

/**
 * Puts jobs in the order given, keeping any job not listed at the end in its
 * current order.
 *
 * @param jobs - Stored jobs.
 * @param ids - Job ids in the wanted order.
 * @returns The reordered list.
 */
export function reorderJobs(jobs: ScheduledJob[], ids: string[]): ScheduledJob[]
{
  const byId = new Map(jobs.map(j => [j.id, j]))
  const ordered: ScheduledJob[] = []
  for (const id of ids)
  {
    const job = byId.get(id)
    if (job)
    {
      ordered.push(job)
      byId.delete(id)
    }
  }
  return [...ordered, ...byId.values()]
}
