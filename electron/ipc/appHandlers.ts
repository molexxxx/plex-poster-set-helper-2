import { ipcMain, app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { IpcMain } from 'electron'
import { ConfigService } from '../services/config'

export function registerAppHandlers(_ipcMain: IpcMain) {
  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('app:checkUpdate', async () => {
    // Not packaged (dev / Docker) → never an update to find.
    if (!app.isPackaged) return { available: false }
    try {
      const result = await autoUpdater.checkForUpdates()
      const info = result?.updateInfo
      const notes = typeof info?.releaseNotes === 'string' ? info.releaseNotes : undefined
      return { available: !!result?.updateInfo, version: info?.version, releaseNotes: notes }
    } catch {
      return { available: false }
    }
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
