import type { IpcMain } from 'electron'
import { Logger } from '../services/logger'

/**
 * Registers logging IPC handlers: in-memory log history retrieval.
 *
 * @param ipcMain - The main-process IPC bus.
 */
export function registerLogHandlers(ipcMain: IpcMain) {
  ipcMain.handle('log:getHistory', () => Logger.getHistory())
  ipcMain.handle('log:clear', () => Logger.clear())
}
