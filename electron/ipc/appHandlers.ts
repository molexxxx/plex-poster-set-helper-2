import { ipcMain } from 'electron'
import type { IpcMain } from 'electron'
import { handlers } from '../handlers'

export function registerAppHandlers(_ipcMain: IpcMain) {
  ipcMain.handle('app:getVersion', () => handlers.app.getVersion())
  ipcMain.handle('app:getEnv', () => handlers.app.getEnv())
  ipcMain.handle('app:openExternal', (_e, url: string) => handlers.app.openExternal(url))
  ipcMain.handle('app:checkUpdate', () => handlers.app.checkUpdate())
  ipcMain.handle('app:installUpdate', () => handlers.app.installUpdate())
  ipcMain.handle('app:quitAndInstall', () => handlers.app.quitAndInstall())
  ipcMain.handle('app:openLogFolder', () => handlers.app.openLogFolder())
  ipcMain.handle('app:clearCaches', () => handlers.app.clearCaches())
  ipcMain.handle('config:get', () => handlers.config.get())
  ipcMain.handle('config:set', (_event, partial) => handlers.config.set(partial))
}
