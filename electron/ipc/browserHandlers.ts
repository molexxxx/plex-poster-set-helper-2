import { BrowserWindow, dialog, type IpcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { handlers } from '../handlers'
import { PlaywrightService } from '../services/playwrightService'
import { appEvents } from '../runtime/events'
import type { BrowserActionResult } from './types'

/**
 * Native file picker for a Chromium-based browser executable. The service
 * validates and launches the choice before keeping it; a cancelled dialog
 * returns the unchanged status without an error.
 */
async function pickExecutable(event: IpcMainInvokeEvent): Promise<BrowserActionResult> {
  const options: OpenDialogOptions = {
    title: 'Choose a Chromium-based browser',
    properties: ['openFile', 'treatPackageAsDirectory'],
    filters: process.platform === 'win32'
      ? [{ name: 'Applications', extensions: ['exe'] }]
      : [{ name: 'All files', extensions: ['*'] }],
  }
  const parent = BrowserWindow.fromWebContents(event.sender)
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, status: await handlers.browser.getStatus() }
  }
  return PlaywrightService.useExecutableFile(result.filePaths[0])
}

export function registerBrowserHandlers(ipcMain: IpcMain) {
  ipcMain.handle('browser:status', () => handlers.browser.getStatus())
  ipcMain.handle('browser:install', (_event, options?: { force?: boolean }) => handlers.browser.install(options))
  ipcMain.handle('browser:cancelInstall', () => handlers.browser.cancelInstall())
  ipcMain.handle('browser:verify', () => handlers.browser.verify())
  ipcMain.handle('browser:useExecutable', (_event, execPath: string | null) => handlers.browser.useExecutable(execPath))
  ipcMain.handle('browser:pickExecutable', event => pickExecutable(event))
}

export function wireBrowserEvents(win: BrowserWindow) {
  appEvents.onEvent('browser:installProgress', line => {
    if (!win.isDestroyed()) win.webContents.send('browser:installProgress', line)
  })
  appEvents.onEvent('browser:installState', state => {
    if (!win.isDestroyed()) win.webContents.send('browser:installState', state)
  })
}
