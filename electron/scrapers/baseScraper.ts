import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { ConfigService } from '../services/config'
import type { PosterInfo } from '../ipc/types'

/** User-agent rotation pool for scraper contexts. */
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
]

/** Viewport rotation pool for scraper contexts. */
export const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
]

/**
 * Returns a random element from the array.
 *
 * @param arr - Pool to pick from; must be non-empty.
 * @returns One element, uniformly random.
 */
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Returns a random number in [min, max).
 *
 * @param min - Lower bound, inclusive.
 * @param max - Upper bound, exclusive.
 * @returns The random value.
 */
export function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

/**
 * Resolves after the given number of milliseconds.
 *
 * @param ms - Delay in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Maps items through an async function with bounded concurrency, preserving
 * input order. Used to fan out independent network fetches without launching
 * one request per item all at once.
 *
 * @param items - Inputs to process.
 * @param limit - Maximum number of concurrent calls.
 * @param fn - Async mapper invoked with each item and its index.
 * @returns Results in the same order as items.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Sleeps for the configured scraper delay of the given type.
 *
 * @param type - Which delay setting to apply.
 */
export async function sleepConfig(type: 'min' | 'batch' | 'initial' | 'pageWait'): Promise<void> {
  const cfg = ConfigService.get()
  let ms = 0
  switch (type) {
    case 'min':      ms = rand(cfg.scraperMinDelay, cfg.scraperMaxDelay) * 1000; break
    case 'batch':    ms = cfg.scraperBatchDelay * 1000; break
    case 'initial':  ms = cfg.scraperInitialDelay * 1000; break
    case 'pageWait': ms = rand(cfg.scraperPageWaitMin, cfg.scraperPageWaitMax) * 1000; break
  }
  if (ms > 0) await sleep(ms)
}

/** Shared Playwright plumbing for site scrapers: browser lifecycle, stealth contexts, and navigation. */
export abstract class BaseScraper {
  protected _browser: Browser | null = null
  protected _aborted = false
  private _launching: Promise<Browser> | null = null

  /**
   * Scrapes a poster-set URL into a list of posters.
   *
   * @param url - Page to scrape.
   * @returns The posters found, empty on failure.
   */
  abstract scrape(url: string, types?: readonly string[]): Promise<PosterInfo[]>

  /**
   * Returns the shared headless browser, launching it on first use. Parallel
   * callers share one launch, so workers that all notice a dead browser at
   * once do not each start their own.
   *
   * @returns The connected browser instance.
   */
  async getBrowser(): Promise<Browser> {
    if (this._browser?.isConnected()) return this._browser
    this._launching ??= (async () => {
      // PLEX_BROWSER_EXEC is set by PlaywrightService.setupEnv() - bypasses playwright's
      // internal registry lookup so we always use the managed browser in userData/browsers
      const executablePath = process.env.PLEX_BROWSER_EXEC
      if (!executablePath) {
        throw new Error(
          'Chromium browser is not installed. Open Settings → Browser Engine and click Install.',
        )
      }
      const browser = await chromium.launch({
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
        ],
      })
      this._browser = browser
      return browser
    })().finally(() => { this._launching = null })
    return this._launching
  }

  /**
   * Creates a fresh context and page with a rotated fingerprint and
   * automation masking.
   *
   * @returns The context (close it when done) and its page.
   */
  async newContext(): Promise<{ context: BrowserContext; page: Page }> {
    const browser = await this.getBrowser()
    const context = await browser.newContext({
      userAgent: pick(USER_AGENTS),
      viewport: pick(VIEWPORTS),
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      },
    })
    const page = await context.newPage()
    // Mask automation fingerprints (runs in browser context, not Node)
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = globalThis as any
      Object.defineProperty(g.navigator, 'webdriver', { get: () => undefined })
      g.chrome = { runtime: {} }
    })
    return { context, page }
  }

  /**
   * Navigates to a URL with configured delays and waits for the given selector.
   *
   * @param page - Page to drive.
   * @param url - Destination URL.
   * @param waitFor - Selector that signals the content has rendered.
   */
  async navigate(page: Page, url: string, waitFor: string): Promise<void> {
    await sleepConfig('initial')
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector(waitFor, { timeout: 15_000 }).catch(() => {})
    await sleepConfig('pageWait')
  }

  /** Flags the current scrape to stop at its next checkpoint. */
  abort(): void {
    this._aborted = true
  }

  /** Closes the shared browser and clears the abort flag. */
  async close(): Promise<void> {
    await this._browser?.close().catch(() => {})
    this._browser = null
    this._aborted = false
  }
}
