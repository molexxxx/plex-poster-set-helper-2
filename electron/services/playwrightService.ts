import fs from 'fs'
import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { chromium } from 'playwright'
import { Logger } from './logger'
import { ConfigService } from './config'
import { getUserDataPath, getAppRoot } from '../runtime/paths'
import { appEvents } from '../runtime/events'
import type {
  BrowserActionResult,
  BrowserInstallError,
  BrowserInstallState,
  BrowserSource,
  BrowserStatus,
} from '../ipc/types'
import {
  classifyInstallFailure,
  detectSystemBrowsers,
  directorySize,
  findBrowserExec,
  formatBytes,
  isKnownBrowserExecutable,
  isRegularFile,
  isRetryable,
  makeInstallError,
  parseInstallLine,
} from './browserInstallUtils'

export { findBrowserExec } from './browserInstallUtils'

const MAX_ATTEMPTS = 4
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000]
const STALL_TIMEOUT_MS = 3 * 60_000
const ATTEMPT_TIMEOUT_MS = 25 * 60_000
const SOCKET_TIMEOUT_MS = 60_000
const VERIFY_TIMEOUT_MS = 45_000
const MIN_FREE_BYTES = 1024 ** 3
const ACTIVITY_POLL_MS = 10_000
const COMPLETE_GRACE_MS = 30_000
const LOG_TAIL_LINES = 80

/** Launch flags shared with the scrapers so verification matches real use. */
export const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-web-security',
]

class InstallFailure extends Error
{
  constructor(readonly detail: BrowserInstallError)
  {
    super(detail.message)
    this.name = 'InstallFailure'
  }
}

interface Resolved
{
  path: string
  source: BrowserSource
}

interface InstallControl
{
  cancelled: boolean
  child: ChildProcess | null
}

interface ActiveInstall
{
  promise: Promise<void>
  cancel: () => void
}

interface CliOutcome
{
  ok: boolean
  output: string
  code: number | null
  timedOut: 'stall' | 'attempt' | null
}

const IDLE_STATE: BrowserInstallState = {
  stage: 'idle',
  attempt: 0,
  maxAttempts: MAX_ATTEMPTS,
  percent: null,
  label: '',
}

let _active: ActiveInstall | null = null
let _lastState: BrowserInstallState | null = null
let _lastInstallOutput = ''

function emitState(patch: Partial<BrowserInstallState>): void
{
  _lastState = { ...(_lastState ?? IDLE_STATE), ...patch }
  appEvents.emitEvent('browser:installState', _lastState)
}

function emitLine(line: string): void
{
  const text = line.trim()
  if (!text) return
  appEvents.emitEvent('browser:installProgress', text)
  Logger.info('Playwright', text)
}

function describeError(err: unknown): string
{
  return err instanceof Error ? err.message : String(err)
}

function toFailure(err: unknown, fallbackKind: 'launch' | 'unknown' = 'unknown'): InstallFailure
{
  if (err instanceof InstallFailure) return err
  return new InstallFailure(makeInstallError(fallbackKind, describeError(err)))
}

function managedBrowsersPath(): string
{
  return path.join(getUserDataPath(), 'browsers')
}

/**
 * Browsers directory shipped inside the installer or container image. Set
 * through PLEX_BROWSER_BUNDLED_DIR, or resources/browsers in packaged builds.
 */
function bundledBrowsersPath(): string | null
{
  const fromEnv = process.env.PLEX_BROWSER_BUNDLED_DIR?.trim()
  if (fromEnv) return fromEnv
  try
  {
    const { app } = require('electron') as typeof import('electron')
    if (app?.isPackaged) return path.join(process.resourcesPath, 'browsers')
  }
  catch
  {
    // not running under Electron
  }
  return null
}

/** Preference order: user-chosen executable, bundled browser, managed download. */
function resolveExecutable(): Resolved | null
{
  const bundled = bundledBrowsersPath()
  const bundledExec = bundled ? findBrowserExec(bundled) : null
  const managedExec = findBrowserExec(managedBrowsersPath())
  const custom = ConfigService.get().browserExecutablePath?.trim()
  if (custom)
  {
    // The stored path is re-validated on every read so a hand-edited config
    // cannot point the scrapers at something that is not a browser.
    if (isKnownBrowserExecutable(custom) && isRegularFile(custom))
    {
      const source: BrowserSource = detectSystemBrowsers().some(browser => browser.path === custom)
        ? 'system'
        : custom === bundledExec
          ? 'bundled'
          : custom === managedExec
            ? 'managed'
            : 'custom'
      return { path: custom, source }
    }
    Logger.error('Playwright', `Ignoring the configured browser executable (missing or not a known browser): ${custom}`)
  }
  if (bundledExec) return { path: bundledExec, source: 'bundled' }
  if (managedExec) return { path: managedExec, source: 'managed' }
  return null
}

/** Executables the app already trusts: detected system browsers, the bundled copy, and the managed download. */
function knownExecutables(): string[]
{
  const known = detectSystemBrowsers().map(browser => browser.path)
  const bundled = bundledBrowsersPath()
  const bundledExec = bundled ? findBrowserExec(bundled) : null
  if (bundledExec) known.push(bundledExec)
  const managedExec = findBrowserExec(managedBrowsersPath())
  if (managedExec) known.push(managedExec)
  return known
}

function signatureOf(exec: string): string
{
  try
  {
    const stat = fs.statSync(exec)
    return `${exec}|${stat.size}|${Math.floor(stat.mtimeMs)}`
  }
  catch
  {
    return exec
  }
}

function isVerified(exec: string): boolean
{
  return ConfigService.get().browserVerified === signatureOf(exec)
}

async function actionResult(ok: boolean, error?: BrowserInstallError): Promise<BrowserActionResult>
{
  const status = await PlaywrightService.getStatus()
  return error ? { ok, error, status } : { ok, status }
}

/** Launches the executable once so missing libraries or blocked binaries surface now, not mid-scrape. */
async function verifyExecutable(exec: string): Promise<void>
{
  emitState({ stage: 'verifying', percent: null, label: 'Starting Chromium to confirm it runs…', error: undefined, retryInSeconds: undefined })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  try
  {
    browser = await chromium.launch({ headless: true, executablePath: exec, args: LAUNCH_ARGS, timeout: VERIFY_TIMEOUT_MS })
    Logger.success('Playwright', `Verified ${exec} (Chromium ${browser.version()})`)
    ConfigService.set({ browserVerified: signatureOf(exec) })
  }
  catch (err)
  {
    const detail = classifyInstallFailure(`${describeError(err)}\n${_lastInstallOutput}`, { fallback: 'launch', scope: 'launch' })
    Logger.error('Playwright', `Browser verification failed: ${detail.message}`)
    throw new InstallFailure(detail)
  }
  finally
  {
    await browser?.close().catch(() => undefined)
  }
}

async function preflight(browsersPath: string): Promise<void>
{
  try
  {
    fs.mkdirSync(browsersPath, { recursive: true })
    const probe = path.join(browsersPath, `.write-test-${process.pid}`)
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
  }
  catch (err)
  {
    throw new InstallFailure(makeInstallError('permission', `Cannot write to ${browsersPath}: ${describeError(err)}`))
  }
  try
  {
    const stats = await fs.promises.statfs(browsersPath)
    const free = Number(stats.bavail) * Number(stats.bsize)
    if (free < MIN_FREE_BYTES)
    {
      throw new InstallFailure(makeInstallError(
        'disk',
        `Only ${formatBytes(free)} free at ${browsersPath}; about ${formatBytes(MIN_FREE_BYTES)} is needed`,
      ))
    }
  }
  catch (err)
  {
    if (err instanceof InstallFailure) throw err
    // statfs is unavailable on some filesystems; the installer reports ENOSPC if space runs out
  }
}

/** System proxy for the download host, so corporate networks work without manual env vars. */
async function detectProxy(): Promise<string | null>
{
  const env = process.env
  if (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy) return null
  try
  {
    const { app, session } = require('electron') as typeof import('electron')
    if (!app?.isReady?.()) return null
    const result = await session.defaultSession.resolveProxy('https://cdn.playwright.dev/')
    const match = /^PROXY\s+([^;\s]+)/.exec(result ?? '')
    return match ? `http://${match[1]}` : null
  }
  catch
  {
    return null
  }
}

function runCli(cliPath: string, browsersPath: string, proxy: string | null, force: boolean, control: InstallControl): Promise<CliOutcome>
{
  return new Promise(resolve =>
  {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
      PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: String(SOCKET_TIMEOUT_MS),
      ELECTRON_RUN_AS_NODE: '1',
      ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : {}),
    }
    const args = [cliPath, 'install', 'chromium', '--only-shell']
    if (force) args.push('--force')
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env, windowsHide: true })
    control.child = child

    const preExisting = findBrowserExec(browsersPath)
    const tail: string[] = []
    let settled = false
    let lastActivity = Date.now()
    let lastSize = -1
    let completeSince = 0
    let forcedOk = false
    let timedOut: CliOutcome['timedOut'] = null

    const finish = (code: number | null): void =>
    {
      if (settled) return
      settled = true
      clearInterval(watchdog)
      clearTimeout(attemptTimer)
      control.child = null
      resolve({ ok: forcedOk || (code === 0 && !timedOut), output: tail.join('\n'), code, timedOut })
    }

    const onData = (chunk: Buffer): void =>
    {
      lastActivity = Date.now()
      for (const raw of String(chunk).split(/\r?\n|\r/))
      {
        const line = raw.trim()
        if (!line) continue
        tail.push(line)
        if (tail.length > LOG_TAIL_LINES) tail.shift()
        emitLine(line)
        const parsed = parseInstallLine(line)
        if (parsed.label) emitState({ stage: 'downloading', percent: 0, label: parsed.label })
        else if (parsed.percent !== null) emitState({ stage: parsed.percent >= 100 ? 'extracting' : 'downloading', percent: parsed.percent })
        else if (parsed.completed) emitState({ stage: 'extracting', percent: 100 })
      }
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', err =>
    {
      tail.push(err.message)
      finish(-1)
    })
    child.on('close', code => finish(code))

    // Progress output, growth of the browsers folder, and the completion
    // marker are the liveness signals; a silent installer is killed and retried.
    const watchdog = setInterval(() =>
    {
      const size = directorySize(browsersPath)
      if (size !== lastSize)
      {
        lastSize = size
        lastActivity = Date.now()
      }
      const exec = findBrowserExec(browsersPath)
      if (exec && exec !== preExisting)
      {
        if (!completeSince) completeSince = Date.now()
        else if (Date.now() - completeSince > COMPLETE_GRACE_MS)
        {
          Logger.info('Playwright', 'Browser is complete on disk but the installer has not exited; continuing without it')
          forcedOk = true
          child.kill()
          return
        }
      }
      if (Date.now() - lastActivity > STALL_TIMEOUT_MS)
      {
        timedOut = 'stall'
        child.kill()
      }
    }, ACTIVITY_POLL_MS)
    const attemptTimer = setTimeout(() =>
    {
      timedOut = 'attempt'
      child.kill()
    }, ATTEMPT_TIMEOUT_MS)
  })
}

async function waitBeforeRetry(delayMs: number, attempt: number, failure: BrowserInstallError, control: InstallControl): Promise<void>
{
  const deadline = Date.now() + delayMs
  while (Date.now() < deadline)
  {
    if (control.cancelled) return
    const seconds = Math.ceil((deadline - Date.now()) / 1000)
    emitState({
      stage: 'retrying',
      attempt,
      percent: null,
      label: `Attempt ${attempt} failed. Retrying in ${seconds}s…`,
      retryInSeconds: seconds,
      error: failure,
    })
    await new Promise(resolve => setTimeout(resolve, Math.max(250, Math.min(1000, deadline - Date.now()))))
  }
}

async function runInstall(control: InstallControl, force: boolean): Promise<void>
{
  const browsersPath = managedBrowsersPath()
  const cliPath = path.join(getAppRoot(), 'node_modules', 'playwright', 'cli.js')
  emitState({
    ...IDLE_STATE,
    stage: 'preparing',
    label: 'Checking disk space and permissions…',
    error: undefined,
    retryInSeconds: undefined,
  })
  if (!fs.existsSync(cliPath))
  {
    throw new InstallFailure(makeInstallError('unknown', `Playwright CLI not found at ${cliPath}`))
  }
  await preflight(browsersPath)
  const proxy = await detectProxy()
  if (proxy) Logger.info('Playwright', `Using system proxy ${proxy}`)
  Logger.info('Playwright', `Installing the Chromium headless shell into ${browsersPath}`)

  const cancelled = (): InstallFailure => new InstallFailure(makeInstallError('cancelled', 'Installation cancelled'))
  let failure: BrowserInstallError | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)
  {
    if (control.cancelled) throw cancelled()
    emitState({
      stage: 'downloading',
      attempt,
      percent: null,
      label: 'Contacting the download server…',
      error: undefined,
      retryInSeconds: undefined,
    })
    const outcome = await runCli(cliPath, browsersPath, proxy, force && attempt === 1, control)
    _lastInstallOutput = outcome.output
    if (control.cancelled) throw cancelled()

    if (outcome.ok)
    {
      const exec = findBrowserExec(browsersPath)
      if (exec)
      {
        await verifyExecutable(exec)
        return
      }
      failure = makeInstallError('unknown', 'The installer finished but no complete browser was found on disk')
    }
    else if (outcome.timedOut === 'stall')
    {
      failure = makeInstallError('network', 'The download stalled with no progress for 3 minutes')
    }
    else if (outcome.timedOut === 'attempt')
    {
      failure = makeInstallError('network', 'The installer did not finish within 25 minutes')
    }
    else
    {
      failure = classifyInstallFailure(outcome.output, { exitCode: outcome.code })
    }

    Logger.error('Playwright', `Install attempt ${attempt}/${MAX_ATTEMPTS} failed: ${failure.message}`)
    if (!isRetryable(failure.kind) || attempt === MAX_ATTEMPTS) break
    await waitBeforeRetry(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)], attempt, failure, control)
  }
  throw new InstallFailure(failure ?? makeInstallError('unknown', 'Installation failed'))
}

/** Verifies a trusted executable, then records it as the override. */
async function applyExecutable(exec: string): Promise<BrowserActionResult>
{
  try
  {
    await verifyExecutable(exec)
    ConfigService.set({ browserExecutablePath: exec })
    emitState({ stage: 'done', percent: 100, label: 'Browser ready', error: undefined, retryInSeconds: undefined })
    PlaywrightService.setupEnv()
    Logger.success('Playwright', `Using browser executable ${exec}`)
    return actionResult(true)
  }
  catch (err)
  {
    const failure = toFailure(err, 'launch')
    emitState({ stage: 'failed', error: failure.detail, retryInSeconds: undefined })
    return actionResult(false, failure.detail)
  }
}

/**
 * Manages the Chromium the scrapers run on: a user-chosen executable, the
 * copy bundled with the app, or a managed download into userData/browsers.
 * Installs retry with backoff, watch for stalls, and end with a launch check.
 */
export const PlaywrightService = {
  getBrowsersPath(): string
  {
    return managedBrowsersPath()
  },

  async getStatus(): Promise<BrowserStatus>
  {
    const resolved = resolveExecutable()
    return {
      installed: resolved !== null,
      executablePath: resolved?.path ?? '',
      source: resolved?.source ?? null,
      verified: resolved ? isVerified(resolved.path) : false,
      browsersPath: managedBrowsersPath(),
      bundledPath: bundledBrowsersPath(),
      installing: _active !== null,
      installState: _lastState,
      systemBrowsers: detectSystemBrowsers(),
    }
  },

  /**
   * Installs the Chromium headless shell. Concurrent callers share one run.
   *
   * @param options - force re-downloads even when a copy is already complete.
   * @returns Whether the browser is ready, with the failure when it is not.
   */
  install(options: { force?: boolean } = {}): Promise<BrowserActionResult>
  {
    if (!_active)
    {
      const control: InstallControl = { cancelled: false, child: null }
      const promise = runInstall(control, options.force === true)
        .then(() =>
        {
          emitState({ stage: 'done', percent: 100, label: 'Chromium ready', error: undefined, retryInSeconds: undefined })
          Logger.success('Playwright', 'Chromium headless shell installed and verified')
        })
        .catch((err: unknown) =>
        {
          const failure = toFailure(err)
          emitState({ stage: 'failed', error: failure.detail, retryInSeconds: undefined })
          throw failure
        })
        .finally(() =>
        {
          _active = null
          PlaywrightService.setupEnv()
        })
      promise.catch(() => undefined)
      _active = {
        promise,
        cancel: () =>
        {
          control.cancelled = true
          control.child?.kill()
        },
      }
    }
    return _active.promise.then(
      () => actionResult(true),
      (err: unknown) => actionResult(false, toFailure(err).detail),
    )
  },

  async cancelInstall(): Promise<BrowserStatus>
  {
    _active?.cancel()
    return PlaywrightService.getStatus()
  },

  /** Launch check for the active executable; cached per executable signature. */
  async verify(): Promise<BrowserActionResult>
  {
    if (_active) await _active.promise.catch(() => undefined)
    const resolved = resolveExecutable()
    if (!resolved) return actionResult(false, makeInstallError('unknown', 'No browser is installed'))
    if (isVerified(resolved.path)) return actionResult(true)
    try
    {
      await verifyExecutable(resolved.path)
      emitState({ stage: 'done', percent: 100, label: 'Chromium ready', error: undefined, retryInSeconds: undefined })
      PlaywrightService.setupEnv()
      return actionResult(true)
    }
    catch (err)
    {
      const failure = toFailure(err, 'launch')
      emitState({ stage: 'failed', error: failure.detail, retryInSeconds: undefined })
      return actionResult(false, failure.detail)
    }
  },

  /**
   * Switches to one of the browsers this app already knows about (a detected
   * system browser, the bundled copy, or the managed download), or back to the
   * default when the path is empty. Only members of that set are accepted, so
   * a request over the web API cannot point the scrapers at an arbitrary
   * binary. The choice is kept only if the browser launches.
   *
   * @param requested - Path of a known browser executable, or null to clear the override.
   */
  async useExecutable(requested: string | null): Promise<BrowserActionResult>
  {
    const wanted = requested?.trim() ?? ''
    if (!wanted)
    {
      ConfigService.set({ browserExecutablePath: undefined, browserVerified: undefined })
      PlaywrightService.setupEnv()
      return actionResult(true)
    }
    const chosen = knownExecutables().find(candidate => candidate === wanted)
    if (!chosen)
    {
      return actionResult(false, makeInstallError('launch', 'That path is not one of the browsers detected on this machine', {
        hint: 'Pick one of the listed browsers. In the desktop app you can also browse for a Chromium-based executable.',
      }))
    }
    return applyExecutable(chosen)
  },

  /**
   * Uses a browser executable chosen through the desktop file picker. The file
   * must be a Chromium-family executable, and the choice is kept only if it
   * launches.
   *
   * @param picked - Absolute path returned by the native open dialog.
   */
  async useExecutableFile(picked: string): Promise<BrowserActionResult>
  {
    const filePath = picked.trim()
    if (!isKnownBrowserExecutable(filePath))
    {
      return actionResult(false, makeInstallError('launch', `${path.basename(filePath)} is not a Chromium-based browser executable`, {
        hint: 'Choose chrome, chromium, msedge, brave, or chrome-headless-shell (with .exe on Windows).',
      }))
    }
    if (!isRegularFile(filePath)) return actionResult(false, makeInstallError('launch', `No file found at ${filePath}`))
    return applyExecutable(filePath)
  },

  setupEnv(): void
  {
    process.env.PLAYWRIGHT_BROWSERS_PATH = managedBrowsersPath()
    const resolved = resolveExecutable()
    if (resolved)
    {
      process.env.PLEX_BROWSER_EXEC = resolved.path
      Logger.info('Playwright', `Browser (${resolved.source}): ${resolved.path}`)
    }
    else
    {
      delete process.env.PLEX_BROWSER_EXEC
    }
  },

  /** Startup: verify the available browser, or install one when none is present. */
  async bootstrap(): Promise<void>
  {
    try
    {
      const resolved = resolveExecutable()
      if (resolved)
      {
        if (!isVerified(resolved.path)) await PlaywrightService.verify()
        return
      }
      Logger.info('Playwright', 'No browser found - installing the Chromium headless shell')
      await PlaywrightService.install()
    }
    catch (err)
    {
      Logger.error('Playwright', `Browser bootstrap failed: ${describeError(err)}`)
    }
  },

  /** Stops a running install so the app can quit without an orphaned installer. */
  shutdown(): void
  {
    _active?.cancel()
  },
}
