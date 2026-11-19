import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('../../electron/services/config', () => ({
  ConfigService: { get: () => ({}) },
}))

const { withTimeout, waitAtMost } = await import('../../electron/scrapers/baseScraper')
const { createInFlight } = await import('../../electron/services/inFlight')
const { readableError, isTimeoutError, errorWithCause } = await import('../../electron/services/readableError')

/** A promise the test settles by hand. */
function deferred<T>()
{
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res =>
  {
    resolve = res
  })
  return { promise, resolve }
}

afterEach(() =>
{
  vi.useRealTimers()
})

describe('withTimeout', () =>
{
  it('passes through work that settles in time', async () =>
  {
    await expect(withTimeout(Promise.resolve(7), 1_000, 'late')).resolves.toBe(7)
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000, 'late')).rejects.toThrow('boom')
  })

  it('rejects with the message once the time runs out', async () =>
  {
    vi.useFakeTimers()
    const work = deferred<number>()
    const waiting = expect(withTimeout(work.promise, 5_000, 'too slow')).rejects.toThrow('too slow')
    await vi.advanceTimersByTimeAsync(5_000)
    await waiting
    work.resolve(1)
  })
})

describe('waitAtMost', () =>
{
  it('returns when the work settles, failures included', async () =>
  {
    await expect(waitAtMost(Promise.reject(new Error('boom')), 1_000)).resolves.toBeUndefined()
    await expect(waitAtMost(Promise.resolve('done'), 1_000)).resolves.toBeUndefined()
  })

  it('stops waiting after the given time', async () =>
  {
    vi.useFakeTimers()
    let returned = false
    const waiting = waitAtMost(new Promise(() => {}), 2_000).then(() =>
    {
      returned = true
    })
    await vi.advanceTimersByTimeAsync(1_999)
    expect(returned).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(returned).toBe(true)
  })
})

describe('createInFlight', () =>
{
  it('shares a running task among callers asking for the same key', async () =>
  {
    const share = createInFlight<number>()
    const work = deferred<number>()
    const run = vi.fn(() => work.promise)
    const first = share('a', run)
    const second = share('a', run)
    const other = share('b', async () => 2)
    work.resolve(1)
    expect(await Promise.all([first, second, other])).toEqual([1, 1, 2])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('starts the task again once it settles, failures included', async () =>
  {
    const share = createInFlight<number>()
    const run = vi.fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(3)
    await expect(share('a', run)).rejects.toThrow('boom')
    await expect(share('a', run)).resolves.toBe(3)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('turns a task that throws at once into a rejection', async () =>
  {
    const share = createInFlight<number>()
    await expect(share('a', () =>
    {
      throw new Error('at once')
    })).rejects.toThrow('at once')
    await expect(share('a', async () => 4)).resolves.toBe(4)
  })
})

describe('readableError', () =>
{
  const ESC = String.fromCharCode(27)

  it('drops the Playwright call log and says a timeout in seconds', () =>
  {
    const err = new Error(`page.goto: Timeout 45000ms exceeded.\nCall log:\n${ESC}[2m  - navigating to "https://mediux.pro/movies/1", waiting until "domcontentloaded"${ESC}[22m\n`)
    expect(readableError(err)).toBe('the page did not load within 45 seconds')
    expect(isTimeoutError(err)).toBe(true)
  })

  it('names a fetch that ran out of time', () =>
  {
    const err = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    expect(readableError(err)).toBe('the site did not answer in time')
    expect(isTimeoutError(err)).toBe(true)
  })

  it('keeps the error behind a message for the user as its cause', () =>
  {
    const behind = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    const err = errorWithCause('it took more than a minute to answer', behind)
    expect(err.message).toBe('it took more than a minute to answer')
    expect((err as Error & { cause?: unknown }).cause).toBe(behind)
    expect(isTimeoutError(err)).toBe(false)
  })

  it('keeps other messages and strips color codes', () =>
  {
    expect(readableError(new Error('HTTP 500 with an empty page'))).toBe('HTTP 500 with an empty page')
    expect(readableError(`${ESC}[31mboom${ESC}[39m`)).toBe('boom')
    expect(isTimeoutError(new Error('fetch failed'))).toBe(false)
    expect(isTimeoutError(null)).toBe(false)
  })
})
