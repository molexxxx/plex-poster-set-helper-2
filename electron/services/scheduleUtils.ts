import type { AppliedRecord, CronPreview, JobProgress, JobRun, JobRunDetails, LibraryArtFilter, PosterInfo, ScheduledJob } from '../ipc/types'
import { classifyUrl } from '../scrapers/urlSource'

/** Schedule the quick Schedule and Sync actions use until the user picks another. */
export const DEFAULT_QUICK_CRON = '0 3 * * 0'
/** Runs kept per job. */
export const MAX_JOB_HISTORY = 10
/** Applied-poster history entries kept in config. */
export const MAX_APPLIED_RECORDS = 2000
/** Interval choices offered by the hourly preset. */
export const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12]
/** Status message for a job that was running when the app stopped. */
export const INTERRUPTED_MESSAGE = 'Interrupted - the app stopped while this job was running'
/** Titles listed per category in a run's details before the list is cut off. */
export const MAX_RUN_DETAIL = 100

const MAX_NAME_LENGTH = 120
const LOOKAHEAD_DAYS = 366 * 30
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const WEEKDAY_NAMES = DAY_NAMES.map(d => d.toLowerCase())

const NICKNAMES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

interface FieldSpec
{
  label: string
  min: number
  max: number
  /** Upper bound used to wrap reversed ranges such as fri-mon. */
  wrapMax?: number
  names?: string[]
  nameBase?: number
}

const SECOND: FieldSpec = { label: 'second', min: 0, max: 59 }
const MINUTE: FieldSpec = { label: 'minute', min: 0, max: 59 }
const HOUR: FieldSpec = { label: 'hour', min: 0, max: 23 }
const DAY_OF_MONTH: FieldSpec = { label: 'day of month', min: 1, max: 31 }
const MONTH: FieldSpec = { label: 'month', min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 }
const DAY_OF_WEEK: FieldSpec = { label: 'weekday', min: 0, max: 7, wrapMax: 6, names: WEEKDAY_NAMES, nameBase: 0 }

interface DayOfMonthRule
{
  any: boolean
  days: Set<number>
  last: boolean
  lastOffsets: number[]
  nearestWeekday: Array<number | 'L'>
}

interface DayOfWeekRule
{
  any: boolean
  days: Set<number>
  lastOf: Set<number>
  nth: Array<{ weekday: number; nth: number }>
}

/** A cron expression broken into the values each field allows. */
export interface ParsedCron
{
  seconds: number[]
  minutes: number[]
  hours: number[]
  months: Set<number>
  dayOfMonth: DayOfMonthRule
  dayOfWeek: DayOfWeekRule
}

/** Raised for malformed cron expressions; the message is shown to the user. */
export class CronSyntaxError extends Error
{
  constructor(message: string)
  {
    super(message)
    this.name = 'CronSyntaxError'
  }
}

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
 * Splits an expression into six fields (seconds first), resolving @nicknames
 * and adding the implied seconds field to five-field expressions.
 *
 * @param expr - Cron expression.
 * @returns Seconds, minute, hour, day of month, month, and weekday fields.
 */
export function cronFields(expr: string): string[]
{
  const trimmed = expr.trim()
  if (!trimmed) throw new CronSyntaxError('Enter a cron expression')
  const resolved = NICKNAMES[trimmed.toLowerCase()] ?? trimmed
  const fields = resolved.split(/\s+/)
  if (fields.length === 5) return ['0', ...fields]
  if (fields.length === 6) return fields
  throw new CronSyntaxError(`Expected 5 fields (minute hour day month weekday) but found ${fields.length}`)
}

function fieldValue(token: string, spec: FieldSpec): number
{
  if (/^\d+$/.test(token))
  {
    const n = Number(token)
    if (n >= spec.min && n <= spec.max) return n
  }
  else if (spec.names)
  {
    const lower = token.toLowerCase()
    const idx = spec.names.findIndex(n => n === lower || n.slice(0, 3) === lower)
    if (idx >= 0) return idx + (spec.nameBase ?? 0)
  }
  throw new CronSyntaxError(`"${token}" is not a valid ${spec.label}`)
}

function parseList(field: string, spec: FieldSpec): number[]
{
  const out = new Set<number>()
  for (const part of field.split(','))
  {
    if (!part) throw new CronSyntaxError(`The ${spec.label} field has an empty value`)
    const pieces = part.split('/')
    if (pieces.length > 2) throw new CronSyntaxError(`"${part}" is not a valid ${spec.label}`)
    const [range, stepText] = pieces
    let step = 1
    if (stepText !== undefined)
    {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1)
      {
        throw new CronSyntaxError(`"${stepText}" is not a valid step in the ${spec.label} field`)
      }
      if (range !== '*' && !range.includes('-'))
      {
        throw new CronSyntaxError(`A step needs * or a range, as in */${stepText} or 0-30/${stepText}`)
      }
      step = Number(stepText)
    }

    if (range === '*')
    {
      for (let v = spec.min; v <= (spec.wrapMax ?? spec.max); v += step) out.add(v)
      continue
    }

    const bounds = range.split('-')
    if (bounds.length > 2 || bounds.some(b => !b)) throw new CronSyntaxError(`"${range}" is not a valid ${spec.label}`)
    const first = fieldValue(bounds[0], spec)
    const last = bounds.length === 2 ? fieldValue(bounds[1], spec) : first
    if (first <= last)
    {
      for (let v = first; v <= last; v += step) out.add(v)
      continue
    }
    const max = spec.wrapMax ?? spec.max
    const size = max - spec.min + 1
    const span = ((last - first) % size + size) % size
    for (let offset = 0; offset <= span; offset += step)
    {
      let v = first + offset
      if (v > max) v -= size
      out.add(v)
    }
  }
  return [...out].sort((a, b) => a - b)
}

function parseDayOfMonth(field: string): DayOfMonthRule
{
  const rule: DayOfMonthRule = { any: false, days: new Set(), last: false, lastOffsets: [], nearestWeekday: [] }
  if (field === '*' || field === '?') return { ...rule, any: true }
  for (const part of field.split(','))
  {
    const token = part.toUpperCase()
    if (token === 'L')
    {
      rule.last = true
    }
    else if (/^L-\d{1,2}$/.test(token))
    {
      const offset = Number(token.slice(2))
      if (offset > 30) throw new CronSyntaxError(`"${part}" is not a valid day of month`)
      rule.lastOffsets.push(offset)
    }
    else if (/^(\d{1,2}|L)W$/.test(token))
    {
      const target = token.slice(0, -1)
      if (target === 'L') rule.nearestWeekday.push('L')
      else rule.nearestWeekday.push(fieldValue(target, DAY_OF_MONTH))
    }
    else
    {
      for (const d of parseList(part, DAY_OF_MONTH)) rule.days.add(d)
    }
  }
  return rule
}

function parseDayOfWeek(field: string): DayOfWeekRule
{
  const rule: DayOfWeekRule = { any: false, days: new Set(), lastOf: new Set(), nth: [] }
  if (field === '*' || field === '?') return { ...rule, any: true }
  for (const part of field.split(','))
  {
    const lastOf = /^([0-7])L$/i.exec(part)
    const nth = /^([0-7])#([1-5])$/.exec(part)
    if (lastOf)
    {
      rule.lastOf.add(Number(lastOf[1]) % 7)
    }
    else if (nth)
    {
      rule.nth.push({ weekday: Number(nth[1]) % 7, nth: Number(nth[2]) })
    }
    else
    {
      for (const d of parseList(part, DAY_OF_WEEK)) rule.days.add(d % 7)
    }
  }
  return rule
}

/**
 * Parses a cron expression with the same syntax node-cron accepts: five or six
 * fields, @nicknames, names, ranges (including wrap-around ranges), steps,
 * lists, and the L, W, and # day tokens.
 *
 * @param expr - Cron expression.
 * @returns The allowed values for each field.
 * @throws CronSyntaxError when the expression is malformed.
 */
export function parseCron(expr: string): ParsedCron
{
  const [sec, min, hour, dom, month, dow] = cronFields(expr)
  return {
    seconds: parseList(sec, SECOND),
    minutes: parseList(min, MINUTE),
    hours: parseList(hour, HOUR),
    dayOfMonth: parseDayOfMonth(dom),
    months: new Set(parseList(month, MONTH)),
    dayOfWeek: parseDayOfWeek(dow),
  }
}

function daysInMonth(year: number, month: number): number
{
  return new Date(year, month, 0).getDate()
}

function nearestWeekday(year: number, month: number, target: number): number
{
  const last = daysInMonth(year, month)
  if (target < 1 || target > last) return -1
  const weekday = new Date(year, month - 1, target).getDay()
  if (weekday === 6) return target === 1 ? target + 2 : target - 1
  if (weekday === 0) return target === last ? target - 2 : target + 1
  return target
}

function matchesDayOfMonth(rule: DayOfMonthRule, year: number, month: number, day: number): boolean
{
  if (rule.any || rule.days.has(day)) return true
  const last = daysInMonth(year, month)
  if (rule.last && day === last) return true
  if (rule.lastOffsets.some(o => last - o >= 1 && last - o === day)) return true
  return rule.nearestWeekday.some(t => nearestWeekday(year, month, t === 'L' ? last : t) === day)
}

function matchesDayOfWeek(rule: DayOfWeekRule, year: number, month: number, day: number, weekday: number): boolean
{
  if (rule.any || rule.days.has(weekday)) return true
  if (rule.lastOf.has(weekday) && day + 7 > daysInMonth(year, month)) return true
  return rule.nth.some(n => n.weekday === weekday && Math.floor((day - 1) / 7) + 1 === n.nth)
}

function nextAfter(cron: ParsedCron, from: Date): Date | null
{
  const fromMs = from.getTime()
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let i = 0; i < LOOKAHEAD_DAYS; i++)
  {
    const year = cursor.getFullYear()
    const month = cursor.getMonth() + 1
    const day = cursor.getDate()
    // node-cron requires both day fields to match, unlike classic cron's OR rule.
    if (cron.months.has(month)
      && matchesDayOfMonth(cron.dayOfMonth, year, month, day)
      && matchesDayOfWeek(cron.dayOfWeek, year, month, day, cursor.getDay()))
    {
      for (const hour of cron.hours)
      {
        if (i === 0 && hour < from.getHours()) continue
        for (const minute of cron.minutes)
        {
          for (const second of cron.seconds)
          {
            const t = new Date(year, month - 1, day, hour, minute, second)
            if (t.getHours() !== hour) continue
            if (t.getTime() > fromMs) return t
          }
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return null
}

/**
 * Lists the upcoming firings of a cron expression in local time.
 *
 * @param expr - Cron expression.
 * @param from - Firings strictly after this instant are returned.
 * @param count - How many firings to return.
 * @returns Up to `count` dates; fewer when the schedule stops firing.
 * @throws CronSyntaxError when the expression is malformed.
 */
export function nextCronRuns(expr: string, from: Date, count = 1): Date[]
{
  const cron = parseCron(expr)
  const runs: Date[] = []
  let cursor = from
  while (runs.length < count)
  {
    const next = nextAfter(cron, cursor)
    if (!next) break
    runs.push(next)
    cursor = next
  }
  return runs
}

/**
 * Checks a cron expression for syntax errors and schedules that never fire.
 *
 * @param expr - Cron expression.
 * @param now - Reference time for the never-fires check.
 * @returns A user-facing error message, or null when the expression is usable.
 */
export function cronExpressionError(expr: string, now: Date = new Date()): string | null
{
  try
  {
    return nextCronRuns(expr, now, 1).length ? null : 'This schedule never fires'
  }
  catch (err)
  {
    return err instanceof Error ? err.message : String(err)
  }
}

function pad2(n: number | string): string
{
  return String(n).padStart(2, '0')
}

function ordinal(n: number): string
{
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

function joinWords(items: string[]): string
{
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function sameNumbers(a: number[], b: number[]): boolean
{
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Describes a cron expression in plain words, falling back to the expression
 * itself for shapes without a natural description.
 *
 * @param expr - Cron expression.
 * @returns A label such as "Every Sunday at 03:00" or "Every 6 hours".
 */
export function describeCron(expr: string): string
{
  const fallback = expr.trim()
  let fields: string[]
  try
  {
    fields = cronFields(expr)
    parseCron(expr)
  }
  catch
  {
    return fallback
  }
  const [sec, min, hour, dom, month, dow] = fields
  if (sec !== '0' || month !== '*') return fallback

  const isNum = (s: string) => /^\d+$/.test(s)
  const anyDay = (s: string) => s === '*' || s === '?'
  const time = isNum(min) && isNum(hour) ? `${pad2(hour)}:${pad2(min)}` : null

  if (anyDay(dom) && anyDay(dow))
  {
    if (time) return `Every day at ${time}`
    const hourStep = /^\*\/(\d+)$/.exec(hour)
    if (isNum(min) && (hour === '*' || hourStep))
    {
      const every = hourStep ? Number(hourStep[1]) : 1
      const base = every === 1 ? 'Every hour' : `Every ${every} hours`
      return min === '0' ? base : `${base} at :${pad2(min)}`
    }
    const minuteStep = /^\*\/(\d+)$/.exec(min)
    if (minuteStep && hour === '*') return Number(minuteStep[1]) === 1 ? 'Every minute' : `Every ${minuteStep[1]} minutes`
    if (min === '*' && hour === '*') return 'Every minute'
    return fallback
  }

  if (!time) return fallback

  if (anyDay(dom) && /^[a-z0-9,-]+$/i.test(dow) && !/(^|,)[0-7]l(,|$)/i.test(dow))
  {
    const days = [...new Set(parseList(dow, DAY_OF_WEEK).map(d => d % 7))].sort((a, b) => a - b)
    if (days.length === 7) return `Every day at ${time}`
    if (sameNumbers(days, [1, 2, 3, 4, 5])) return `Weekdays at ${time}`
    if (sameNumbers(days, [0, 6])) return `Weekends at ${time}`
    if (days.length === 1) return `Every ${DAY_NAMES[days[0]]} at ${time}`
    return `${joinWords(days.map(d => DAY_SHORT[d]))} at ${time}`
  }

  if (anyDay(dow) && isNum(dom)) return `Monthly on the ${ordinal(Number(dom))} at ${time}`
  if (anyDay(dow) && dom.toUpperCase() === 'L') return `Monthly on the last day at ${time}`
  return fallback
}

/**
 * Evaluates an expression for the job editor's live preview.
 *
 * @param expr - Cron expression.
 * @param now - Reference time.
 * @param timeZone - IANA zone the scheduler runs in, reported back to the editor.
 * @param count - How many upcoming firings to include.
 * @returns Validity, an error message, a description, and the next firings.
 */
export function previewCron(expr: string, now: Date, timeZone: string, count = 3): CronPreview
{
  const error = cronExpressionError(expr, now)
  return {
    valid: !error,
    ...(error ? { error } : {}),
    description: describeCron(expr),
    nextRuns: error ? [] : nextCronRuns(expr, now, count).map(d => d.toISOString()),
    timeZone,
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

export type SchedulePreset = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

/** Field values behind the job editor's schedule picker. */
export interface ScheduleForm
{
  preset: SchedulePreset
  /** Hour of day, 0-23 (daily, weekly, monthly). */
  hour: number
  /** Minute of hour, 0-59. */
  minute: number
  /** Weekdays, 0 = Sunday (weekly). */
  days: number[]
  /** Day of month, 1-31 (monthly). */
  dayOfMonth: number
  /** Hours between runs (hourly). */
  everyHours: number
  /** Raw expression (custom). */
  custom: string
}

/**
 * Builds the cron expression for the editor's picker values.
 *
 * @param form - Picker values.
 * @returns The expression; a weekly form with no days runs every day.
 */
export function formToCron(form: ScheduleForm): string
{
  const { minute, hour } = form
  switch (form.preset)
  {
    case 'hourly':
      return form.everyHours > 1 ? `${minute} */${form.everyHours} * * *` : `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
    {
      const days = [...new Set(form.days)].sort((a, b) => a - b)
      return `${minute} ${hour} * * ${days.length ? days.join(',') : '*'}`
    }
    case 'monthly':
      return `${minute} ${hour} ${form.dayOfMonth} * *`
    default:
      return form.custom.trim()
  }
}

/**
 * Maps an expression back onto the editor's picker, choosing the custom preset
 * for anything the picker cannot represent.
 *
 * @param expr - Cron expression.
 * @returns Picker values; `custom` always holds the original expression.
 */
export function cronToForm(expr: string): ScheduleForm
{
  const trimmed = expr.trim()
  const form: ScheduleForm = {
    preset: 'custom', hour: 3, minute: 0, days: [0], dayOfMonth: 1, everyHours: 6,
    custom: trimmed || '0 3 * * *',
  }
  const parts = trimmed.split(/\s+/)
  if (parts.length !== 5) return form
  const [min, hr, dom, month, dow] = parts
  const isNum = (s: string) => /^\d+$/.test(s)
  if (month !== '*' || !isNum(min) || Number(min) > 59) return form
  const minute = Number(min)

  const hourStep = /^\*\/(\d+)$/.exec(hr)
  if (dom === '*' && dow === '*' && (hr === '*' || (hourStep && HOUR_INTERVALS.includes(Number(hourStep[1])))))
  {
    return { ...form, preset: 'hourly', minute, everyHours: hourStep ? Number(hourStep[1]) : 1 }
  }

  if (!isNum(hr) || Number(hr) > 23) return form
  const hour = Number(hr)
  if (dom === '*' && dow === '*') return { ...form, preset: 'daily', hour, minute }
  if (dom === '*' && /^[0-7](?:[,-][0-7])*$/.test(dow))
  {
    const days = [...new Set(parseList(dow, DAY_OF_WEEK).map(d => d % 7))].sort((a, b) => a - b)
    return { ...form, preset: 'weekly', hour, minute, days }
  }
  if (dow === '*' && isNum(dom) && Number(dom) >= 1 && Number(dom) <= 31)
  {
    return { ...form, preset: 'monthly', hour, minute, dayOfMonth: Number(dom) }
  }
  return form
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
  return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
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
  if (creator) job.creator = creator
  if (existing?.lastRun) job.lastRun = existing.lastRun
  if (existing?.lastStatus) job.lastStatus = existing.lastStatus
  if (existing?.lastError) job.lastError = existing.lastError
  if (existing?.history?.length) job.history = existing.history
  return job
}

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

function coversUrl(job: ScheduledJob, url: string, creator?: string): boolean
{
  const key = urlKey(url)
  if (job.urls.some(u => urlKey(u) === key)) return true
  if (!creator) return false
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
 * @param jobs - Current jobs.
 * @param req - The action's URLs, defaults, and creator.
 * @param makeId - Generates an id for a new job.
 * @returns The job to save (or the existing job when nothing changes).
 */
export function planQuickSync(jobs: ScheduledJob[], req: QuickSyncRequest, makeId: () => string): QuickSyncPlan
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
  return { kind: 'create', job }
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

/** Enabled jobs indexed by the MediUX sets and creators they sync. */
export interface ScheduleCoverage
{
  sets: Map<string, ScheduledJob>
  creators: Map<string, ScheduledJob>
}

/**
 * Indexes enabled jobs by MediUX set id and by creator-wide sync.
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
      const setId = mediuxSetId(url)
      if (setId && !coverage.sets.has(setId)) coverage.sets.set(setId, job)
      const creator = creatorOfUrl(url)
      if (creator && !coverage.creators.has(creator)) coverage.creators.set(creator, job)
    }
  }
  return coverage
}

/**
 * Finds the enabled job that syncs a MediUX set.
 *
 * @param coverage - Index from {@link scheduleCoverage}.
 * @param setId - MediUX set id.
 * @param creator - The set's uploader, matched against creator-wide jobs.
 * @returns The covering job, if any.
 */
export function coveringJob(coverage: ScheduleCoverage, setId: string, creator?: string): ScheduledJob | undefined
{
  return coverage.sets.get(setId) ?? (creator ? coverage.creators.get(creator.toLowerCase()) : undefined)
}

/**
 * Groups applied-poster history by Plex item.
 *
 * @param records - Applied-poster history.
 * @returns Item key to that item's records.
 */
export function appliedByItem(records: AppliedRecord[]): Map<string, AppliedRecord[]>
{
  const index = new Map<string, AppliedRecord[]>()
  for (const r of records)
  {
    const list = index.get(r.itemKey)
    if (list) list.push(r)
    else index.set(r.itemKey, [r])
  }
  return index
}

/**
 * Lists the creators whose art is on record, most-used first.
 *
 * @param records - Applied-poster history.
 * @returns Each creator with the number of items carrying their art.
 */
export function appliedUploaders(records: AppliedRecord[]): Array<{ uploader: string; count: number }>
{
  const items = new Map<string, { uploader: string; keys: Set<string> }>()
  for (const r of records)
  {
    if (!r.uploader) continue
    const k = r.uploader.toLowerCase()
    let entry = items.get(k)
    if (!entry) items.set(k, (entry = { uploader: r.uploader, keys: new Set() }))
    entry.keys.add(r.itemKey)
  }
  return [...items.values()]
    .map(e => ({ uploader: e.uploader, count: e.keys.size }))
    .sort((a, b) => b.count - a.count || a.uploader.localeCompare(b.uploader))
}

/**
 * Tells whether an item passes a Library Browser art filter.
 *
 * @param filter - The filter.
 * @param records - The item's applied-poster records.
 * @param coverage - Scheduled-job coverage from {@link scheduleCoverage}.
 * @returns true when the item should be shown.
 */
export function artFilterMatches(filter: LibraryArtFilter, records: AppliedRecord[], coverage: ScheduleCoverage): boolean
{
  switch (filter.kind)
  {
    case 'none':
      return records.length === 0
    case 'applied':
      return records.length > 0
    case 'uploader':
    {
      const wanted = filter.uploader.toLowerCase()
      return records.some(r => r.uploader?.toLowerCase() === wanted)
    }
    case 'unscheduled':
      return records.length > 0 && !records.some(r =>
        (!!r.setId && coverage.sets.has(r.setId))
        || (!!r.uploader && coverage.creators.has(r.uploader.toLowerCase())))
    default:
      return true
  }
}

/**
 * Collects every image URL ever applied to each Plex item.
 *
 * @param records - Applied-poster history.
 * @returns Item key to applied image URLs.
 */
export function appliedUrlIndex(records: AppliedRecord[]): Map<string, Set<string>>
{
  const index = new Map<string, Set<string>>()
  for (const r of records)
  {
    let urls = index.get(r.itemKey)
    if (!urls)
    {
      urls = new Set()
      index.set(r.itemKey, urls)
    }
    for (const u of r.posterUrls ?? []) urls.add(u)
  }
  return index
}

/**
 * Merges new applied entries into history. Entries dedupe on item and set, the
 * per-poster URLs and slots accumulate, and the newest entries move to the
 * front.
 *
 * @param existing - Current history, newest first.
 * @param incoming - Entries to record.
 * @param cap - Maximum entries kept.
 * @returns The updated history.
 */
export function mergeAppliedRecords(existing: AppliedRecord[], incoming: AppliedRecord[], cap = MAX_APPLIED_RECORDS): AppliedRecord[]
{
  let list = existing
  for (const rec of incoming)
  {
    const same = (r: AppliedRecord) => r.itemKey === rec.itemKey && r.setId === rec.setId
    const prior = list.find(same)
    const posterUrls = [...new Set([...(prior?.posterUrls ?? []), ...(rec.posterUrls ?? [])])]
    const merged: AppliedRecord = { ...rec, posterUrls }
    if (prior?.slots || rec.slots) merged.slots = [...new Set([...(prior?.slots ?? []), ...(rec.slots ?? [])])]
    list = [merged, ...list.filter(r => !same(r))]
  }
  return list.slice(0, cap)
}

/**
 * Names the art slot a poster fills on its Plex item.
 *
 * @param p - The poster.
 * @returns poster, backdrop, s<n> for a season poster, or s<n>e<n> for a title card.
 */
export function posterSlot(p: Pick<PosterInfo, 'season' | 'episode'>): string
{
  if (p.season === 'Backdrop') return 'backdrop'
  if (p.episode != null) return `s${p.season ?? '?'}e${p.episode}`
  if (typeof p.season === 'number') return `s${p.season}`
  return 'poster'
}

/** Which sets have filled each slot on each item, for fill-gaps jobs. */
export interface SlotCoverage
{
  /** Item key to the set ids (empty string when unknown) of slotless records. */
  whole: Map<string, Set<string>>
  /** Item key to slot to the set ids that filled it. */
  slots: Map<string, Map<string, Set<string>>>
}

/**
 * Indexes applied-poster history by item and slot.
 *
 * @param records - Applied-poster history.
 * @returns The coverage index for {@link isSlotCovered}.
 */
export function slotCoverage(records: AppliedRecord[]): SlotCoverage
{
  const coverage: SlotCoverage = { whole: new Map(), slots: new Map() }
  for (const r of records)
  {
    const setId = r.setId ?? ''
    if (!r.slots)
    {
      let sets = coverage.whole.get(r.itemKey)
      if (!sets) coverage.whole.set(r.itemKey, (sets = new Set()))
      sets.add(setId)
      continue
    }
    let bySlot = coverage.slots.get(r.itemKey)
    if (!bySlot) coverage.slots.set(r.itemKey, (bySlot = new Map()))
    for (const slot of r.slots)
    {
      let sets = bySlot.get(slot)
      if (!sets) bySlot.set(slot, (sets = new Set()))
      sets.add(setId)
    }
  }
  return coverage
}

/**
 * Marks a slot as filled by a set, so later posters in the same run see it.
 *
 * @param coverage - Index from {@link slotCoverage}.
 * @param itemKey - Plex item.
 * @param slot - Slot from {@link posterSlot}.
 * @param setId - The set that filled it.
 */
export function addSlotCoverage(coverage: SlotCoverage, itemKey: string, slot: string, setId?: string): void
{
  let bySlot = coverage.slots.get(itemKey)
  if (!bySlot) coverage.slots.set(itemKey, (bySlot = new Map()))
  let sets = bySlot.get(slot)
  if (!sets) bySlot.set(slot, (sets = new Set()))
  sets.add(setId ?? '')
}

/**
 * Classifies a poster by the MediUX file type filter it falls under.
 *
 * @param p - The poster.
 * @returns backdrop for background art, title_card for episode art, else poster.
 */
export function posterKind(p: Pick<PosterInfo, 'season' | 'episode'>): 'poster' | 'backdrop' | 'title_card'
{
  if (p.season === 'Backdrop') return 'backdrop'
  if (p.episode != null) return 'title_card'
  return 'poster'
}

/**
 * Tells whether art from another set already fills a slot. Records without
 * slots predate slot tracking and count as covering every slot on their item.
 * The poster's own set never blocks it, so an updated card still applies.
 *
 * @param coverage - Index from {@link slotCoverage}.
 * @param itemKey - Plex item.
 * @param slot - Slot from {@link posterSlot}.
 * @param setId - The set the poster comes from.
 * @returns true when a different set has filled the slot.
 */
export function isSlotCovered(coverage: SlotCoverage, itemKey: string, slot: string, setId?: string): boolean
{
  const own = setId ?? ''
  const other = (sets?: Set<string>) => !!sets && [...sets].some(s => s !== own)
  return other(coverage.whole.get(itemKey)) || other(coverage.slots.get(itemKey)?.get(slot))
}

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

/**
 * Turns a run's counters into its stored result. A run fails when no URL could
 * be read, is partial when some URLs or uploads failed, and succeeds otherwise.
 *
 * @param tally - Counters from the run.
 * @param startedAt - When the run started.
 * @param finishedAt - When the run finished.
 * @param trigger - What started the run.
 * @returns The run result.
 */
export function finishRun(tally: RunTally, startedAt: Date, finishedAt: Date, trigger: JobRun['trigger']): JobRun
{
  const status: JobRun['status'] = tally.urlCount > 0 && tally.urlErrors >= tally.urlCount
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

function plural(n: number, noun: string): string
{
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * Summarizes a run in one line.
 *
 * @param run - The run result.
 * @returns A label such as "2 posters applied · 40 already applied".
 */
export function describeRun(run: JobRun): string
{
  const parts: string[] = []
  if (run.uploaded) parts.push(`${plural(run.uploaded, 'poster')} applied`)
  if (run.skipped) parts.push(`${run.skipped} already applied`)
  if (run.covered) parts.push(`${run.covered} left to other art`)
  if (run.noTarget) parts.push(`${run.noTarget} without a season or episode in Plex`)
  if (run.unmatched) parts.push(`${plural(run.unmatched, 'title')} not in library`)
  if (run.failed) parts.push(`${run.failed} failed`)
  if (run.urlErrors) parts.push(`${plural(run.urlErrors, 'URL')} could not be read`)
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
