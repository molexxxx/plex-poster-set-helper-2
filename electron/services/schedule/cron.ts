const LOOKAHEAD_DAYS = 366 * 30
/** Weekday names, Sunday first, in the order cron numbers them. */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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
/** The weekday field: 0 to 7, where both 0 and 7 mean Sunday, or a day name. */
export const DAY_OF_WEEK: FieldSpec = { label: 'weekday', min: 0, max: 7, wrapMax: 6, names: WEEKDAY_NAMES, nameBase: 0 }

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

/**
 * Expands one cron field's list of values, ranges, and steps.
 *
 * @param field - The field's text, such as "1-5" or "0-30/10".
 * @param spec - The field's bounds and names.
 * @returns Every value the field allows, ascending.
 * @throws CronSyntaxError for a value the field does not accept.
 */
export function parseList(field: string, spec: FieldSpec): number[]
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
