import type { IpcMain, BrowserWindow } from 'electron'
import { handlers } from '../handlers'
import { appEvents } from '../runtime/events'

export function registerBrowserHandlers(ipcMain: IpcMain) {
  ipcMain.handle('browser:status', () => handlers.browser.getStatus())
  ipcMain.handle('browser:install', (_event, options?: { force?: boolean }) => handlers.browser.install(options))
  ipcMain.handle('browser:cancelInstall', () => handlers.browser.cancelInstall())
  ipcMain.handle('browser:verify', () => handlers.browser.verify())
  ipcMain.handle('browser:useExecutable', (_event, execPath: string | null) => handlers.browser.useExecutable(execPath))
}

export function wireBrowserEvents(win: BrowserWindow) {
  appEvents.onEvent('browser:installProgress', line => {
    if (!win.isDestroyed()) win.webContents.send('browser:installProgress', line)
  })
  appEvents.onEvent('browser:installState', state => {
    if (!win.isDestroyed()) win.webContents.send('browser:installState', state)
  })
}
