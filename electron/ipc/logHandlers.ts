import fs from 'fs'
import path from 'path'
import { app, BrowserWindow, dialog } from 'electron'
import type { IpcMain } from 'electron'
import { handlers } from '../handlers'
import { Logger } from '../services/logger'
import type { LogExportRes, LogHistoryReq } from './types'

/**
 * Registers the log channels. Saving a copy asks where to save it with the
 * system dialog, so it lives here rather than in the shared handlers.
 *
 * @param ipcMain - Electron's main-process IPC.
 * @param openWindow - Opens or focuses the pop-out log window.
 */
export function registerLogHandlers(ipcMain: IpcMain, openWindow: () => void)
{
  ipcMain.handle('log:getHistory', (_e, req?: LogHistoryReq) => handlers.log.getHistory(req))
  ipcMain.handle('log:status', () => handlers.log.status())
  ipcMain.handle('log:clear', () => handlers.log.clear())
  ipcMain.handle('log:diagnostics', () => handlers.log.diagnostics())
  ipcMain.handle('log:openWindow', () => openWindow())
  ipcMain.handle('log:export', async (e, req?: { day?: string }): Promise<LogExportRes> =>
  {
    const owner = BrowserWindow.fromWebContents(e.sender)
    const options = {
      title: 'Save a copy of the logs',
      defaultPath: path.join(app.getPath('downloads'), Logger.exportFileName(req?.day)),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    }
    const picked = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return { saved: false }
    fs.writeFileSync(picked.filePath, Logger.exportText(req?.day), 'utf8')
    return { saved: true, path: picked.filePath }
  })
}
