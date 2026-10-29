import type { IpcMain, BrowserWindow } from 'electron'
import { handlers } from '../handlers'
import { appEvents } from '../runtime/events'
import type { SectionItemsReq, BrowseSetsReq, UserSetsReq, CreatorSearchReq, CollectionsReq, CollectionSetsReq, CurrentArtReq, UserSetsChunk, LinkedSetsReq, LinkSetReq, UnlinkSetReq } from './types'

export function registerLibraryHandlers(ipcMain: IpcMain, win?: BrowserWindow) {
  if (win) {
    appEvents.onEvent('library:userSetsChunk', (chunk: UserSetsChunk) => {
      if (!win.isDestroyed()) win.webContents.send('library:userSetsChunk', chunk)
    })
  }

  ipcMain.handle('library:sections', () => handlers.library.sections())
  ipcMain.handle('library:items', (_e, req: SectionItemsReq) => handlers.library.items(req))
  ipcMain.handle('library:collections', (_e, req: CollectionsReq) => handlers.library.collections(req))
  ipcMain.handle('library:collectionSets', (_e, req: CollectionSetsReq) => handlers.library.collectionSets(req))
  ipcMain.handle('library:sets', (_e, req: BrowseSetsReq) => handlers.library.sets(req))
  ipcMain.handle('library:userSets', (_e, req: UserSetsReq) => handlers.library.userSets(req))
  ipcMain.handle('library:startUserSets', (_e, req: UserSetsReq) => handlers.library.startUserSets(req))
  ipcMain.handle('library:refreshUserSets', (_e, req: UserSetsReq) => handlers.library.refreshUserSets(req))
  ipcMain.handle('library:creatorSearch', (_e, req: CreatorSearchReq) => handlers.library.creatorSearch(req))
  ipcMain.handle('library:currentArt', (_e, req: CurrentArtReq) => handlers.library.currentArt(req))
  ipcMain.handle('library:linkedSets', (_e, req: LinkedSetsReq) => handlers.library.linkedSets(req))
  ipcMain.handle('library:linkSet', (_e, req: LinkSetReq) => handlers.library.linkSet(req))
  ipcMain.handle('library:unlinkSet', (_e, req: UnlinkSetReq) => handlers.library.unlinkSet(req))
}
