import { ipcMain, app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { IpcMain } from 'electron'
import { ConfigService } from '../services/config'

const REPO = 'tonywied17/plex-poster-set-helper'
const REPO_URL = `https://github.com/${REPO}`

// Running inside our Docker images (they set PLEX_HELPER_PROD=1 but aren't packaged).
const IS_CONTAINER = !app.isPackaged && (
  process.env.PLEX_HELPER_DOCKER === '1' ||
  process.env.PLEX_HELPER_HEADLESS === '1' ||
  process.env.PLEX_HELPER_PROD === '1'
)

// Compare two semver-ish strings; returns true if `latest` is newer than `current`.
function isNewer(latest: string, current: string): boolean {
  const norm = (v: string) => v.replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0)
  const a = norm(latest), b = norm(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

// Check GitHub Releases directly (used for Docker / unpackaged where electron-updater can't run).
async function checkGithubRelease(): Promise<{ version?: string; notes?: string; url?: string } | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'plex-poster-set-helper', Accept: 'application/vnd.github+json' },
    })
    if (!r.ok) return null
    const j = await r.json() as { tag_name?: string; body?: string; html_url?: string }
    return { version: (j.tag_name ?? '').replace(/^v/, ''), notes: j.body, url: j.html_url }
  } catch {
    return null
  }
}

export function registerAppHandlers(_ipcMain: IpcMain) {
  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('app:getEnv', () => ({
    packaged: app.isPackaged,
    container: IS_CONTAINER,
    version: app.getVersion(),
    repoUrl: REPO_URL,
  }))

  ipcMain.handle('app:openExternal', (_e, url: string) => { void shell.openExternal(url) })

  ipcMain.handle('app:checkUpdate', async () => {
    // Packaged desktop → electron-updater drives the in-app download/install flow.
    if (app.isPackaged) {
      try {
        const result = await autoUpdater.checkForUpdates()
        const info = result?.updateInfo
        const notes = typeof info?.releaseNotes === 'string' ? info.releaseNotes : undefined
        return { available: !!result?.updateInfo, version: info?.version, releaseNotes: notes, mode: 'desktop' as const }
      } catch {
        return { available: false, mode: 'desktop' as const }
      }
    }
    // Docker/container → can't self-update; report newer releases so the user can pull.
    if (IS_CONTAINER) {
      const rel = await checkGithubRelease()
      if (rel?.version && isNewer(rel.version, app.getVersion())) {
        return { available: true, version: rel.version, releaseNotes: rel.notes, releaseUrl: rel.url, mode: 'docker' as const }
      }
      return { available: false, mode: 'docker' as const }
    }
    // Plain dev run → nothing to update.
    return { available: false }
  })

  ipcMain.handle('app:installUpdate', () => {
    autoUpdater.downloadUpdate()
  })

  ipcMain.handle('app:quitAndInstall', () => {
    // Restart the app and apply the downloaded update.
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('app:openLogFolder', () => {
    shell.openPath(ConfigService.getLogPath())
  })

  ipcMain.handle('config:get', () => ConfigService.get())

  ipcMain.handle('config:set', (_event, partial) => ConfigService.set(partial))
}
