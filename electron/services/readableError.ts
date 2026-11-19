const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/**
 * Tells whether an error is a fetch or wait that ran out of time, as thrown
 * by AbortSignal.timeout or by Playwright.
 *
 * @param err - Anything caught.
 * @returns True for a timeout.
 */
export function isTimeoutError(err: unknown): boolean
{
  if (!err || typeof err !== 'object') return false
  const { name, message } = err as { name?: unknown; message?: unknown }
  return name === 'TimeoutError' || (typeof message === 'string' && /\bTimeout \d+ms exceeded\b/.test(message))
}

/**
 * Builds an error carrying a message for the user, keeping the error behind
 * it as its cause.
 *
 * @param message - What the user is told.
 * @param cause - The error that led to it.
 * @returns The new error.
 */
export function errorWithCause(message: string, cause: unknown): Error
{
  return Object.assign(new Error(message), { cause })
}

/**
 * Turns a scraper error into a short phrase for the UI, which shows it after
 * "MediUX could not be searched:", beside a linked page, or on a scrape queue
 * entry. Playwright's call log and terminal color codes are dropped, and
 * timeouts are said in seconds.
 *
 * @param err - Anything caught.
 * @returns The message to show.
 */
export function readableError(err: unknown): string
{
  const raw = err instanceof Error ? err.message : String(err)
  const text = raw.split(/\r?\nCall log:/)[0].replace(ANSI_COLOR, '').trim()
  const playwright = /^[\w.]+: Timeout (\d+)ms exceeded/.exec(text)
  if (playwright) return `the page did not load within ${Math.round(Number(playwright[1]) / 1000)} seconds`
  if (/^The operation was aborted due to timeout$/i.test(text)) return 'the site did not answer in time'
  return text
}
