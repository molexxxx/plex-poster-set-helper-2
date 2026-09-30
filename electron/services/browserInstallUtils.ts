import fs from 'fs'
import path from 'path'
import type { BrowserInstallError, BrowserInstallErrorKind, SystemBrowser } from '../ipc/types'

/** Playwright writes this marker once a browser directory is fully extracted. */
export const MARKER_FILE = 'INSTALLATION_COMPLETE'

const HINTS: Record<BrowserInstallErrorKind, string> = {
  offline: 'The download server could not be reached. Check that this machine is online, including any VPN or proxy, then retry.',
  network: 'The download was interrupted or stalled. This is usually a flaky connection, and retrying fixes it.',
  blocked: 'The download was refused. A firewall, proxy, or antivirus may be blocking cdn.playwright.dev. Allow it, or start the app with HTTPS_PROXY set (and NODE_EXTRA_CA_CERTS when TLS is inspected).',
  disk: 'There is not enough free disk space for the browser. Free up about 1 GB and retry.',
  permission: 'The browser folder is not writable. Fix its permissions, or run the app as a user that can write there.',
  antivirus: 'Files could not be written while extracting. Antivirus software may be scanning or quarantining the browser folder. Add an exclusion for it and retry.',
  'missing-deps': 'Chromium is present, but this system is missing libraries it needs. Run the command below, then retry.',
  launch: 'Chromium is present but did not start. Retry, or use a browser that is already installed on this machine.',
  cancelled: 'The installation was cancelled.',
  unknown: 'The installer failed unexpectedly. Retry, or check the log for details.',
}

/** Lookup from a missing shared library to the package that provides it. */
const LIB_PACKAGES: Record<string, { deb: string; rpm: string }> = {
  'libnss3.so': { deb: 'libnss3', rpm: 'nss' },
  'libnssutil3.so': { deb: 'libnss3', rpm: 'nss-util' },
  'libsmime3.so': { deb: 'libnss3', rpm: 'nss' },
  'libnspr4.so': { deb: 'libnspr4', rpm: 'nspr' },
  'libatk-1.0.so.0': { deb: 'libatk1.0-0', rpm: 'atk' },
  'libatk-bridge-2.0.so.0': { deb: 'libatk-bridge2.0-0', rpm: 'at-spi2-atk' },
  'libatspi.so.0': { deb: 'libatspi2.0-0', rpm: 'at-spi2-core' },
  'libcups.so.2': { deb: 'libcups2', rpm: 'cups-libs' },
  'libdrm.so.2': { deb: 'libdrm2', rpm: 'libdrm' },
  'libxkbcommon.so.0': { deb: 'libxkbcommon0', rpm: 'libxkbcommon' },
  'libxcomposite.so.1': { deb: 'libxcomposite1', rpm: 'libXcomposite' },
  'libxdamage.so.1': { deb: 'libxdamage1', rpm: 'libXdamage' },
  'libxfixes.so.3': { deb: 'libxfixes3', rpm: 'libXfixes' },
  'libxrandr.so.2': { deb: 'libxrandr2', rpm: 'libXrandr' },
  'libgbm.so.1': { deb: 'libgbm1', rpm: 'mesa-libgbm' },
  'libpango-1.0.so.0': { deb: 'libpango-1.0-0', rpm: 'pango' },
  'libcairo.so.2': { deb: 'libcairo2', rpm: 'cairo' },
  'libasound.so.2': { deb: 'libasound2', rpm: 'alsa-lib' },
  'libx11.so.6': { deb: 'libx11-6', rpm: 'libX11' },
  'libxext.so.6': { deb: 'libxext6', rpm: 'libXext' },
  'libxcb.so.1': { deb: 'libxcb1', rpm: 'libxcb' },
  'libglib-2.0.so.0': { deb: 'libglib2.0-0', rpm: 'glib2' },
  'libgobject-2.0.so.0': { deb: 'libglib2.0-0', rpm: 'glib2' },
  'libdbus-1.so.3': { deb: 'libdbus-1-3', rpm: 'dbus-libs' },
  'libexpat.so.1': { deb: 'libexpat1', rpm: 'expat' },
  'libgtk-3.so.0': { deb: 'libgtk-3-0', rpm: 'gtk3' },
  'libxshmfence.so.1': { deb: 'libxshmfence1', rpm: 'libxshmfence' },
  'libfontconfig.so.1': { deb: 'libfontconfig1', rpm: 'fontconfig' },
  'libfreetype.so.6': { deb: 'libfreetype6', rpm: 'freetype' },
}

interface OutputPattern
{
  kind: BrowserInstallErrorKind
  pattern: RegExp
  describe: (match: RegExpExecArray) => string
}

const OUTPUT_PATTERNS: OutputPattern[] = [
  {
    kind: 'missing-deps',
    pattern: /Host system is missing dependencies|error while loading shared libraries|Missing libraries:/i,
    describe: () => 'Missing system libraries',
  },
  {
    kind: 'disk',
    pattern: /ENOSPC|no space left on device|not enough space/i,
    describe: () => 'The disk is full',
  },
  {
    kind: 'offline',
    pattern: /(EAI_AGAIN|ENOTFOUND|getaddrinfo|ERR_INTERNET_DISCONNECTED|ENETUNREACH|ENETDOWN)/i,
    describe: match => `The download host could not be reached (${match[1]})`,
  },
  {
    kind: 'blocked',
    pattern: /(status code 40[137]|407 Proxy|CERT_HAS_EXPIRED|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT(?:_LOCALLY)?|unable to get local issuer certificate|ERR_TLS_CERT_ALTNAME_INVALID|EPROTO)/i,
    describe: match => `The download was refused (${match[1]})`,
  },
  {
    kind: 'network',
    pattern: /(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|EPIPE|socket hang up|timed out|timeout|aborted|ERR_STREAM_PREMATURE_CLOSE|status code 5\d\d|status code 429)/i,
    describe: match => `The connection failed (${match[1]})`,
  },
  {
    kind: 'permission',
    pattern: /(EACCES|EPERM|EBUSY|EROFS|operation not permitted|permission denied|access is denied)/i,
    describe: match => `Files could not be written (${match[1]})`,
  },
]

const RETRYABLE_KINDS: ReadonlySet<BrowserInstallErrorKind> = new Set<BrowserInstallErrorKind>([
  'offline', 'network', 'blocked', 'antivirus', 'unknown',
])

/**
 * Builds a structured install error with the standard hint for its kind.
 *
 * @param kind - Failure category.
 * @param message - One-line description of what happened.
 * @param extra - Optional overrides such as a resolving command.
 * @returns The error object sent to the renderer.
 */
export function makeInstallError(
  kind: BrowserInstallErrorKind,
  message: string,
  extra: Partial<BrowserInstallError> = {},
): BrowserInstallError
{
  return { kind, message, hint: HINTS[kind], ...extra }
}

/**
 * Whether another attempt could succeed for a failure of this kind.
 *
 * @param kind - Failure category.
 * @returns True for transient network and file-lock failures.
 */
export function isRetryable(kind: BrowserInstallErrorKind): boolean
{
  return RETRYABLE_KINDS.has(kind)
}

/**
 * File name of the Chromium executable Playwright ships for a platform.
 *
 * @param headless - True for the headless shell, false for full Chromium.
 * @param platform - Node platform identifier.
 * @returns The executable's base name.
 */
export function execName(headless: boolean, platform: NodeJS.Platform = process.platform): string
{
  const base = headless ? 'chrome-headless-shell' : 'chrome'
  if (platform === 'win32') return `${base}.exe`
  if (platform === 'darwin' && !headless) return 'Chromium'
  return base
}

function revisionOf(name: string): number
{
  const match = /(\d+)$/.exec(name)
  return match ? Number(match[1]) : 0
}

function findFile(dir: string, name: string, depth = 4): string | null
{
  let entries: fs.Dirent[]
  try
  {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  }
  catch
  {
    return null
  }
  for (const entry of entries)
  {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory() && depth > 0)
    {
      const hit = findFile(full, name, depth - 1)
      if (hit) return hit
    }
  }
  return null
}

/**
 * Newest fully installed Chromium executable under a Playwright browsers
 * directory. Directories without the completion marker are half-extracted
 * downloads and are skipped.
 *
 * @param browsersPath - Directory Playwright installs browsers into.
 * @param platform - Node platform identifier.
 * @returns Absolute path of the executable, or null when none is complete.
 */
export function findBrowserExec(browsersPath: string, platform: NodeJS.Platform = process.platform): string | null
{
  let entries: string[]
  try
  {
    entries = fs.readdirSync(browsersPath)
  }
  catch
  {
    return null
  }

  const locate = (matches: (name: string) => boolean, headless: boolean): string | null =>
  {
    const dirs = entries.filter(matches).sort((a, b) => revisionOf(b) - revisionOf(a))
    for (const dir of dirs)
    {
      const full = path.join(browsersPath, dir)
      if (!fs.existsSync(path.join(full, MARKER_FILE))) continue
      const exec = findFile(full, execName(headless, platform))
      if (exec) return exec
    }
    return null
  }

  const shell = locate(name => name.startsWith('chromium_headless_shell-') || name.startsWith('chromium-headless-shell-'), true)
  if (shell) return shell
  return locate(name => name.startsWith('chromium-') && !name.includes('headless'), false)
}

interface Candidate
{
  name: string
  paths: string[]
}

function windowsCandidates(env: NodeJS.ProcessEnv): Candidate[]
{
  const roots = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['ProgramW6432'], env['LOCALAPPDATA']]
    .filter((root): root is string => typeof root === 'string' && root.length > 0)
  const under = (...segments: string[]): string[] => roots.map(root => path.join(root, ...segments))
  return [
    { name: 'Google Chrome', paths: under('Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Microsoft Edge', paths: under('Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Brave', paths: under('BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
    { name: 'Chromium', paths: under('Chromium', 'Application', 'chrome.exe') },
  ]
}

const LINUX_CANDIDATES: Candidate[] = [
  { name: 'Google Chrome', paths: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'] },
  { name: 'Chromium', paths: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/lib/chromium/chromium'] },
  { name: 'Microsoft Edge', paths: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'] },
  { name: 'Brave', paths: ['/usr/bin/brave-browser', '/usr/bin/brave-browser-stable', '/opt/brave.com/brave/brave'] },
]

const MAC_CANDIDATES: Candidate[] = [
  { name: 'Google Chrome', paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] },
  { name: 'Microsoft Edge', paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] },
  { name: 'Brave', paths: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'] },
  { name: 'Chromium', paths: ['/Applications/Chromium.app/Contents/MacOS/Chromium'] },
]

/**
 * Chromium-based browsers installed on this machine at their standard
 * locations. Any of them can drive the scrapers without a download.
 *
 * @param platform - Node platform identifier.
 * @param env - Environment used to resolve Windows install roots.
 * @returns Browsers whose executable exists, in preference order.
 */
export function detectSystemBrowsers(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): SystemBrowser[]
{
  const candidates = platform === 'win32' ? windowsCandidates(env) : platform === 'darwin' ? MAC_CANDIDATES : LINUX_CANDIDATES
  const found: SystemBrowser[] = []
  for (const candidate of candidates)
  {
    const hit = candidate.paths.find(candidatePath =>
    {
      try
      {
        return fs.statSync(candidatePath).isFile()
      }
      catch
      {
        return false
      }
    })
    if (hit) found.push({ name: candidate.name, path: hit })
  }
  return found
}

/** Executable base names of the Chromium-family browsers the scrapers can drive. */
const KNOWN_BROWSER_EXECUTABLES: ReadonlySet<string> = new Set([
  'chrome', 'chrome.exe', 'chromium', 'chromium.exe', 'chromium-browser',
  'google-chrome', 'google-chrome-stable', 'google-chrome-beta', 'google-chrome-unstable', 'google chrome',
  'msedge', 'msedge.exe', 'microsoft-edge', 'microsoft-edge-stable', 'microsoft-edge-beta', 'microsoft edge',
  'brave', 'brave.exe', 'brave-browser', 'brave-browser-stable', 'brave browser',
  'chrome-headless-shell', 'chrome-headless-shell.exe', 'headless_shell', 'headless_shell.exe',
])

/**
 * Whether a path names a Chromium-family browser executable. Only the base
 * name is checked, so callers still confirm the file exists.
 *
 * @param filePath - Absolute or relative path to test.
 * @returns True for chrome, chromium, msedge, brave, and headless shell binaries.
 */
export function isKnownBrowserExecutable(filePath: string): boolean
{
  const base = filePath.trim().split(/[\\/]/).pop() ?? ''
  return KNOWN_BROWSER_EXECUTABLES.has(base.toLowerCase())
}

/**
 * Whether a path exists and is a regular file.
 *
 * @param filePath - Path to test.
 * @returns False for directories, missing paths, and unreadable entries.
 */
export function isRegularFile(filePath: string): boolean
{
  try
  {
    return fs.statSync(filePath).isFile()
  }
  catch
  {
    return false
  }
}

export interface ParsedInstallLine
{
  /** 0-100 when the line carries a progress bar. */
  percent: number | null
  /** Item being fetched when the line starts a download. */
  label: string | null
  /** True when the line reports an item finished downloading. */
  completed: boolean
}

function stripAnsi(text: string): string
{
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

/**
 * Interprets one line of `playwright install` output.
 *
 * @param line - Raw stdout or stderr line.
 * @returns Progress percent, download label, and completion flag when present.
 */
export function parseInstallLine(line: string): ParsedInstallLine
{
  const clean = stripAnsi(line).trim()
  const progress = /\|\s*(\d{1,3})%/.exec(clean)
  const start = /^Downloading\s+(.+?)\s+from\s+/i.exec(clean)
  return {
    percent: progress ? Math.min(100, Number(progress[1])) : null,
    label: start ? start[1] : null,
    completed: /\bdownloaded to\b/i.test(clean),
  }
}

/**
 * Package install command printed by Playwright when system libraries are
 * missing, normalized to a single non-interactive apt-get line.
 *
 * @param output - Installer or launch output.
 * @returns The command, or undefined when the output has no apt-get line.
 */
export function extractAptCommand(output: string): string | undefined
{
  const lines = stripAnsi(output).split(/\r?\n/)
  const start = lines.findIndex(line => /apt-get install\b/.test(line))
  if (start === -1) return undefined
  const packages: string[] = []
  for (let i = start; i < lines.length; i++)
  {
    const raw = lines[i].replace(/[║]/g, '')
    const content = raw.replace(/^.*apt-get install/, '').replace(/\\\s*$/, '').trim()
    for (const token of content.split(/\s+/))
    {
      if (token && !token.startsWith('-') && /^[a-z0-9][a-z0-9.+-]*$/i.test(token)) packages.push(token)
    }
    if (!/\\\s*$/.test(raw)) break
  }
  const unique = [...new Set(packages)]
  return unique.length ? `sudo apt-get install -y ${unique.join(' ')}` : undefined
}

/**
 * Shared libraries reported as missing by the dynamic loader or by
 * Playwright's host check.
 *
 * @param output - Installer or launch output.
 * @returns Library sonames, without duplicates.
 */
export function extractMissingLibraries(output: string): string[]
{
  const libs = new Set<string>()
  const clean = stripAnsi(output)
  for (const match of clean.matchAll(/error while loading shared libraries: ([^:\s]+)/g)) libs.add(match[1])
  for (const rawLine of clean.split(/\r?\n/))
  {
    const line = rawLine.replace(/[║]/g, '').trim()
    if (/^lib[\w.+-]*\.so(\.[\w.]+)?$/.test(line)) libs.add(line)
  }
  return [...libs]
}

/**
 * Contents of /etc/os-release, used to pick a package manager.
 *
 * @returns The file's text, or null when unavailable.
 */
export function readOsRelease(): string | null
{
  try
  {
    return fs.readFileSync('/etc/os-release', 'utf8')
  }
  catch
  {
    return null
  }
}

function packageFamily(osRelease: string | null): 'deb' | 'rpm' | 'other'
{
  if (!osRelease) return 'other'
  const id = /^ID=(.*)$/m.exec(osRelease)?.[1] ?? ''
  const like = /^ID_LIKE=(.*)$/m.exec(osRelease)?.[1] ?? ''
  const ids = `${id} ${like}`.toLowerCase()
  if (/debian|ubuntu|mint|pop|elementary|zorin|kali|raspbian/.test(ids)) return 'deb'
  if (/fedora|rhel|centos|rocky|alma|nobara/.test(ids)) return 'rpm'
  return 'other'
}

/**
 * Package manager command that installs the packages providing the given
 * libraries on Debian or Fedora families.
 *
 * @param libs - Missing library sonames.
 * @param osRelease - Contents of /etc/os-release.
 * @returns The command, or undefined when the distribution or libraries are unknown.
 */
export function dependencyCommand(libs: string[], osRelease: string | null): string | undefined
{
  if (!libs.length) return undefined
  const family = packageFamily(osRelease)
  if (family === 'other') return undefined
  const packages = new Set<string>()
  for (const lib of libs)
  {
    const entry = LIB_PACKAGES[lib.toLowerCase()]
    if (entry) packages.add(family === 'rpm' ? entry.rpm : entry.deb)
  }
  if (!packages.size) return undefined
  const list = [...packages].join(' ')
  return family === 'rpm' ? `sudo dnf install -y ${list}` : `sudo apt-get install -y ${list}`
}

function lastMeaningfulLine(text: string): string
{
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/[║╔╚╗╝═]/g, '').trim())
    .filter(line => line && !line.startsWith('|') && !/^\d{1,3}%/.test(line))
  const errorLine = [...lines].reverse().find(line => /error|fail/i.test(line))
  return (errorLine ?? lines[lines.length - 1] ?? '').slice(0, 300)
}

export interface ClassifyOptions
{
  platform?: NodeJS.Platform
  /** Kind to report when no known pattern matches. */
  fallback?: BrowserInstallErrorKind
  /** Installer exit code, when it exited. */
  exitCode?: number | null
  /** 'launch' only considers library and permission problems. */
  scope?: 'install' | 'launch'
}

const LAUNCH_SCOPE_KINDS: ReadonlySet<BrowserInstallErrorKind> = new Set<BrowserInstallErrorKind>(['missing-deps', 'permission'])

/**
 * Turns installer or launch output into a structured error with guidance.
 *
 * @param output - Captured stdout, stderr, or exception text.
 * @param options - Platform, fallback kind, exit code, and matching scope.
 * @returns The classified error.
 */
export function classifyInstallFailure(output: string, options: ClassifyOptions = {}): BrowserInstallError
{
  const platform = options.platform ?? process.platform
  const fallback = options.fallback ?? 'unknown'
  const exitCode = options.exitCode ?? null
  const scope = options.scope ?? 'install'
  const text = stripAnsi(output)
  for (const entry of OUTPUT_PATTERNS)
  {
    if (scope === 'launch' && !LAUNCH_SCOPE_KINDS.has(entry.kind)) continue
    const match = entry.pattern.exec(text)
    if (!match) continue
    if (entry.kind === 'missing-deps')
    {
      const libs = extractMissingLibraries(text)
      const command = extractAptCommand(text) ?? dependencyCommand(libs, readOsRelease())
      const message = libs.length ? `Missing system libraries: ${libs.join(', ')}` : entry.describe(match)
      return makeInstallError('missing-deps', message, command ? { command } : {})
    }
    const kind = entry.kind === 'permission' && platform === 'win32' ? 'antivirus' : entry.kind
    return makeInstallError(kind, entry.describe(match))
  }
  const last = lastMeaningfulLine(text)
  const suffix = exitCode !== null && exitCode !== 0 ? ` (exit code ${exitCode})` : ''
  return makeInstallError(fallback, `${last || 'The installer failed'}${suffix}`)
}

/**
 * Total size of the files under a directory, bounded so the watchdog stays
 * cheap on large trees.
 *
 * @param dir - Directory to measure.
 * @param maxEntries - Stop counting after this many entries.
 * @returns Byte total of the entries visited.
 */
export function directorySize(dir: string, maxEntries = 20000): number
{
  let total = 0
  let visited = 0
  const stack = [dir]
  while (stack.length && visited < maxEntries)
  {
    const current = stack.pop() as string
    let entries: fs.Dirent[]
    try
    {
      entries = fs.readdirSync(current, { withFileTypes: true })
    }
    catch
    {
      continue
    }
    for (const entry of entries)
    {
      visited++
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile())
      {
        try
        {
          total += fs.statSync(full).size
        }
        catch
        {
          // removed mid-scan
        }
      }
    }
  }
  return total
}

/**
 * Human-readable byte count.
 *
 * @param bytes - Value to format.
 * @returns Text such as "1.2 GB".
 */
export function formatBytes(bytes: number): string
{
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}
