export interface ConnectReq {
  baseUrl: string
  token: string
}

export interface ConnectRes {
  success: boolean
  serverName?: string
  libraryCount?: number
  error?: string
}

export interface Library {
  key: string
  title: string
  type: 'movie' | 'show' | 'artist' | 'photo'
}

export interface FindItemReq {
  title: string
  year?: number
  libraries: string[]
}

export interface PlexItem {
  key: string
  title: string
  year?: number
  type: 'movie' | 'show' | 'season' | 'episode'
  libraryTitle: string
  thumb?: string
  labels: string[]
  season?: number
  episode?: number
}

export interface UploadReq {
  itemKey: string                              // resolved show/movie ratingKey
  imageUrl: string
  source: 'mediux' | 'posterdb'
  // Routing hints - when present, the poster is applied to the matching
  // season/episode under itemKey instead of the show itself.
  season?: number | 'Cover' | 'Backdrop'
  episode?: number
}

export interface UploadRes {
  success: boolean
  error?: string
}

export interface LabelReq {
  label: string
}

export interface ResetReq {
  itemKey: string
  hierarchical?: boolean
}

export interface ScrapeReq {
  url: string
  workerId?: number
}

export interface PosterInfo {
  title: string
  url: string            // full-res / download URL
  thumbUrl?: string      // thumbnail for UI display (may differ from url on PosterDB)
  source: 'mediux' | 'posterdb'
  year?: number
  season?: number | 'Cover' | 'Backdrop'
  episode?: number
}

export interface ScrapeProgress {
  url: string
  status: 'idle' | 'scraping' | 'uploading' | 'done' | 'error'
  posterCount?: number
  uploadedCount?: number
  error?: string
  workerId?: number
}

export interface BulkWriteReq {
  filename: string
  lines: string[]
}

export interface AppConfig {
  baseUrl: string
  token: string
  tvLibraries: string[]
  movieLibraries: string[]
  mediuxFilters: Array<'poster' | 'backdrop' | 'title_card'>
  titleMappings: Record<string, string>
  maxWorkers: number
  bulkFiles: string[]
  scraperMinDelay: number
  scraperMaxDelay: number
  scraperInitialDelay: number
  scraperBatchDelay: number
  scraperPageWaitMin: number
  scraperPageWaitMax: number
  logAppend: boolean
  clientIdentifier: string
  plexAccountName?: string
  plexAccountEmail?: string
  plexAccountThumb?: string
  logDrawerHeight: number
  plexServerName?: string  // friendly name of the connected Plex server
  scheduledJobs?: ScheduledJob[]
  tmdbApiKey?: string      // optional - enables tvdb/imdb→tmdb resolution for legacy/HAMA libraries
  mediuxSubscriptions?: string[]  // followed MediUX usernames
  appliedSetIds?: string[]        // (legacy) set ids already applied
  appliedPosters?: AppliedRecord[] // local history of applied poster sets (source of truth for Reset)
  trayNotice?: boolean            // show the "minimized to tray" notification (default true)
}

// One applied poster-set, recorded locally so tracking/reset never depends on
// fragile Plex label round-trips.
export interface AppliedRecord {
  itemKey: string
  title: string
  year?: number
  type: 'movie' | 'show'
  source: 'mediux' | 'posterdb'
  libraryTitle?: string
  thumb?: string
  setId?: string
  uploader?: string
  posterUrls?: string[]           // exact poster image URLs applied (per-poster tracking)
  appliedAt: string               // ISO timestamp
}

export interface LogEntry {
  ts: string
  level: 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'session' | 'success' | 'scrape'
  module: string
  message: string
  meta?: Record<string, unknown>
}

export interface UpdateInfo {
  available: boolean
  version?: string
  releaseNotes?: string
}

// Download progress pushed from electron-updater while a new version downloads.
export interface UpdateProgress {
  percent: number          // 0-100
  transferred: number      // bytes
  total: number            // bytes
  bytesPerSecond: number
}

export interface PlexAuthStatus {
  status: 'idle' | 'waiting' | 'authorized' | 'timeout' | 'error'
  pin?: string
  authUrl?: string      // open this to sign in (shown when no browser can be opened, e.g. Docker)
  token?: string
  error?: string
  serverName?: string   // set when auto-connect succeeds at auth time
}

export interface BrowserStatus {
  installed: boolean
  executablePath: string
  browsersPath: string
}

export interface ScheduledJob {
  id: string
  name: string
  urls: string[]
  cronExpr: string
  enabled: boolean
  lastRun?: string
  lastStatus?: 'success' | 'error' | 'running'
  lastError?: string
}

// --- Library browser (AURA-style) ---------------------------------------------

export interface LibrarySection {
  key: string
  title: string
  type: 'movie' | 'show'
}

export interface LibraryItem {
  key: string                 // Plex ratingKey
  title: string
  year?: number
  type: 'movie' | 'show'
  thumb?: string              // full, token-bearing transcode URL for the UI
  tmdbId?: string
  tvdbId?: string
  imdbId?: string
}

export interface SectionItemsReq {
  sectionKey: string
  offset: number
  limit: number
  search?: string
}

export interface SectionItemsRes {
  items: LibraryItem[]
  total: number
}

// One MediUX set available for a given title, with its uploader.
export interface MediuxSetSummary {
  id: string
  setName: string
  uploader: string
  uploaderAvatar?: string
  posterCount: number
  backdropCount: number
  titleCardCount: number
  previewUrl?: string         // representative poster thumbnail
  posters: PosterInfo[]       // every file in the set, ready to apply
}

export interface BrowseSetsReq {
  type: 'movie' | 'show'
  tmdbId?: string
  tvdbId?: string
  imdbId?: string
}

// A set from a creator's page, with library-match info resolved.
export interface MediuxUserSet extends MediuxSetSummary {
  title: string            // parsed media title (for matching)
  year?: number
  dateUpdated?: string
  matchedKey?: string      // Plex ratingKey if this title is in the library
  matchedType?: 'movie' | 'show'
}

export interface UserSetsReq {
  username: string
}

export interface UserSetsRes {
  username: string
  sets: MediuxUserSet[]
  error?: string
}

export interface BrowseSetsRes {
  sets: MediuxSetSummary[]
  tmdbId?: string          // the resolved id (echoed back for the UI)
  error?: string           // e.g. "no_tmdb" when the item can't be matched
}

export type IpcChannels = {
  'plex:connect': { req: ConnectReq; res: ConnectRes }
  'plex:getLibraries': { req: void; res: Library[] }
  'plex:findItem': { req: FindItemReq; res: PlexItem | null }
  'plex:uploadPoster': { req: UploadReq; res: UploadRes }
  'plex:getLabeledItems': { req: LabelReq; res: PlexItem[] }
  'plex:resetPoster': { req: ResetReq; res: void }
  'plex:getStats': { req: void; res: Record<string, number> }
  'scrape:url': { req: ScrapeReq; res: PosterInfo[] }
  'scrape:cancel': { req: void; res: void }
  'config:get': { req: void; res: AppConfig }
  'config:set': { req: Partial<AppConfig>; res: void }
  'bulk:listFiles': { req: void; res: string[] }
  'bulk:readFile': { req: string; res: string[] }
  'bulk:writeFile': { req: BulkWriteReq; res: void }
  'bulk:newFile': { req: string; res: void }
  'bulk:deleteFile': { req: string; res: void }
  'bulk:renameFile': { req: { oldName: string; newName: string }; res: void }
  'auth:plexSignIn': { req: void; res: string }
  'auth:plexStatus': { req: void; res: PlexAuthStatus }
  'auth:disconnect': { req: void; res: void }
  'app:getVersion': { req: void; res: string }
  'app:checkUpdate': { req: void; res: UpdateInfo }
  'app:installUpdate': { req: void; res: void }
  'app:quitAndInstall': { req: void; res: void }
  'app:openLogFolder': { req: void; res: void }
  'app:updateAvailable': { event: UpdateInfo }
  'app:downloadProgress': { event: UpdateProgress }
  'app:updateReady': { event: void }
  'log:getHistory': { req: void; res: LogEntry[] }
  'log:stream': { event: LogEntry }
  'scrape:progress': { event: ScrapeProgress }
  'auth:statusChange': { event: PlexAuthStatus }
  'scheduler:list':        { req: void; res: ScheduledJob[] }
  'scheduler:save':        { req: ScheduledJob; res: ScheduledJob }
  'scheduler:delete':      { req: string; res: void }
  'scheduler:runNow':      { req: string; res: void }
  'scheduler:setAutoStart':{ req: boolean; res: void }
  'scheduler:getAutoStart':{ req: void; res: boolean }
  'scheduler:onChange':    { event: ScheduledJob[] }
  'browser:status':          { req: void; res: BrowserStatus }
  'browser:install':         { req: void; res: void }
  'browser:installProgress': { event: string }
  'library:sections':        { req: void; res: LibrarySection[] }
  'library:items':           { req: SectionItemsReq; res: SectionItemsRes }
  'library:sets':            { req: BrowseSetsReq; res: BrowseSetsRes }
  'library:userSets':        { req: UserSetsReq; res: UserSetsRes }
}
