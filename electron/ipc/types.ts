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
  agent?: string
}

export interface FindItemReq {
  title: string
  year?: number
  libraries: string[]
  /** Restrict search to this library type (avoids show/movie cross-matches). */
  type?: 'movie' | 'show'
  /** When set, match by TMDB id first - reliable even when Plex renamed the title. */
  tmdbId?: string
}

export interface FindCollectionReq {
  title: string
}

export interface PlexCollection {
  /** Collection ratingKey. */
  key: string
  title: string
  libraryTitle: string
  thumb?: string
  childCount?: number
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
  /** External ids parsed from the item's Plex guids, when available. */
  tmdbId?: string
  tvdbId?: string
  imdbId?: string
}

export interface UploadReq {
  /** Resolved show/movie ratingKey. */
  itemKey: string
  imageUrl: string
  source: 'mediux' | 'posterdb'
  /**
   * Routing hint - when present, the poster is applied to the matching
   * season under itemKey instead of the show itself.
   */
  season?: number | 'Cover' | 'Backdrop'
  /**
   * Routing hint - when present, the poster is applied to the matching
   * episode under itemKey instead of the show itself.
   */
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
  /** Full-res / download URL. */
  url: string
  /** Thumbnail for UI display (may differ from url on PosterDB). */
  thumbUrl?: string
  source: 'mediux' | 'posterdb'
  year?: number
  season?: number | 'Cover' | 'Backdrop'
  episode?: number
  /** Poster belongs to an individual movie inside a boxset/collection set. */
  isCollectionMember?: boolean
  /** TMDB id of the movie a collection-member poster targets, for exact item matching. */
  tmdbId?: string
  /** Poster is art for a Plex Collection object (match by collection name, not a movie/show). */
  isCollection?: boolean
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
  /** Friendly name of the connected Plex server. */
  plexServerName?: string
  scheduledJobs?: ScheduledJob[]
  /** Optional - enables tvdb/imdb to tmdb resolution for legacy/HAMA libraries. */
  tmdbApiKey?: string
  /** Followed MediUX usernames. */
  mediuxSubscriptions?: string[]
  /** @deprecated Set ids already applied; superseded by appliedPosters. */
  appliedSetIds?: string[]
  /** Local history of applied poster sets (source of truth for Reset). */
  appliedPosters?: AppliedRecord[]
  /** Show the "minimized to tray" notification (default true). */
  trayNotice?: boolean
  /** Library titles excluded from all operations (empty = include all). */
  excludedLibraries?: string[]
}

/**
 * One applied poster-set, recorded locally so tracking/reset never depends on
 * fragile Plex label round-trips.
 */
export interface AppliedRecord {
  itemKey: string
  title: string
  year?: number
  type: 'movie' | 'show' | 'collection'
  source: 'mediux' | 'posterdb'
  libraryTitle?: string
  thumb?: string
  setId?: string
  uploader?: string
  /** Exact poster image URLs applied (per-poster tracking). */
  posterUrls?: string[]
  /** ISO timestamp. */
  appliedAt: string
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
  /** desktop = in-app auto-update; docker = manual container update. */
  mode?: 'desktop' | 'docker'
  /** Link to the GitHub release (docker mode). */
  releaseUrl?: string
}

/** Where/how the app is running, so the renderer can tailor the update UX. */
export interface AppEnv {
  packaged: boolean
  container: boolean
  version: string
  repoUrl: string
}

/** Download progress pushed from electron-updater while a new version downloads. */
export interface UpdateProgress {
  /** 0-100. */
  percent: number
  /** Bytes transferred so far. */
  transferred: number
  /** Total bytes. */
  total: number
  bytesPerSecond: number
}

export interface PlexAuthStatus {
  status: 'idle' | 'waiting' | 'authorized' | 'timeout' | 'error'
  pin?: string
  /** Open this to sign in (shown when no browser can be opened, e.g. Docker). */
  authUrl?: string
  token?: string
  error?: string
  /** Set when auto-connect succeeds at auth time. */
  serverName?: string
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

export interface SchedulerEngineStatus {
  /** A 24/7 headless engine elsewhere is running this config's jobs. */
  external: boolean
  /** Last heartbeat from that engine. */
  updatedAt?: string
}

export interface LibrarySection {
  key: string
  title: string
  type: 'movie' | 'show'
}

export interface LibraryItem {
  /** Plex ratingKey. */
  key: string
  title: string
  year?: number
  type: 'movie' | 'show'
  /** Full, token-bearing transcode URL for the UI. */
  thumb?: string
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

/** One MediUX set available for a given title, with its uploader. */
export interface MediuxSetSummary {
  id: string
  setName: string
  uploader: string
  uploaderAvatar?: string
  posterCount: number
  backdropCount: number
  titleCardCount: number
  /** Representative poster thumbnail. */
  previewUrl?: string
  /** Every file in the set, ready to apply. */
  posters: PosterInfo[]
  /** Detected from the set's files (title cards/seasons imply a show). */
  mediaType?: 'movie' | 'show'
}

export interface BrowseSetsReq {
  type: 'movie' | 'show'
  tmdbId?: string
  tvdbId?: string
  imdbId?: string
}

/** A set from a creator's page, with library-match info resolved. */
export interface MediuxUserSet extends MediuxSetSummary {
  /** Parsed media title (for matching). */
  title: string
  year?: number
  dateUpdated?: string
  /** Plex ratingKey if this title is in the library. */
  matchedKey?: string
  matchedType?: 'movie' | 'show'
}

export interface UserSetsReq {
  username: string
  /** Cumulative page (N = first N*12 sets); default 1. */
  page?: number
}

/**
 * Deep search: find a creator's sets for library titles matching a query - works
 * across the creator's entire catalog (not just the browse-capped first pages).
 */
export interface CreatorSearchReq {
  username: string
  query: string
}

export interface UserSetsRes {
  username: string
  sets: MediuxUserSet[]
  page: number
  /** A full page came back, so more likely exist. */
  hasMore: boolean
  error?: string
}

export interface BrowseSetsRes {
  sets: MediuxSetSummary[]
  /** The resolved id (echoed back for the UI). */
  tmdbId?: string
  /** e.g. "no_tmdb" when the item can't be matched. */
  error?: string
}

export type IpcChannels = {
  'plex:connect': { req: ConnectReq; res: ConnectRes }
  'plex:getLibraries': { req: void; res: Library[] }
  'plex:findItem': { req: FindItemReq; res: PlexItem | null }
  'plex:findCollection': { req: FindCollectionReq; res: PlexCollection | null }
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
  'app:getEnv': { req: void; res: AppEnv }
  'app:checkUpdate': { req: void; res: UpdateInfo }
  'app:openExternal': { req: string; res: void }
  'app:installUpdate': { req: void; res: void }
  'app:quitAndInstall': { req: void; res: void }
  'app:openLogFolder': { req: void; res: void }
  'app:updateAvailable': { event: UpdateInfo }
  'app:downloadProgress': { event: UpdateProgress }
  'app:updateReady': { event: void }
  'log:getHistory': { req: void; res: LogEntry[] }
  'log:clear': { req: void; res: void }
  'log:stream': { event: LogEntry }
  'scrape:progress': { event: ScrapeProgress }
  'auth:statusChange': { event: PlexAuthStatus }
  'scheduler:list':        { req: void; res: ScheduledJob[] }
  'scheduler:save':        { req: ScheduledJob; res: ScheduledJob }
  'scheduler:delete':      { req: string; res: void }
  'scheduler:runNow':      { req: string; res: void }
  'scheduler:setAutoStart':{ req: boolean; res: void }
  'scheduler:getAutoStart':{ req: void; res: boolean }
  'scheduler:engineStatus':{ req: void; res: SchedulerEngineStatus }
  'scheduler:onChange':    { event: ScheduledJob[] }
  'browser:status':          { req: void; res: BrowserStatus }
  'browser:install':         { req: void; res: void }
  'browser:installProgress': { event: string }
  'library:sections':        { req: void; res: LibrarySection[] }
  'library:items':           { req: SectionItemsReq; res: SectionItemsRes }
  'library:sets':            { req: BrowseSetsReq; res: BrowseSetsRes }
  'library:userSets':        { req: UserSetsReq; res: UserSetsRes }
  'library:creatorSearch':   { req: CreatorSearchReq; res: UserSetsRes }
}
