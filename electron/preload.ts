import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, ScrapeProgress, LogEntry, PlexAuthStatus, UpdateInfo, UpdateProgress, AppEnv, ScheduledJob, SchedulerEngineStatus, CronPreview, ClearCachesRes, AppliedRecord, BrowserStatus, BrowserActionResult, BrowserInstallState, SectionItemsReq, BrowseSetsReq, UserSetsReq, CreatorSearchReq, CollectionsReq, CollectionSetsReq, CurrentArtReq, UserSetsChunk } from './ipc/types'

/** Typed IPC bridge exposed to the renderer as window.api. */
const api = {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  plex: {
    connect: (baseUrl: string, token: string) =>
      ipcRenderer.invoke('plex:connect', { baseUrl, token }),
    getLibraries: () => ipcRenderer.invoke('plex:getLibraries'),
    findItem: (title: string, year?: number, libraries?: string[], tmdbId?: string) =>
      ipcRenderer.invoke('plex:findItem', { title, year, libraries: libraries ?? [], tmdbId }),
    findCollection: (title: string) =>
      ipcRenderer.invoke('plex:findCollection', { title }),
    uploadPoster: (
      itemKey: string,
      imageUrl: string,
      source: 'mediux' | 'posterdb',
      season?: number | 'Cover' | 'Backdrop',
      episode?: number,
      isCollection?: boolean,
    ) =>
      ipcRenderer.invoke('plex:uploadPoster', { itemKey, imageUrl, source, season, episode, isCollection }),
    getLabeledItems: (label: string) =>
      ipcRenderer.invoke('plex:getLabeledItems', { label }),
    resetPoster: (itemKey: string, hierarchical?: boolean, deleteUploads?: boolean) =>
      ipcRenderer.invoke('plex:resetPoster', { itemKey, hierarchical, deleteUploads }),
    cleanBundles: () => ipcRenderer.invoke('plex:cleanBundles'),
    getStats: () => ipcRenderer.invoke('plex:getStats'),
    getLibraryCount: (key: string, type: 'movie' | 'show') =>
      ipcRenderer.invoke('plex:getLibraryCount', key, type),
  },

  library: {
    sections: () => ipcRenderer.invoke('library:sections'),
    items: (req: SectionItemsReq) => ipcRenderer.invoke('library:items', req),
    collections: (req: CollectionsReq) => ipcRenderer.invoke('library:collections', req),
    collectionSets: (req: CollectionSetsReq) => ipcRenderer.invoke('library:collectionSets', req),
    sets: (req: BrowseSetsReq) => ipcRenderer.invoke('library:sets', req),
    userSets: (req: UserSetsReq) => ipcRenderer.invoke('library:userSets', req),
    startUserSets: (req: UserSetsReq) => ipcRenderer.invoke('library:startUserSets', req),
    refreshUserSets: (req: UserSetsReq) => ipcRenderer.invoke('library:refreshUserSets', req),
    onUserSetsChunk: (cb: (chunk: UserSetsChunk) => void) =>
    {
      const handler = (_: unknown, data: UserSetsChunk) => cb(data)
      ipcRenderer.on('library:userSetsChunk', handler)
      return () => { ipcRenderer.removeListener('library:userSetsChunk', handler) }
    },
    creatorSearch: (req: CreatorSearchReq) => ipcRenderer.invoke('library:creatorSearch', req),
    currentArt: (req: CurrentArtReq) => ipcRenderer.invoke('library:currentArt', req),
  },

  scrape: {
    url: (url: string) => ipcRenderer.invoke('scrape:url', { url }),
    cancel: () => ipcRenderer.invoke('scrape:cancel'),
    onProgress: (cb: (progress: ScrapeProgress) => void) =>
    {
      const handler = (_: unknown, data: ScrapeProgress) => cb(data)
      ipcRenderer.on('scrape:progress', handler)
      return () => { ipcRenderer.removeListener('scrape:progress', handler) }
    },
  },

  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    set: (partial: Partial<AppConfig>) => ipcRenderer.invoke('config:set', partial),
  },

  bulk: {
    listFiles: (): Promise<string[]> => ipcRenderer.invoke('bulk:listFiles'),
    readFile: (filename: string): Promise<string[]> =>
      ipcRenderer.invoke('bulk:readFile', filename),
    writeFile: (filename: string, lines: string[]) =>
      ipcRenderer.invoke('bulk:writeFile', { filename, lines }),
    newFile: (filename: string) => ipcRenderer.invoke('bulk:newFile', filename),
    deleteFile: (filename: string) => ipcRenderer.invoke('bulk:deleteFile', filename),
    renameFile: (oldName: string, newName: string) => ipcRenderer.invoke('bulk:renameFile', oldName, newName),
  },

  auth: {
    signIn: (): Promise<string> => ipcRenderer.invoke('auth:plexSignIn'),
    getStatus: (): Promise<PlexAuthStatus> => ipcRenderer.invoke('auth:plexStatus'),
    disconnect: () => ipcRenderer.invoke('auth:disconnect'),
    onStatusChange: (cb: (status: PlexAuthStatus) => void) =>
    {
      const handler = (_: unknown, data: PlexAuthStatus) => cb(data)
      ipcRenderer.on('auth:statusChange', handler)
      return () => { ipcRenderer.removeListener('auth:statusChange', handler) }
    },
  },

  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
    getEnv: (): Promise<AppEnv> => ipcRenderer.invoke('app:getEnv'),
    checkUpdate: (): Promise<UpdateInfo> => ipcRenderer.invoke('app:checkUpdate'),
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    quitAndInstall: () => ipcRenderer.invoke('app:quitAndInstall'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    openLogFolder: () => ipcRenderer.invoke('app:openLogFolder'),
    clearCaches: (): Promise<ClearCachesRes> => ipcRenderer.invoke('app:clearCaches'),
    onUpdateAvailable: (cb: (info: UpdateInfo) => void) =>
    {
      const handler = (_: unknown, data: UpdateInfo) => cb(data)
      ipcRenderer.on('app:updateAvailable', handler)
      return () => { ipcRenderer.removeListener('app:updateAvailable', handler) }
    },
    onDownloadProgress: (cb: (p: UpdateProgress) => void) =>
    {
      const handler = (_: unknown, data: UpdateProgress) => cb(data)
      ipcRenderer.on('app:downloadProgress', handler)
      return () => { ipcRenderer.removeListener('app:downloadProgress', handler) }
    },
    onUpdateReady: (cb: () => void) =>
    {
      ipcRenderer.on('app:updateReady', cb)
      return () => { ipcRenderer.removeListener('app:updateReady', cb) }
    },
  },

  applied: {
    record: (records: AppliedRecord[]): Promise<void> => ipcRenderer.invoke('applied:record', records),
    forget: (itemKey: string): Promise<void> => ipcRenderer.invoke('applied:forget', itemKey),
  },

  scheduler: {
    list: (): Promise<ScheduledJob[]> => ipcRenderer.invoke('scheduler:list'),
    save: (job: ScheduledJob): Promise<ScheduledJob> => ipcRenderer.invoke('scheduler:save', job),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('scheduler:delete', id),
    runNow: (id: string): Promise<void> => ipcRenderer.invoke('scheduler:runNow', id),
    setAutoStart: (v: boolean): Promise<void> => ipcRenderer.invoke('scheduler:setAutoStart', v),
    getAutoStart: (): Promise<boolean> => ipcRenderer.invoke('scheduler:getAutoStart'),
    engineStatus: (): Promise<SchedulerEngineStatus> => ipcRenderer.invoke('scheduler:engineStatus'),
    preview: (expr: string): Promise<CronPreview> => ipcRenderer.invoke('scheduler:preview', expr),
    reorder: (ids: string[]): Promise<ScheduledJob[]> => ipcRenderer.invoke('scheduler:reorder', ids),
    onChange: (cb: (jobs: ScheduledJob[]) => void) =>
    {
      const handler = (_: unknown, data: ScheduledJob[]) => cb(data)
      ipcRenderer.on('scheduler:onChange', handler)
      return () => { ipcRenderer.removeListener('scheduler:onChange', handler) }
    },
  },

  browser: {
    getStatus: (): Promise<BrowserStatus> => ipcRenderer.invoke('browser:status'),
    install: (options?: { force?: boolean }): Promise<BrowserActionResult> => ipcRenderer.invoke('browser:install', options),
    cancelInstall: (): Promise<BrowserStatus> => ipcRenderer.invoke('browser:cancelInstall'),
    verify: (): Promise<BrowserActionResult> => ipcRenderer.invoke('browser:verify'),
    useExecutable: (execPath: string | null): Promise<BrowserActionResult> => ipcRenderer.invoke('browser:useExecutable', execPath),
    pickExecutable: (): Promise<BrowserActionResult> => ipcRenderer.invoke('browser:pickExecutable'),
    onInstallProgress: (cb: (line: string) => void) =>
    {
      const handler = (_: unknown, line: string) => cb(line)
      ipcRenderer.on('browser:installProgress', handler)
      return () => { ipcRenderer.removeListener('browser:installProgress', handler) }
    },
    onInstallState: (cb: (state: BrowserInstallState) => void) =>
    {
      const handler = (_: unknown, state: BrowserInstallState) => cb(state)
      ipcRenderer.on('browser:installState', handler)
      return () => { ipcRenderer.removeListener('browser:installState', handler) }
    },
  },

  log: {
    getHistory: (): Promise<LogEntry[]> => ipcRenderer.invoke('log:getHistory'),
    clear: (): Promise<void> => ipcRenderer.invoke('log:clear'),
    onEntry: (cb: (entry: LogEntry) => void) =>
    {
      const handler = (_: unknown, data: LogEntry) => cb(data)
      ipcRenderer.on('log:stream', handler)
      return () => { ipcRenderer.removeListener('log:stream', handler) }
    },
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
