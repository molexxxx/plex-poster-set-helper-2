import type { IpcMain } from 'electron'
import { PlexService } from '../services/plexService'
import type { ConnectReq, FindItemReq, FindCollectionReq, UploadReq, LabelReq, ResetReq } from './types'

export function registerPlexHandlers(ipcMain: IpcMain) {
  ipcMain.handle('plex:connect', (_e, req: ConnectReq) =>
    PlexService.connect(req)
  )

  ipcMain.handle('plex:getLibraries', () => {
    const conn = PlexService.getConnection()
    if (!conn) return []
    return PlexService.fetchLibraries(conn.baseUrl, conn.token)
  })

  ipcMain.handle('plex:findItem', (_e, req: FindItemReq) =>
    PlexService.findInLibrary(req)
  )

  ipcMain.handle('plex:findCollection', (_e, req: FindCollectionReq) =>
    PlexService.findCollection(req)
  )

  ipcMain.handle('plex:uploadPoster', (_e, req: UploadReq) =>
    PlexService.uploadPoster(req)
  )

  ipcMain.handle('plex:getLabeledItems', (_e, req: LabelReq) =>
    PlexService.getLabeledItems(req)
  )

  ipcMain.handle('plex:resetPoster', async (_e, req: ResetReq) => {
    await PlexService.resetPoster(req)
  })

  ipcMain.handle('plex:getStats', () =>
    PlexService.getStats()
  )
}
