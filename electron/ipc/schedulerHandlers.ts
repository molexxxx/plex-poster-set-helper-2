import { ipcMain } from 'electron'
import type { IpcMain } from 'electron'
import { handlers } from '../handlers'
import { appEvents } from '../runtime/events'
import type { ScheduledJob } from './types'

export function registerSchedulerHandlers(_ipcMain: IpcMain) {
  ipcMain.handle('scheduler:list', () => handlers.scheduler.list())
  ipcMain.handle('scheduler:save', (_e, job: ScheduledJob) => handlers.scheduler.save(job))
  ipcMain.handle('scheduler:delete', (_e, id: string) => handlers.scheduler.delete(id))
  ipcMain.handle('scheduler:runNow', (_e, id: string) => handlers.scheduler.runNow(id))
  ipcMain.handle('scheduler:setAutoStart', (_e, enable: boolean) => handlers.scheduler.setAutoStart(enable))
  ipcMain.handle('scheduler:getAutoStart', () => handlers.scheduler.getAutoStart())
  ipcMain.handle('scheduler:engineStatus', () => handlers.scheduler.engineStatus())
  ipcMain.handle('scheduler:preview', (_e, expr: string) => handlers.scheduler.preview(expr))
}

/** Wire scheduler change events to an Electron window. */
export function wireSchedulerEvents(win: Electron.BrowserWindow) {
  appEvents.onEvent('scheduler:onChange', (jobs: ScheduledJob[]) => {
    if (!win.isDestroyed()) win.webContents.send('scheduler:onChange', jobs)
  })
}
