import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { Logger } from './logger'

export interface BrowserStatus {
  installed: boolean
  executablePath: string
  browsersPath: string
}

let _win: BrowserWindow | null = null
let _installing: Promise<void> | null = null

// --- Binary discovery --------------------------------------------------------
// Playwright's per-platform subdir names vary by OS / arch / version
// (chrome-headless-shell-win64, -linux64, -mac-arm64, …). Rather than hardcode
// every variant, search the version dir for the executable by name.

function execName(headless: boolean): string {
  const base = headless ? 'chrome-headless-shell' : 'chrome'
  if (process.platform === 'win32') return `${base}.exe`
  if (process.platform === 'darwin' && !headless) return 'Chromium' // app bundle binary
  return base
}

// Recursively look for an executable file with the given name (depth-limited).
function findFile(dir: string, name: string, depth = 4): string | null {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return null }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isFile() && e.name === name) return full
    if (e.isDirectory() && depth > 0) {
      const hit = findFile(full, name, depth - 1)
      if (hit) return hit
    }
  }
  return null
}

// Scan the browsers dir; prefer chromium_headless_shell (playwright's default for
// headless: true), fall back to full chromium.
export function findBrowserExec(browsersPath: string): string | null {
  if (!fs.existsSync(browsersPath)) return null
  const entries = fs.readdirSync(browsersPath)

  const shellDir = entries
    .filter(e => e.startsWith('chromium_headless_shell-') || e.startsWith('chromium-headless-shell-'))
    .sort()
    .slice(-1)[0]

  if (shellDir) {
    const exec = findFile(path.join(browsersPath, shellDir), execName(true))
    if (exec) return exec
  }

  // Fallback: full chromium
  const chromiumDir = entries
    .filter(e => e.startsWith('chromium-') && !e.includes('headless'))
    .sort()
    .slice(-1)[0]

  if (chromiumDir) {
    const exec = findFile(path.join(browsersPath, chromiumDir), execName(false))
    if (exec) return exec
  }

  return null
}

export const PlaywrightService = {
  init(win: BrowserWindow) {
    _win = win
  },

  getBrowsersPath(): string {
    return path.join(app.getPath('userData'), 'browsers')
  },

  async getStatus(): Promise<BrowserStatus> {
    const browsersPath = this.getBrowsersPath()
    const execPath = findBrowserExec(browsersPath)
    return {
      installed:      execPath !== null,
      executablePath: execPath ?? '',
      browsersPath,
    }
  },

  // Coalesce concurrent installs (e.g. the SetupScreen and the main-process
  // bootstrap both asking at once) into a single download.
  install(): Promise<void> {
    if (_installing) return _installing
    _installing = this._doInstall().finally(() => { _installing = null })
    return _installing
  },

  _doInstall(): Promise<void> {
    return new Promise((resolve, reject) => {
      const appRoot = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked')
        : app.getAppPath()
      const cliPath = path.join(appRoot, 'node_modules', 'playwright', 'cli.js')

      Logger.info('Playwright', `Installing via ${cliPath}`)
      Logger.info('Playwright', `Browsers path: ${this.getBrowsersPath()}`)

      const { utilityProcess } = require('electron') as typeof import('electron')
      const child = utilityProcess.fork(cliPath, ['install', 'chromium'], {
        stdio: ['ignore', 'pipe', 'pipe'] as unknown as Array<'pipe' | 'ignore' | 'inherit'>,
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: this.getBrowsersPath(),
        },
      })

      let settled = false
      const done = (err?: Error) => {
        if (settled) return
        settled = true
        clearInterval(poll)
        if (err) reject(err)
        else resolve()
      }

      const send = (line: string) => {
        if (!line.trim()) return
        _win?.webContents.send('browser:installProgress', line.trim())
        Logger.info('Playwright', line.trim())
      }

      child.stdout?.on('data', (d: Buffer) => String(d).split('\n').forEach(send))
      child.stderr?.on('data', (d: Buffer) => String(d).split('\n').forEach(send))

      child.on('exit', (code: number) => {
        if (code === 0) {
          Logger.success('Playwright', 'Chromium installed')
          done()
        } else {
          done(new Error(`playwright install exited with code ${code}`))
        }
      })

      // Fallback: in containers the utility process exit event can silently drop.
      // Poll the browsers dir every 3 s; if a binary appears that wasn't there
      // before (first install or version upgrade), we're done. On a same-version
      // reinstall the path never changes, so the exit event stays authoritative
      // and the poll can't resolve early while the download is still running.
      const browsersPath = this.getBrowsersPath()
      const preExisting = findBrowserExec(browsersPath)
      const poll = setInterval(() => {
        const found = findBrowserExec(browsersPath)
        if (found && found !== preExisting) {
          Logger.success('Playwright', 'Chromium detected on disk (exit event fallback)')
          done()
        }
      }, 3000)
    })
  },

  // Must run before any chromium.launch() calls - also re-run after install
  setupEnv() {
    const browsersPath = this.getBrowsersPath()
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath

    // Also set the resolved exec path so scrapers can bypass playwright's registry lookup
    const exec = findBrowserExec(browsersPath)
    if (exec) {
      process.env.PLEX_BROWSER_EXEC = exec
      Logger.info('Playwright', `Browser: ${exec}`)
    } else {
      delete process.env.PLEX_BROWSER_EXEC
    }
  },
}
