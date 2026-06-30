import type { BrowserWindow } from 'electron'
import { PlexService } from '../services/plexService'
import { ScraperFactory } from '../scrapers/scraperFactory'
import { mapPool } from '../scrapers/baseScraper'
import { BulkService } from '../services/bulkService'
import { PlexAuthService } from '../services/plexAuthService'
import { ConfigService } from '../services/config'
import { Logger } from '../services/logger'
import { SchedulerService } from '../services/schedulerService'
import { PlaywrightService } from '../services/playwrightService'
import { appEvents } from '../runtime/events'
import { getAppVersion, isContainerEnv, isWebMode } from '../runtime/runtime'
import type {
  ConnectReq, FindItemReq, FindCollectionReq, UploadReq, LabelReq, ResetReq,
  ScrapeReq, ScrapeProgress, BulkWriteReq, PlexAuthStatus, ScheduledJob,
  SectionItemsReq, BrowseSetsReq, BrowseSetsRes, UserSetsReq, UserSetsRes,
  CollectionsReq, CollectionSetsReq,
  CreatorSearchReq, MediuxUserSet, AppEnv, UpdateInfo,
  CurrentArtReq,
} from '../ipc/types'

const REPO = 'molexxxx/plex-poster-set-helper-2'
const REPO_URL = `https://github.com/${REPO}`

function emitAuth(status: PlexAuthStatus) {
  appEvents.emitEvent('auth:statusChange', status)
}

function emitScrape(progress: ScrapeProgress) {
  appEvents.emitEvent('scrape:progress', progress)
}

function isNewer(latest: string, current: string): boolean {
  const norm = (v: string) => v.replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0)
  const a = norm(latest), b = norm(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

async function checkGithubRelease(): Promise<{ version?: string; notes?: string; url?: string } | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'plex-poster-set-helper-2', Accept: 'application/vnd.github+json' },
    })
    if (!r.ok) return null
    const j = await r.json() as { tag_name?: string; body?: string; html_url?: string }
    return { version: (j.tag_name ?? '').replace(/^v/, ''), notes: j.body, url: j.html_url }
  } catch {
    return null
  }
}

export const handlers = {
  plex: {
    connect: (req: ConnectReq) => PlexService.connect(req),
    getLibraries: () => {
      const conn = PlexService.getConnection()
      if (!conn) return []
      return PlexService.fetchLibraries(conn.baseUrl, conn.token)
    },
    getLibraryCount: (key: string, type: 'movie' | 'show') => PlexService.getLibraryCount(key, type),
    findItem: (req: FindItemReq) => PlexService.findInLibrary(req),
    findCollection: (req: FindCollectionReq) => PlexService.findCollection(req),
    uploadPoster: (req: UploadReq) => PlexService.uploadPoster(req),
    getLabeledItems: (req: LabelReq) => PlexService.getLabeledItems(req),
    resetPoster: async (req: ResetReq) => { await PlexService.resetPoster(req) },
    cleanBundles: () => PlexService.cleanBundles(),
    getStats: () => PlexService.getStats(),
  },

  library: {
    sections: () => PlexService.getSections(),
    items: (req: SectionItemsReq) => PlexService.getSectionItems(req),
    collections: (req: CollectionsReq) => PlexService.listCollections(req),
    collectionSets: async (req: CollectionSetsReq): Promise<BrowseSetsRes> => {
      try {
        const info = await PlexService.getCollectionInfo(req.collectionKey)
        const title = info.title || req.title
        if (!info.children.length) return { sets: [], error: 'no_movies' }

        // Resolve every member's TMDB id at once - each is an independent Plex/
        // TMDB lookup, so a sequential loop just stacks the latency. Promise.all
        // preserves order, which matters: the first id seeds the collection-id
        // lookup and the fallback scan walks members in order.
        const resolved = await Promise.all(info.children.map(child => PlexService.resolveTmdbId(child)))
        const childTmdbIds = resolved.filter((id): id is string => !!id)

        let tmdbCollectionId = info.tmdbCollectionId
        if (!tmdbCollectionId && childTmdbIds[0]) {
          tmdbCollectionId = (await PlexService.resolveTmdbCollectionId(childTmdbIds[0])) ?? undefined
        }

        if (!tmdbCollectionId && !childTmdbIds.length) {
          return { sets: [], error: 'no_tmdb' }
        }

        Logger.scrape(
          'Library',
          `Collection "${title}": tmdbCollection=${tmdbCollectionId ?? 'none'}, ${childTmdbIds.length}/${info.children.length} child TMDB id(s)`,
        )

        const sets = await ScraperFactory.browseMediuxCollection(
          title,
          tmdbCollectionId,
          childTmdbIds,
        )
        return { sets, collectionMembers: info.children }
      } catch (err) {
        Logger.error('Library', `collectionSets failed: ${err instanceof Error ? err.message : String(err)}`)
        return { sets: [], error: err instanceof Error ? err.message : String(err) }
      }
    },
    sets: async (req: BrowseSetsReq): Promise<BrowseSetsRes> => {
      try {
        const tmdbId = await PlexService.resolveTmdbId({
          key: '', title: '', type: req.type,
          tmdbId: req.tmdbId, tvdbId: req.tvdbId, imdbId: req.imdbId, anidbId: req.anidbId,
        })
        if (!tmdbId) return { sets: [], error: 'no_tmdb' }
        const sets = await ScraperFactory.browseMediux(tmdbId, req.type)
        return { sets, tmdbId }
      } catch (err) {
        Logger.error('Library', `browseMediux failed: ${err instanceof Error ? err.message : err}`)
        return { sets: [], error: err instanceof Error ? err.message : String(err) }
      }
    },
    userSets: async (req: UserSetsReq): Promise<UserSetsRes> => {
      try {
        // MediUX no longer paginates cumulatively, so crawl every page and dedupe
        // to get the creator's full catalog instead of just the first ~24 sets.
        const { sets, capped } = await ScraperFactory.browseMediuxUserAll(req.username)
        // Bound Plex lookups - a large creator can return thousands of sets, and
        // an unbounded Promise.all would fire that many concurrent Plex queries.
        const resolved = await mapPool(sets, 8, async s => {
          if (!s.title) return s
          const match = await PlexService.findInLibrary({ title: s.title, year: s.year, libraries: [], type: s.mediaType })
          return match ? { ...s, matchedKey: match.key, matchedType: match.type as 'movie' | 'show' } : s
        })
        return { username: req.username, sets: resolved, page: 1, hasMore: false, capped }
      } catch (err) {
        Logger.error('Library', `browseMediuxUserAll failed: ${err instanceof Error ? err.message : err}`)
        return { username: req.username, sets: [], page: 1, hasMore: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    creatorSearch: async (req: CreatorSearchReq): Promise<UserSetsRes> => {
      const username = req.username
      const q = req.query.trim()
      if (q.length < 2) return { username, sets: [], page: 1, hasMore: false }
      try {
        const target = username.toLowerCase()
        const sections = await PlexService.getSections()
        const items = []
        for (const sec of sections) {
          const res = await PlexService.getSectionItems({ sectionKey: sec.key, offset: 0, limit: 6, search: q })
          items.push(...res.items)
          if (items.length >= 12) break
        }
        const out: MediuxUserSet[] = []
        const seen = new Set<string>()
        for (const item of items.slice(0, 10)) {
          if (item.type === 'collection') continue
          const tmdbId = await PlexService.resolveTmdbId({
            key: item.key, title: item.title, type: item.type,
            tmdbId: item.tmdbId, tvdbId: item.tvdbId, imdbId: item.imdbId, anidbId: item.anidbId,
          })
          if (!tmdbId) continue
          const sets = await ScraperFactory.browseMediux(tmdbId, item.type)
          for (const s of sets) {
            if (s.uploader.toLowerCase() !== target || seen.has(s.id)) continue
            seen.add(s.id)
            out.push({ ...s, title: item.title, year: item.year, matchedKey: item.key, matchedType: item.type })
          }
        }
        return { username, sets: out, page: 1, hasMore: false }
      } catch (err) {
        Logger.error('Library', `creatorSearch failed: ${err instanceof Error ? err.message : err}`)
        return { username, sets: [], page: 1, hasMore: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    currentArt: (req: CurrentArtReq) => PlexService.getCurrentArt(req),
  },

  scrape: {
    url: (req: ScrapeReq) => ScraperFactory.scrapeUrl(req.url, emitScrape, req.workerId),
    cancel: async () => {
      ScraperFactory.abort()
      await ScraperFactory.close()
    },
  },

  config: {
    get: () => ConfigService.get(),
    set: (partial: Parameters<typeof ConfigService.set>[0]) => ConfigService.set(partial),
  },

  bulk: {
    listFiles: () => BulkService.list(),
    readFile: (filename: string) => BulkService.read(filename),
    writeFile: ({ filename, lines }: BulkWriteReq) => BulkService.write(filename, lines),
    newFile: (filename: string) => BulkService.create(filename),
    deleteFile: (filename: string) => BulkService.delete(filename),
    renameFile: (oldName: string, newName: string) => BulkService.rename(oldName, newName),
  },

  auth: {
    beginSignIn: async (_win?: BrowserWindow | null) => {
      try {
        const waiting = await PlexAuthService.beginSignIn(_win ?? null, emitAuth)
        void PlexAuthService.waitForActiveSignIn()
          .then(token => {
            const cfg = ConfigService.get()
            if (cfg.baseUrl) {
              PlexService.connect({ baseUrl: cfg.baseUrl, token }).catch(err => {
                Logger.warn('Auth', `Auto-connect after sign-in failed: ${err instanceof Error ? err.message : err}`)
              })
            }
          })
          .catch(err => {
            const error = err instanceof Error ? err.message : String(err)
            if (error !== 'Sign-in cancelled') {
              emitAuth({ status: 'error', error })
            }
          })
        return waiting
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        emitAuth({ status: 'error', error })
        throw err
      }
    },
    signIn: async (_win?: BrowserWindow | null) => {
      try {
        const token = await PlexAuthService.signIn(_win ?? null, emitAuth)
        const cfg = ConfigService.get()
        if (cfg.baseUrl) {
          PlexService.connect({ baseUrl: cfg.baseUrl, token }).catch(err => {
            Logger.warn('Auth', `Auto-connect after sign-in failed: ${err instanceof Error ? err.message : err}`)
          })
        }
        return token
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        if (error !== 'Sign-in cancelled') {
          emitAuth({ status: 'error', error })
        }
        throw err
      }
    },
    getStatus: async () => {
      const status = PlexAuthService.getStatus()
      if (status.status === 'authorized') {
        const cfg = ConfigService.get()
        return { ...status, serverName: cfg.plexServerName ?? '' }
      }
      return status
    },
    disconnect: async () => {
      PlexAuthService.cancel()
      await PlexAuthService.disconnect()
      emitAuth({ status: 'idle' })
    },
  },

  app: {
    getVersion: () => getAppVersion(),
    getEnv: (): AppEnv => ({
      packaged: !isContainerEnv() && !isWebMode(),
      container: isContainerEnv() || isWebMode(),
      web: isWebMode(),
      version: getAppVersion(),
      repoUrl: REPO_URL,
    }),
    openExternal: (url: string) => {
      if (isWebMode()) return
      // Only hand web links to the OS. Refusing other schemes (file:, custom
      // protocol handlers, etc.) stops a compromised renderer or a malicious
      // scraped link from launching arbitrary apps via the shell.
      let parsed: URL
      try { parsed = new URL(url) } catch { return }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
      const { shell } = require('electron') as typeof import('electron')
      void shell.openExternal(url)
    },
    checkUpdate: async (): Promise<UpdateInfo> => {
      if (!isContainerEnv() && !isWebMode()) {
        try {
          const { app } = require('electron') as typeof import('electron')
          const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
          const result = await autoUpdater.checkForUpdates()
          const info = result?.updateInfo
          const available = !!info?.version && isNewer(info.version, app.getVersion())
          const notes = typeof info?.releaseNotes === 'string' ? info.releaseNotes : undefined
          return { available, version: info?.version, releaseNotes: notes, mode: 'desktop' as const }
        } catch {
          return { available: false, mode: 'desktop' as const }
        }
      }
      const rel = await checkGithubRelease()
      const version = getAppVersion()
      if (rel?.version && isNewer(rel.version, version)) {
        return { available: true, version: rel.version, releaseNotes: rel.notes, releaseUrl: rel.url, mode: 'docker' as const }
      }
      return { available: false, mode: 'docker' as const }
    },
    installUpdate: () => {
      if (!isWebMode()) {
        const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
        autoUpdater.downloadUpdate()
      }
    },
    quitAndInstall: () => {
      if (!isWebMode()) {
        const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
        autoUpdater.quitAndInstall(true, true)
      }
    },
    openLogFolder: () => {
      if (isWebMode()) return ConfigService.getLogPath()
      const { shell } = require('electron') as typeof import('electron')
      return shell.openPath(ConfigService.getLogPath())
    },
  },

  scheduler: {
    list: () => SchedulerService.list(),
    save: (job: ScheduledJob) => SchedulerService.save(job),
    delete: (id: string) => SchedulerService.delete(id),
    runNow: (id: string) => SchedulerService.runNow(id),
    setAutoStart: (enable: boolean) => SchedulerService.setAutoStart(enable),
    getAutoStart: () => SchedulerService.getAutoStart(),
    engineStatus: () => SchedulerService.engineStatus(),
  },

  browser: {
    getStatus: () => PlaywrightService.getStatus(),
    install: async () => {
      await PlaywrightService.install()
      PlaywrightService.setupEnv()
    },
  },

  log: {
    getHistory: () => Logger.getHistory(),
    clear: () => Logger.clear(),
  },
}
