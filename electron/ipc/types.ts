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
  /** True for rule-based (dynamic) Plex collections such as "Trending Movies". */
  smart?: boolean
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
  /** When true, itemKey is a Plex Collection ratingKey (not a movie/show). */
  isCollection?: boolean
}

export interface UploadRes {
  success: boolean
  error?: string
  /** The target season or episode is not in Plex, so nothing was attempted. */
  skipped?: boolean
}

export interface LabelReq {
  label: string
}

export interface ResetReq {
  itemKey: string
  hierarchical?: boolean
  /** Also delete the uploaded poster/background image data from Plex (frees bundle space). */
  deleteUploads?: boolean
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
  /** Library Browser Sets panel width in pixels. */
  libraryPanelWidth?: number
  /** Friendly name of the connected Plex server. */
  plexServerName?: string
  scheduledJobs?: ScheduledJob[]
  /** Schedule used by the quick Schedule and Sync actions in the Library Browser. */
  schedulerQuickCron?: string
  /** Optional - enables tvdb/imdb to tmdb resolution for legacy/HAMA libraries. */
  tmdbApiKey?: string
  /** Followed MediUX usernames. */
  mediuxSubscriptions?: string[]
  /** Local history of applied poster sets (source of truth for Reset). */
  appliedPosters?: AppliedRecord[]
  /** Show the "minimized to tray" notification (default true). */
  trayNotice?: boolean
  /** Library titles excluded from all operations (empty = include all). */
  excludedLibraries?: string[]
  /** Show Plex collections in the Library Browser (default true). */
  collectionsEnabled?: boolean
  /** Library Browser grid sort field (default 'recentlyAdded'). */
  librarySort?: LibrarySort
  /** Library Browser grid sort direction (default 'desc'). */
  librarySortDir?: SortDir
  /** Chromium executable to use instead of the managed or bundled one. */
  browserExecutablePath?: string
  /** Signature of the browser executable that last passed a launch check. */
  browserVerified?: string
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
  /**
   * Art slots filled on the item: poster, backdrop, s<n> for a season poster,
   * s<n>e<n> for a title card. Records written before slots were tracked have
   * none and count as covering the whole item.
   */
  slots?: string[]
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
  web?: boolean
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

export type BrowserSource = 'managed' | 'bundled' | 'system' | 'custom'

export interface SystemBrowser {
  name: string
  path: string
}

export type BrowserInstallErrorKind =
  | 'offline'
  | 'network'
  | 'blocked'
  | 'disk'
  | 'permission'
  | 'antivirus'
  | 'missing-deps'
  | 'launch'
  | 'cancelled'
  | 'unknown'

export interface BrowserInstallError {
  kind: BrowserInstallErrorKind
  message: string
  /** What the user can do about it. */
  hint: string
  /** Shell command that resolves it (missing Linux system libraries). */
  command?: string
}

export type BrowserInstallStage =
  | 'idle'
  | 'preparing'
  | 'downloading'
  | 'extracting'
  | 'verifying'
  | 'retrying'
  | 'done'
  | 'failed'

export interface BrowserInstallState {
  stage: BrowserInstallStage
  attempt: number
  maxAttempts: number
  /** Download progress of the current file, 0-100, when known. */
  percent: number | null
  label: string
  /** Seconds until the next attempt while retrying. */
  retryInSeconds?: number
  error?: BrowserInstallError
}

export interface BrowserStatus {
  installed: boolean
  executablePath: string
  /** Where the active executable comes from; null when nothing is installed. */
  source: BrowserSource | null
  /** True once the executable has been launched successfully on this machine. */
  verified: boolean
  browsersPath: string
  bundledPath: string | null
  installing: boolean
  installState: BrowserInstallState | null
  /** Browsers found on this machine that can be used without a download. */
  systemBrowsers: SystemBrowser[]
}

export interface BrowserActionResult {
  ok: boolean
  error?: BrowserInstallError
  status: BrowserStatus
}

export type JobRunStatus = 'success' | 'partial' | 'error'

/** Outcome of one scheduled job run. */
export interface JobRun {
  /** ISO timestamp the run started. */
  startedAt: string
  /** ISO timestamp the run finished. */
  finishedAt: string
  /** What started the run. */
  trigger: 'schedule' | 'manual'
  status: JobRunStatus
  /** Posters uploaded to Plex. */
  uploaded: number
  /** Posters skipped because the same image was already applied to the item. */
  skipped: number
  /** Distinct titles or collections that are not in the Plex library. */
  unmatched: number
  /** Posters that failed to upload. */
  failed: number
  /** URLs that could not be scraped. */
  urlErrors: number
  /** Posters left alone because other art already fills their slot (fill-gaps jobs). */
  covered?: number
  /** First error message, when any. */
  error?: string
  /** Per-title breakdown, each list capped with a trailing "and N more" entry. */
  details?: JobRunDetails
}

export interface JobRunDetails {
  /** Titles that received artwork, as "Title (Year) · N posters". */
  applied: string[]
  /** Titles or collections not found in the Plex library. */
  unmatched: string[]
  /** Titles with a failed upload, as "Title (Year) · error". */
  failed: string[]
}

/** Live position of a running job, computed by the scheduler and never stored. */
export interface JobProgress {
  /** reading: fetching a creator's catalog; applying: working through sets. */
  phase: 'reading' | 'applying'
  done: number
  total: number
  /** What is being worked on, such as a creator name or a show title. */
  current?: string
}

export interface ScheduledJob {
  id: string
  name: string
  urls: string[]
  cronExpr: string
  enabled: boolean
  /** Upload only artwork not already applied to each item. Treated as true when unset. */
  skipApplied?: boolean
  /** Leave any slot that other art already fills, so this job only fills gaps. */
  fillGaps?: boolean
  /** MediUX creator this job syncs, set for jobs created from the Creators view. */
  creator?: string
  lastRun?: string
  lastStatus?: JobRunStatus | 'running'
  lastError?: string
  /** Most recent runs, newest first. */
  history?: JobRun[]
  /** Next firing as an ISO timestamp, computed by the scheduler and never stored. */
  nextRun?: string
  /** Waiting for an earlier job to finish; computed by the scheduler and never stored. */
  queued?: boolean
  /** Position of the current run; computed by the scheduler and never stored. */
  progress?: JobProgress
}

/** Server-side evaluation of a cron expression for the job editor. */
export interface CronPreview {
  valid: boolean
  error?: string
  /** Plain-language description in the scheduler's local time. */
  description: string
  /** Upcoming firings as ISO timestamps. */
  nextRuns: string[]
  /** IANA time zone the scheduler evaluates expressions in. */
  timeZone: string
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
  type: 'movie' | 'show' | 'collection'
  /** Full, token-bearing transcode URL for the UI. */
  thumb?: string
  /** Plex library name (collections). */
  libraryTitle?: string
  /** Member count (collections). */
  childCount?: number
  tmdbId?: string
  tvdbId?: string
  imdbId?: string
  /** HAMA's AniDB id, mapped to TMDB via the Fribb dataset. */
  anidbId?: string
}

/** Sort field for the Library Browser grid (mapped to a Plex sort key). */
export type LibrarySort = 'recentlyAdded' | 'title' | 'year' | 'lastPlayed'
export type SortDir = 'asc' | 'desc'

/** Narrows the Library Browser grid by applied-artwork history. */
export type LibraryArtFilter =
  /** Titles with no applied art on record. */
  | { kind: 'none' }
  /** Titles with any applied art on record. */
  | { kind: 'applied' }
  /** Titles whose applied art no scheduled job keeps updated. */
  | { kind: 'unscheduled' }
  /** Titles with art applied from one MediUX creator. */
  | { kind: 'uploader'; uploader: string }

export interface SectionItemsReq {
  sectionKey: string
  offset: number
  limit: number
  search?: string
  sort?: LibrarySort
  sortDir?: SortDir
  /** When set, the whole section is read and filtered before paging. */
  artFilter?: LibraryArtFilter
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
  anidbId?: string
}

export interface CollectionsReq {
  offset: number
  limit: number
  search?: string
  sort?: LibrarySort
  sortDir?: SortDir
}

export interface CollectionSetsReq {
  collectionKey: string
  title: string
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
  /**
   * 1-based page for a single-page fetch. The library:userSets handler now
   * crawls the creator's whole catalog regardless of this value; it's kept for
   * single-page callers. MediUX pages are a ~24-set window (+12 new/page), not
   * cumulative.
   */
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
  /** The crawl stopped at the page cap, so some sets may be missing. */
  capped?: boolean
  error?: string
}

/** State of a creator's background crawl. */
export type CreatorCrawlStatus = 'crawling' | 'done' | 'capped' | 'error'

/**
 * Immediate response to startUserSets: whatever the backend has buffered for
 * this creator so far, plus the crawl status. An empty snapshot with status
 * 'crawling' means a fresh crawl just began; chunks arrive via userSetsChunk.
 */
export interface UserSetsSnapshot {
  username: string
  sets: MediuxUserSet[]
  status: CreatorCrawlStatus
  capped: boolean
  /** Total sets buffered so far. */
  collected: number
  error?: string
}

/** A streamed batch of a creator's sets as the background crawl progresses. */
export interface UserSetsChunk {
  username: string
  /** Newly matched sets in this batch, or the full list when `reset` is set. */
  sets: MediuxUserSet[]
  /** Total sets buffered so far (across all chunks). */
  collected: number
  /** Highest MediUX page reached so far. */
  page: number
  /** The crawl has finished (settled, capped, or errored). */
  done: boolean
  capped: boolean
  status: CreatorCrawlStatus
  /** Replace the list with `sets` instead of appending (incremental resync). */
  reset?: boolean
  error?: string
}

export interface BrowseSetsRes {
  sets: MediuxSetSummary[]
  /** The resolved id (echoed back for the UI). */
  tmdbId?: string
  /** e.g. "no_tmdb" when the item can't be matched. */
  error?: string
  /** Plex collection member movies (collection browse only). */
  collectionMembers?: LibraryItem[]
}

export interface PlexArtSlot {
  key: string
  label: string
  thumb?: string
  kind: 'collection' | 'movie' | 'show' | 'season'
  season?: number
  /** True when this slot is the item the user selected */
  highlight?: boolean
}

export interface CurrentArtReq {
  key: string
  type: 'movie' | 'show' | 'collection'
  title: string
  year?: number
}

export interface CurrentArtRes {
  slots: PlexArtSlot[]
}

export type IpcChannels = {
  'plex:connect': { req: ConnectReq; res: ConnectRes }
  'plex:getLibraries': { req: void; res: Library[] }
  'plex:findItem': { req: FindItemReq; res: PlexItem | null }
  'plex:findCollection': { req: FindCollectionReq; res: PlexCollection | null }
  'plex:uploadPoster': { req: UploadReq; res: UploadRes }
  'plex:getLabeledItems': { req: LabelReq; res: PlexItem[] }
  'plex:resetPoster': { req: ResetReq; res: void }
  'plex:cleanBundles': { req: void; res: void }
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
  'scheduler:preview':     { req: string; res: CronPreview }
  'scheduler:reorder':     { req: string[]; res: ScheduledJob[] }
  'scheduler:onChange':    { event: ScheduledJob[] }
  'browser:status':          { req: void; res: BrowserStatus }
  'browser:install':         { req: { force?: boolean } | undefined; res: BrowserActionResult }
  'browser:cancelInstall':   { req: void; res: BrowserStatus }
  'browser:verify':          { req: void; res: BrowserActionResult }
  'browser:useExecutable':   { req: string | null; res: BrowserActionResult }
  'browser:pickExecutable':  { req: void; res: BrowserActionResult }
  'browser:installProgress': { event: string }
  'browser:installState':    { event: BrowserInstallState }
  'library:sections':        { req: void; res: LibrarySection[] }
  'library:items':           { req: SectionItemsReq; res: SectionItemsRes }
  'library:collections':     { req: CollectionsReq; res: SectionItemsRes }
  'library:collectionSets':  { req: CollectionSetsReq; res: BrowseSetsRes }
  'library:sets':            { req: BrowseSetsReq; res: BrowseSetsRes }
  'library:userSets':        { req: UserSetsReq; res: UserSetsRes }
  'library:startUserSets':   { req: UserSetsReq; res: UserSetsSnapshot }
  'library:refreshUserSets': { req: UserSetsReq; res: UserSetsSnapshot }
  'library:userSetsChunk':   { event: UserSetsChunk }
  'library:creatorSearch':   { req: CreatorSearchReq; res: UserSetsRes }
  'library:currentArt':      { req: CurrentArtReq; res: CurrentArtRes }
}
