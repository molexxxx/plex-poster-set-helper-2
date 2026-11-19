import type { CronPreview } from '../../ipc/types'
import { DAY_NAMES, DAY_OF_WEEK, cronFields, parseList, parseCron, nextCronRuns, cronExpressionError } from './cron'

/** Interval choices offered by the hourly preset. */
export const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12]

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
 * Formats a time of day the way the app shows times everywhere else.
 *
 * @param hour - Hour, 0 to 23.
 * @param minute - Minute, 0 to 59.
 * @returns A label such as "3:00 AM" or "12:30 PM".
 */
function clock12(hour: number, minute: number): string
{
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}:${pad2(minute)} ${hour < 12 ? 'AM' : 'PM'}`
}

/**
 * Describes a cron expression in plain words, falling back to the expression
 * itself for shapes without a natural description.
 *
 * @param expr - Cron expression.
 * @returns A label such as "Every Sunday at 3:00 AM" or "Every 6 hours".
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
  const time = isNum(min) && isNum(hour) ? clock12(Number(hour), Number(min)) : null

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
