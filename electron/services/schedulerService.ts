import cron, { type ScheduledTask } from 'node-cron'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { ConfigService } from './config'
import { Logger } from './logger'
import { PlexService } from './plexService'
import { CreatorSetsService } from './creatorSetsService'
import { ScraperFactory } from '../scrapers/scraperFactory'
import type { AppliedRecord, CronPreview, JobProgress, JobRun, PosterInfo, ScheduledJob, SchedulerEngineStatus } from '../ipc/types'
import { getUserDataPath } from '../runtime/paths'
import { appEvents } from '../runtime/events'
import { isWebMode } from '../runtime/runtime'
import {
  addSlotCoverage, appliedUrlIndex, creatorOfUrl, describeRun, emptyTally, failedRun, finishRun, isSlotCovered,
  mediuxSetId, mergeAppliedRecords, normalizeJob, posterKind, posterSlot, previewCron, recordRun, recoverInterrupted,
  reorderJobs, slotCoverage, titleLabel, withNextRun, type RunTally, type SlotCoverage,
} from './scheduleUtils'

const ENGINE_FILE     = 'scheduler-engine.json'
const ENGINE_WRITE_MS = 30_000
const ENGINE_FRESH_MS = 90_000
const WATCH_MS        = 30_000
/** A scheduled run resyncs a cached creator catalog older than this before applying. */
const CATALOG_MAX_AGE_MS = 60_000
/** Progress updates reach the UI at most this often. */
const PROGRESS_EMIT_MS = 1_000

const tasks = new Map<string, ScheduledTask>()
const queue: Array<{ id: string; trigger: JobRun['trigger'] }> = []
const queued = new Set<string>()
const progress = new Map<string, JobProgress>()
let currentId: string | null = null
let draining = false
let lastProgressEmit = 0
let _win: BrowserWindow | null = null
let _isEngine = false
let _engineTimer: NodeJS.Timeout | null = null
let _watchTimer: NodeJS.Timeout | null = null
let _activeSignature = ''
let _lastSnapshot = ''

/** A Plex item or collection a scraped poster resolved to. */
interface ResolvedItem {
  key: string
  title: string
  year?: number
  type: 'movie' | 'show' | 'collection'
  libraryTitle: string
}

/** Where a poster came from, for history records and matching. */
interface PosterSource {
  setId?: string
  uploader?: string
  mediaType?: 'movie' | 'show'
}

/** State shared by every poster in one run. */
interface RunContext {
  job: ScheduledJob
  tally: RunTally
  /** Item key to image URLs already applied; null when the job re-applies everything. */
  applied: Map<string, Set<string>> | null
  /** Slot coverage for fill-gaps jobs; null otherwise. */
  coverage: SlotCoverage | null
  /** MediUX file types the user has enabled. */
  filters: Set<string>
  lookups: Map<string, Promise<ResolvedItem | null>>
  records: Map<string, AppliedRecord>
  mainThumb: Set<string>
}

/** Adds live queue and progress state to stored jobs for display. */
function decorate(jobs: ScheduledJob[]): ScheduledJob[] {
  return withNextRun(jobs, new Date()).map(job => {
    const out = { ...job }
    if (queued.has(job.id)) out.queued = true
    const p = progress.get(job.id)
    if (p) out.progress = p
    return out
  })
}

function emit(jobs: ScheduledJob[]) {
  _lastSnapshot = JSON.stringify(jobs)
  const payload = decorate(jobs)
  appEvents.emitEvent('scheduler:onChange', payload)
  _win?.webContents.send('scheduler:onChange', payload)
}

function enginePath(): string {
  return path.join(getUserDataPath(), ENGINE_FILE)
}

function cronSignature(jobs: ScheduledJob[]): string {
  return jobs.filter(j => j.enabled).map(j => `${j.id}@${j.cronExpr}`).sort().join('|')
}

function cleanupEngine() {
  if (_engineTimer) { clearInterval(_engineTimer); _engineTimer = null }
  try { fs.unlinkSync(enginePath()) } catch { /* already gone */ }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** Runs scheduled scrape-and-apply jobs via node-cron, one job at a time. */
export const SchedulerService = {
  init(win: BrowserWindow | null) {
    _win = win
    let jobs = this._stored()
    // A GUI deferring to a live 24/7 engine must not touch the engine's in-flight runs.
    if (!this.engineStatus().external) {
      const recovered = recoverInterrupted(jobs)
      if (recovered.changed) {
        jobs = recovered.jobs
        ConfigService.set({ scheduledJobs: jobs })
        Logger.warn('Scheduler', 'Marked jobs interrupted by the last shutdown')
      }
    }
    this._rescheduleAll(jobs)
    _lastSnapshot = JSON.stringify(jobs)
    this._startConfigWatcher()
    Logger.info('Scheduler', `Loaded ${jobs.length} job(s)`)
  },

  /** Jobs with their next firing time and live run state attached, for display. */
  list(): ScheduledJob[] {
    return decorate(this._stored())
  },

  /**
   * Validates and stores a job, generating its id when the client sent none.
   *
   * @param input - Job payload from the renderer or web API.
   * @returns The stored job with its next firing time.
   * @throws ScheduleValidationError when the payload is rejected.
   */
  save(input: ScheduledJob): ScheduledJob {
    const jobs = this._stored()
    const idx = typeof input?.id === 'string' ? jobs.findIndex(j => j.id === input.id) : -1
    const job = normalizeJob(input, idx >= 0 ? jobs[idx] : undefined, {
      makeId: randomUUID,
      isValidCron: expr => cron.validate(expr),
    })
    if (idx >= 0) jobs[idx] = job
    else jobs.push(job)
    ConfigService.set({ scheduledJobs: jobs })

    this._rescheduleAll(jobs)
    emit(jobs)
    return decorate([job])[0]
  },

  delete(id: string): void {
    const at = queue.findIndex(q => q.id === id)
    if (at >= 0) queue.splice(at, 1)
    queued.delete(id)
    const jobs = this._stored().filter(j => j.id !== id)
    ConfigService.set({ scheduledJobs: jobs })
    this._rescheduleAll(jobs)
    emit(jobs)
  },

  /**
   * Stores the jobs in a new order. Jobs due at the same time run in list
   * order, so this is also the run priority.
   *
   * @param ids - Job ids in the wanted order; unlisted jobs keep their place at the end.
   * @returns The reordered jobs.
   */
  reorder(ids: string[]): ScheduledJob[] {
    const jobs = reorderJobs(this._stored(), Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [])
    ConfigService.set({ scheduledJobs: jobs })
    this._rescheduleAll(jobs)
    emit(jobs)
    return decorate(jobs)
  },

  /**
   * Queues a job to run ahead of any scheduled runs waiting, without waiting
   * for it to finish; progress arrives through scheduler:onChange.
   *
   * @param id - Job id.
   * @throws Error when the job does not exist or is already running or queued.
   */
  runNow(id: string): void {
    const job = this._stored().find(j => j.id === id)
    if (!job) throw new Error('This job no longer exists')
    if (currentId === id) throw new Error(`"${job.name}" is already running`)
    if (queued.has(id)) throw new Error(`"${job.name}" is already queued`)
    this._enqueue(id, 'manual')
  },

  /**
   * Evaluates a cron expression in the scheduler's own time zone.
   *
   * @param expr - Cron expression.
   * @returns Validity, description, and upcoming firings.
   */
  preview(expr: string): CronPreview {
    const text = typeof expr === 'string' ? expr : ''
    const result = previewCron(text, new Date(), localTimeZone())
    if (result.valid && !cron.validate(text.trim())) {
      return { ...result, valid: false, error: `"${text.trim()}" is not a supported cron expression`, nextRuns: [] }
    }
    return result
  },

  setAutoStart(enable: boolean): void {
    if (isWebMode()) {
      Logger.info('Scheduler', `Auto-start not available in web mode (${enable ? 'requested' : 'disabled'})`)
      return
    }
    const { app } = require('electron') as typeof import('electron')
    app.setLoginItemSettings({ openAtLogin: enable })
    Logger.info('Scheduler', `Auto-start ${enable ? 'enabled' : 'disabled'}`)
  },

  getAutoStart(): boolean {
    if (isWebMode()) return false
    const { app } = require('electron') as typeof import('electron')
    return app.getLoginItemSettings().openAtLogin
  },

  startEngineHeartbeat(): void {
    _isEngine = true
    const write = () => {
      try {
        fs.writeFileSync(enginePath(), JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString() }))
      } catch (err) {
        Logger.warn('Scheduler', `Could not write engine heartbeat: ${errorText(err)}`)
      }
    }
    write()
    _engineTimer = setInterval(write, ENGINE_WRITE_MS)

    if (isWebMode()) {
      process.once('SIGTERM', cleanupEngine)
      process.once('SIGINT', cleanupEngine)
    } else {
      const { app } = require('electron') as typeof import('electron')
      app.once('will-quit', cleanupEngine)
      process.once('SIGTERM', () => { cleanupEngine(); app.quit() })
      process.once('SIGINT',  () => { cleanupEngine(); app.quit() })
    }
    Logger.info('Scheduler', 'Running as the 24/7 engine - GUI instances on this config will defer to it')
  },

  engineStatus(): SchedulerEngineStatus {
    if (_isEngine) return { external: false }
    try {
      const raw = JSON.parse(fs.readFileSync(enginePath(), 'utf8')) as { updatedAt?: string }
      const ts = Date.parse(raw.updatedAt ?? '')
      if (!Number.isNaN(ts) && Date.now() - ts < ENGINE_FRESH_MS) {
        return { external: true, updatedAt: raw.updatedAt }
      }
    } catch { /* no heartbeat */ }
    return { external: false }
  },

  /** Jobs exactly as stored in config, without computed fields. */
  _stored(): ScheduledJob[] {
    return ConfigService.get().scheduledJobs ?? []
  },

  _startConfigWatcher(): void {
    if (_watchTimer) return
    _watchTimer = setInterval(() => {
      try {
        const jobs = this._stored()
        if (cronSignature(jobs) !== _activeSignature) {
          this._rescheduleAll(jobs)
          Logger.info('Scheduler', 'Schedules changed on disk - reloaded')
        }
        const snap = JSON.stringify(jobs)
        if (snap !== _lastSnapshot) emit(jobs)
      } catch { /* config mid-write */ }
    }, WATCH_MS)
  },

  _rescheduleAll(jobs: ScheduledJob[]): void {
    for (const t of tasks.values()) t.stop()
    tasks.clear()
    for (const job of jobs) {
      if (job.enabled) this._schedule(job)
    }
    _activeSignature = cronSignature(jobs)
  },

  _schedule(job: ScheduledJob): void {
    if (!cron.validate(job.cronExpr)) {
      Logger.warn('Scheduler', `Invalid cron for "${job.name}": ${job.cronExpr}`)
      return
    }
    const task = cron.schedule(job.cronExpr, () => {
      const fresh = this._stored().find(j => j.id === job.id)
      if (!fresh?.enabled) return
      if (this.engineStatus().external) {
        Logger.info('Scheduler', `"${fresh.name}" is handled by the 24/7 engine - skipping local run`)
        return
      }
      if (currentId === fresh.id || queued.has(fresh.id)) {
        Logger.info('Scheduler', `"${fresh.name}" is still running or waiting from its previous trigger - skipping this one`)
        return
      }
      this._enqueue(fresh.id, 'schedule')
    })
    tasks.set(job.id, task)
    Logger.info('Scheduler', `Scheduled "${job.name}" [${job.cronExpr}]`)
  },

  /** Adds a run to the queue; manual runs go ahead of waiting scheduled runs. */
  _enqueue(id: string, trigger: JobRun['trigger']): void {
    queued.add(id)
    if (trigger === 'manual') queue.unshift({ id, trigger })
    else queue.push({ id, trigger })
    emit(this._stored())
    void this._drain()
  },

  /** Works through the queue one job at a time. */
  async _drain(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (queue.length) {
        const next = queue.shift()!
        queued.delete(next.id)
        // The job may have been deleted or edited while it waited.
        const job = this._stored().find(j => j.id === next.id)
        if (!job) continue
        await this._execute(job, next.trigger)
      }
    } finally {
      draining = false
    }
  },

  _updateStatus(id: string, patch: Partial<ScheduledJob>): void {
    const jobs = this._stored()
    const idx = jobs.findIndex(j => j.id === id)
    if (idx < 0) return
    jobs[idx] = { ...jobs[idx], ...patch }
    ConfigService.set({ scheduledJobs: jobs })
    emit(jobs)
  },

  /** Clears the run's live state, then stores its result. */
  _finishRun(id: string, run: JobRun): void {
    progress.delete(id)
    if (currentId === id) currentId = null
    const jobs = this._stored()
    const idx = jobs.findIndex(j => j.id === id)
    if (idx >= 0) {
      jobs[idx] = recordRun(jobs[idx], run)
      ConfigService.set({ scheduledJobs: jobs })
    }
    emit(jobs)
  },

  _setProgress(id: string, next: JobProgress, force = false): void {
    progress.set(id, next)
    const now = Date.now()
    if (!force && now - lastProgressEmit < PROGRESS_EMIT_MS) return
    lastProgressEmit = now
    emit(this._stored())
  },

  /** Reconnects to Plex from saved config when the connection was lost. */
  async _ensurePlex(): Promise<void> {
    if (PlexService.getConnection()) return
    const restored = await PlexService.tryRestoreFromConfig()
    if (restored.success) return
    throw new Error(restored.tokenInvalid
      ? 'Plex sign-in expired - sign in again from Settings'
      : 'Not connected to Plex - check that the server is reachable and you are signed in')
  },

  /** Finds a poster's Plex target, sharing lookups across a run's posters for the same title. */
  _resolveItem(poster: PosterInfo, cache: Map<string, Promise<ResolvedItem | null>>, mediaType?: 'movie' | 'show'): Promise<ResolvedItem | null> {
    const cacheKey = poster.isCollection
      ? `collection|${poster.title.toLowerCase()}`
      : `item|${poster.title.toLowerCase()}|${poster.year ?? ''}|${poster.tmdbId ?? ''}|${mediaType ?? ''}`
    let pending = cache.get(cacheKey)
    if (!pending) {
      const label = titleLabel(poster.title, poster.year)
      pending = (async (): Promise<ResolvedItem | null> => {
        if (poster.isCollection) {
          const coll = await PlexService.findCollection({ title: poster.title })
          Logger.scrape('Scheduler', coll ? `Collection "${label}" matched Plex "${coll.title}" (key ${coll.key})` : `Collection "${label}" is not in the library`)
          return coll ? { key: coll.key, title: coll.title, type: 'collection', libraryTitle: coll.libraryTitle } : null
        }
        const item = await PlexService.findInLibrary({
          title: poster.title,
          year: poster.year,
          libraries: [],
          tmdbId: poster.tmdbId,
          type: mediaType,
        })
        // The log is the place to see which Plex entry a set landed on when a
        // library holds several near-identical titles.
        Logger.scrape('Scheduler', item
          ? `"${label}" matched Plex "${item.title}" (${item.year ?? 'no year'}, key ${item.key}, ${item.libraryTitle})`
          : `"${label}" is not in the library`)
        if (!item) return null
        return { key: item.key, title: item.title, year: item.year, type: item.type === 'movie' ? 'movie' : 'show', libraryTitle: item.libraryTitle }
      })()
      cache.set(cacheKey, pending)
    }
    return pending
  },

  /** Matches one poster to Plex and uploads it unless the job's rules skip it. */
  async _applyPoster(ctx: RunContext, poster: PosterInfo, source: PosterSource): Promise<void> {
    const { tally } = ctx
    const label = titleLabel(poster.title, poster.year)
    try {
      const target = await this._resolveItem(poster, ctx.lookups, source.mediaType)
      if (!target) {
        tally.unmatchedTitles.add(label)
        return
      }
      const targetLabel = titleLabel(target.title, target.year)
      if (ctx.applied?.get(target.key)?.has(poster.url)) {
        tally.skipped++
        return
      }
      const slot = posterSlot(poster)
      if (ctx.coverage && isSlotCovered(ctx.coverage, target.key, slot, source.setId)) {
        tally.covered++
        tally.coveredTitles.set(targetLabel, (tally.coveredTitles.get(targetLabel) ?? 0) + 1)
        return
      }

      const res = await PlexService.uploadPoster({
        itemKey: target.key,
        imageUrl: poster.url,
        source: poster.source,
        season: poster.season,
        episode: poster.episode,
        isCollection: poster.isCollection,
      })
      if (res.skipped) {
        // The matched item has no such season or episode. Counted rather than
        // dropped: a whole set landing here usually means a lookalike title.
        tally.noTarget++
        tally.noTargetTitles.set(targetLabel, (tally.noTargetTitles.get(targetLabel) ?? 0) + 1)
        return
      }
      if (!res.success) {
        tally.failed++
        tally.firstError ??= res.error
        if (!tally.failedTitles.has(targetLabel)) tally.failedTitles.set(targetLabel, res.error ?? 'Upload failed')
        return
      }

      tally.uploaded++
      tally.appliedTitles.set(targetLabel, (tally.appliedTitles.get(targetLabel) ?? 0) + 1)
      if (ctx.coverage) addSlotCoverage(ctx.coverage, target.key, slot, source.setId)

      const recKey = `${target.key}|${source.setId ?? ''}`
      const isMain = poster.season == null && poster.episode == null
      const thumb = poster.thumbUrl ?? poster.url
      const rec = ctx.records.get(recKey)
      if (rec) {
        rec.posterUrls = [...(rec.posterUrls ?? []), poster.url]
        rec.slots = [...(rec.slots ?? []), slot]
        if (isMain && !ctx.mainThumb.has(recKey)) { rec.thumb = thumb; ctx.mainThumb.add(recKey) }
      } else {
        ctx.records.set(recKey, {
          itemKey: target.key, title: target.title, year: target.year, type: target.type,
          source: poster.source, libraryTitle: target.libraryTitle, thumb, setId: source.setId, uploader: source.uploader,
          posterUrls: [poster.url], slots: [slot], appliedAt: new Date().toISOString(),
        })
        if (isMain) ctx.mainThumb.add(recKey)
      }
    } catch (err) {
      tally.failed++
      tally.firstError ??= errorText(err)
      if (!tally.failedTitles.has(label)) tally.failedTitles.set(label, errorText(err))
    }
  },

  /** Applies every set in a creator's catalog, reading it through the creator cache. */
  async _syncCreator(ctx: RunContext, creator: string, url: string): Promise<void> {
    const { job, tally } = ctx
    const reading = (collected: number) => this._setProgress(job.id, { phase: 'reading', done: collected, total: 0, current: `@${creator}` })
    this._setProgress(job.id, { phase: 'reading', done: 0, total: 0, current: `@${creator}` }, true)
    const off = appEvents.onEvent('library:userSetsChunk', chunk => {
      if (chunk.username.toLowerCase() === creator) reading(chunk.collected)
    })

    let sets
    try {
      const catalog = await CreatorSetsService.catalog(creator, CATALOG_MAX_AGE_MS)
      sets = catalog.sets
      if (catalog.capped) Logger.warn('Scheduler', `@${creator} has more sets than one crawl reads; the newest ${sets.length} were used`)
    } catch (err) {
      tally.urlErrors++
      tally.firstError ??= `${url}: ${errorText(err)}`
      Logger.warn('Scheduler', `Creator sync failed in job "${job.name}": ${errorText(err)}`)
      return
    } finally {
      off()
    }

    Logger.info('Scheduler', `@${creator}: ${sets.length} set(s) to check for "${job.name}"`)
    for (let i = 0; i < sets.length; i++) {
      const set = sets[i]
      const current = titleLabel(set.title, set.year)
      const posters = set.posters.filter(p => ctx.filters.has(posterKind(p)))
      for (let j = 0; j < posters.length; j++) {
        const poster = posters[j]
        this._setProgress(job.id, { phase: 'applying', done: i, total: sets.length, current, poster: { done: j, total: posters.length } })
        await this._applyPoster(ctx, poster, { setId: set.id, uploader: set.uploader, mediaType: set.mediaType })
      }
    }
  },

  /** Scrapes one set, show, or boxset URL and applies what it finds. */
  async _syncUrl(ctx: RunContext, url: string, base: JobProgress): Promise<void> {
    const { job, tally } = ctx
    let scrapeError: string | undefined
    const posters = await ScraperFactory.scrapeUrl(url, p => {
      if (p.status === 'error') scrapeError = p.error ?? 'Scrape failed'
    })
    if (scrapeError && !posters.length) {
      tally.urlErrors++
      tally.firstError ??= `${url}: ${scrapeError}`
      Logger.warn('Scheduler', `URL failed in job "${job.name}": ${scrapeError}`)
      return
    }
    const source: PosterSource = { setId: mediuxSetId(url) ?? undefined, uploader: job.creator }
    for (let j = 0; j < posters.length; j++) {
      this._setProgress(job.id, { ...base, poster: { done: j, total: posters.length } })
      await this._applyPoster(ctx, posters[j], source)
    }
  },

  async _execute(job: ScheduledJob, trigger: JobRun['trigger']): Promise<void> {
    if (currentId === job.id) return
    currentId = job.id
    const startedAt = new Date()
    Logger.session('Scheduler', `Running job "${job.name}"`)
    this._updateStatus(job.id, { lastRun: startedAt.toISOString(), lastStatus: 'running' })

    try {
      await this._ensurePlex()
      const cfg = ConfigService.get()
      const history = cfg.appliedPosters ?? []
      const ctx: RunContext = {
        job,
        tally: emptyTally(job.urls.length),
        applied: job.skipApplied === false ? null : appliedUrlIndex(history),
        coverage: job.fillGaps ? slotCoverage(history) : null,
        filters: new Set(cfg.mediuxFilters ?? ['poster', 'backdrop', 'title_card']),
        lookups: new Map(),
        records: new Map(),
        mainThumb: new Set(),
      }

      for (let i = 0; i < job.urls.length; i++) {
        const url = job.urls[i]
        const creator = creatorOfUrl(url)
        if (creator) {
          await this._syncCreator(ctx, creator, url)
        } else {
          const base: JobProgress = { phase: 'applying', done: i, total: job.urls.length, current: url }
          this._setProgress(job.id, base, true)
          await this._syncUrl(ctx, url, base)
        }
      }

      ctx.tally.unmatched = ctx.tally.unmatchedTitles.size
      if (ctx.records.size) {
        const existing = ConfigService.get().appliedPosters ?? []
        ConfigService.set({ appliedPosters: mergeAppliedRecords(existing, [...ctx.records.values()]) })
      }

      const run = finishRun(ctx.tally, startedAt, new Date(), trigger)
      const summary = describeRun(run)
      if (run.status === 'success') Logger.success('Scheduler', `Job "${job.name}" done - ${summary}`)
      else Logger.warn('Scheduler', `Job "${job.name}" finished with problems - ${summary}`)
      this._finishRun(job.id, run)
    } catch (err) {
      const msg = errorText(err)
      Logger.error('Scheduler', `Job "${job.name}" failed: ${msg}`)
      this._finishRun(job.id, failedRun(msg, startedAt, new Date(), trigger))
    } finally {
      progress.delete(job.id)
      if (currentId === job.id) currentId = null
    }
  },
}
