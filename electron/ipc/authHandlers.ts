import type { IpcMain, BrowserWindow } from 'electron'
import { handlers } from '../handlers'
import { appEvents } from '../runtime/events'
import type { PlexAuthStatus } from './types'

export function registerAuthHandlers(ipcMain: IpcMain, win: BrowserWindow) {
  appEvents.onEvent('auth:statusChange', (status: PlexAuthStatus) => {
    if (!win.isDestroyed()) win.webContents.send('auth:statusChange', status)
  })

  // Resolves with the authorization link as soon as the PIN flow starts, like the web
  // route; completion arrives through auth:statusChange.
  ipcMain.handle('auth:plexSignIn', async () => (await handlers.auth.beginSignIn(win)).authUrl ?? '')
  ipcMain.handle('auth:plexStatus', () => handlers.auth.getStatus())
  ipcMain.handle('auth:disconnect', () => handlers.auth.disconnect())
}
