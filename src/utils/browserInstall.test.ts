import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  MARKER_FILE,
  classifyInstallFailure,
  dependencyCommand,
  detectSystemBrowsers,
  extractAptCommand,
  extractMissingLibraries,
  findBrowserExec,
  formatBytes,
  isKnownBrowserExecutable,
  isRegularFile,
  isRetryable,
  parseInstallLine,
} from '../../electron/services/browserInstallUtils'

describe('parseInstallLine', () =>
{
  it('reads the item name from a download line', () =>
  {
    const line = 'Downloading Chromium Headless Shell 141.0.7390.37 (playwright build v1200) from https://cdn.playwright.dev/x.zip'
    expect(parseInstallLine(line).label).toBe('Chromium Headless Shell 141.0.7390.37 (playwright build v1200)')
  })

  it('reads progress percent and caps it at 100', () =>
  {
    expect(parseInstallLine('|■■■■■■■■■■      | 72% of 106.4 MiB').percent).toBe(72)
    expect(parseInstallLine('|■■■■■■■■■■■■■■■■| 100% of 106.4 MiB').percent).toBe(100)
    expect(parseInstallLine('plain text').percent).toBeNull()
  })

  it('flags completion lines', () =>
  {
    expect(parseInstallLine('Chromium Headless Shell 141.0.7390.37 (playwright build v1200) downloaded to /tmp/x').completed).toBe(true)
    expect(parseInstallLine('Downloading x from y').completed).toBe(false)
  })
})

describe('classifyInstallFailure', () =>
{
  it('treats DNS failures as offline and retryable', () =>
  {
    const error = classifyInstallFailure("Error: getaddrinfo EAI_AGAIN cdn.playwright.dev\n  code: 'EAI_AGAIN'", { platform: 'linux' })
    expect(error.kind).toBe('offline')
    expect(error.message).toContain('could not be reached')
    expect(isRetryable(error.kind)).toBe(true)
  })

  it('treats connection resets as network failures', () =>
  {
    expect(classifyInstallFailure('Error: read ECONNRESET', { platform: 'linux' }).kind).toBe('network')
  })

  it('treats a full disk as final', () =>
  {
    const error = classifyInstallFailure('Error: ENOSPC: no space left on device, write', { platform: 'linux' })
    expect(error.kind).toBe('disk')
    expect(isRetryable(error.kind)).toBe(false)
  })

  it('maps file locks to antivirus on Windows and permissions elsewhere', () =>
  {
    expect(classifyInstallFailure('Error: EBUSY: resource busy or locked, unlink', { platform: 'win32' }).kind).toBe('antivirus')
    expect(classifyInstallFailure('Error: EACCES: permission denied, mkdir', { platform: 'linux' }).kind).toBe('permission')
  })

  it('extracts the apt command from the host validation box', () =>
  {
    const output = [
      '╔════════════════════════════════════════════════════════╗',
      '║ Host system is missing dependencies to run browsers.   ║',
      '║ Please install them with the following command:        ║',
      '║                                                        ║',
      '║     sudo apt-get install libnss3\\                      ║',
      '║         libnspr4\\                                      ║',
      '║         libatk1.0-0                                    ║',
      '╚════════════════════════════════════════════════════════╝',
    ].join('\n')
    const error = classifyInstallFailure(output, { platform: 'linux' })
    expect(error.kind).toBe('missing-deps')
    expect(error.command).toBe('sudo apt-get install -y libnss3 libnspr4 libatk1.0-0')
    expect(isRetryable(error.kind)).toBe(false)
  })

  it('names the library from a dynamic loader error', () =>
  {
    const output = '[pid=1][err] /x/chrome: error while loading shared libraries: libnss3.so: cannot open shared object file'
    const error = classifyInstallFailure(output, { platform: 'linux', scope: 'launch' })
    expect(error.kind).toBe('missing-deps')
    expect(error.message).toContain('libnss3.so')
  })

  it('ignores download patterns when classifying a launch', () =>
  {
    const error = classifyInstallFailure('Timeout 45000ms exceeded while launching', { scope: 'launch', fallback: 'launch' })
    expect(error.kind).toBe('launch')
  })

  it('falls back to the last error line with the exit code', () =>
  {
    const error = classifyInstallFailure('Downloading x\nError: something odd happened', { exitCode: 3 })
    expect(error.kind).toBe('unknown')
    expect(error.message).toBe('Error: something odd happened (exit code 3)')
  })
})

describe('dependency helpers', () =>
{
  it('collects library names from loader errors and validation lists', () =>
  {
    const output = [
      'chrome: error while loading shared libraries: libgbm.so.1: cannot open shared object file',
      '║ Missing libraries:      ║',
      '║     libnss3.so          ║',
      '║     libatk-1.0.so.0     ║',
    ].join('\n')
    expect(extractMissingLibraries(output)).toEqual(['libgbm.so.1', 'libnss3.so', 'libatk-1.0.so.0'])
  })

  it('returns no apt command when the output has none', () =>
  {
    expect(extractAptCommand('nothing here')).toBeUndefined()
  })

  it('builds apt and dnf commands from library names', () =>
  {
    expect(dependencyCommand(['libnss3.so', 'libgbm.so.1'], 'ID=ubuntu\nID_LIKE=debian')).toBe('sudo apt-get install -y libnss3 libgbm1')
    expect(dependencyCommand(['libnss3.so'], 'ID=fedora')).toBe('sudo dnf install -y nss')
    expect(dependencyCommand(['libnss3.so'], 'ID=arch')).toBeUndefined()
    expect(dependencyCommand([], 'ID=ubuntu')).toBeUndefined()
  })
})

describe('findBrowserExec', () =>
{
  let root: string

  beforeEach(() =>
  {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'browsers-'))
  })

  afterEach(() =>
  {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function makeBrowser(dir: string, exec: string, complete: boolean): string
  {
    const full = path.join(root, dir, 'chrome-linux')
    fs.mkdirSync(full, { recursive: true })
    fs.writeFileSync(path.join(full, exec), '')
    if (complete) fs.writeFileSync(path.join(root, dir, MARKER_FILE), '')
    return path.join(full, exec)
  }

  it('returns null for a missing directory', () =>
  {
    expect(findBrowserExec(path.join(root, 'missing'), 'linux')).toBeNull()
  })

  it('skips half-extracted directories and prefers the newest complete shell', () =>
  {
    const complete = makeBrowser('chromium_headless_shell-1100', 'chrome-headless-shell', true)
    makeBrowser('chromium_headless_shell-1200', 'chrome-headless-shell', false)
    makeBrowser('chromium-1200', 'chrome', true)
    expect(findBrowserExec(root, 'linux')).toBe(complete)
  })

  it('falls back to full Chromium when no shell is complete', () =>
  {
    const chrome = makeBrowser('chromium-1200', 'chrome', true)
    expect(findBrowserExec(root, 'linux')).toBe(chrome)
  })
})

describe('detectSystemBrowsers', () =>
{
  it('finds Windows browsers under the program directories', () =>
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'programs-'))
    try
    {
      const chrome = path.join(root, 'Google', 'Chrome', 'Application')
      fs.mkdirSync(chrome, { recursive: true })
      fs.writeFileSync(path.join(chrome, 'chrome.exe'), '')
      expect(detectSystemBrowsers('win32', { ProgramFiles: root })).toEqual([
        { name: 'Google Chrome', path: path.join(chrome, 'chrome.exe') },
      ])
    }
    finally
    {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('formatBytes', () =>
{
  it('formats gigabytes and megabytes', () =>
  {
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
    expect(formatBytes(5 * 1024 ** 2)).toBe('5 MB')
  })
})

describe('isKnownBrowserExecutable', () =>
{
  it('accepts Chromium-family executables on every platform', () =>
  {
    expect(isKnownBrowserExecutable('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe(true)
    expect(isKnownBrowserExecutable('/usr/bin/google-chrome-stable')).toBe(true)
    expect(isKnownBrowserExecutable('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')).toBe(true)
    expect(isKnownBrowserExecutable('/opt/browsers/chromium_headless_shell-1243/chrome-linux/chrome-headless-shell')).toBe(true)
    expect(isKnownBrowserExecutable('  /usr/bin/brave-browser  ')).toBe(true)
  })

  it('rejects anything that is not a browser', () =>
  {
    expect(isKnownBrowserExecutable('/bin/sh')).toBe(false)
    expect(isKnownBrowserExecutable('C:\\Windows\\System32\\cmd.exe')).toBe(false)
    expect(isKnownBrowserExecutable('/usr/bin/chrome-wrapper.sh')).toBe(false)
    expect(isKnownBrowserExecutable('')).toBe(false)
  })
})

describe('isRegularFile', () =>
{
  it('distinguishes files from directories and missing paths', () =>
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'regular-'))
    try
    {
      const file = path.join(root, 'chrome')
      fs.writeFileSync(file, '')
      expect(isRegularFile(file)).toBe(true)
      expect(isRegularFile(root)).toBe(false)
      expect(isRegularFile(path.join(root, 'missing'))).toBe(false)
    }
    finally
    {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
