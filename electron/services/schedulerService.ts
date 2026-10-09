import cron, { type ScheduledTask } from 'node-cron'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { ConfigService } from './config'
import { Logger } from './logger'
import { PlexService } from './plexService'
import { ScraperFactory } from '../scrapers/scraperFactory'
import type { AppliedRecord, CronPreview, JobRun, PosterInfo, ScheduledJob, SchedulerEngineStatus } from '../ipc/types'
import { getUserDataPath } from '../runtime/paths'
import { appEvents } from '../runtime/events'
import { isWebMode } from '../runtime/runtime'
import {
  appliedUrlIndex, creatorOfUrl, describeRun, emptyTally, failedRun, finishRun, mediuxSetId,
  mergeAppliedRecords, normalizeJob, previewCron, recordRun, recoverInterrupted, withNextRun,
} from './scheduleUtils'

const ENGINE_FILE     = 'scheduler-engine.json'
const ENGINE_WRITE_MS = 30_000
const ENGINE_FRESH_MS = 90_000
const WATCH_MS        = 30_000

const tasks = new Map<string, ScheduledTask>()
const running = new Set<string>()
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

function emit(jobs: ScheduledJob[]) {
  _lastSnapshot = JSON.stringify(jobs)
  const payload = withNextRun(jobs, new Date())
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

/** Runs scheduled scrape-and-apply jobs via node-cron. */
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

  /** Jobs with their next firing time attached, for display. */
  list(): ScheduledJob[] {
    return withNextRun(this._stored(), new Date())
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
    return withNextRun([job], new Date())[0]
  },

  delete(id: string): void {
    const jobs = this._stored().filter(j => j.id !== id)
    ConfigService.set({ scheduledJobs: jobs })
    this._rescheduleAll(jobs)
    emit(jobs)
  },

  /**
   * Starts a job immediately without waiting for it to finish; progress
   * arrives through scheduler:onChange.
   *
   * @param id - Job id.
   * @throws Error when the job does not exist or is already running.
   */
  runNow(id: string): void {
    const job = this._stored().find(j => j.id === id)
    if (!job) throw new Error('This job no longer exists')
    if (running.has(id)) throw new Error(`"${job.name}" is already running`)
    void this._execute(job, 'manual')
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
      if (running.has(fresh.id)) {
        Logger.info('Scheduler', `"${fresh.name}" is still running from its previous trigger - skipping this one`)
        return
      }
      void this._execute(fresh, 'schedule')
    })
    tasks.set(job.id, task)
    Logger.info('Scheduler', `Scheduled "${job.name}" [${job.cronExpr}]`)
  },

  _updateStatus(id: string, patch: Partial<ScheduledJob>): void {
    const jobs = this._stored()
    const idx = jobs.findIndex(j => j.id === id)
    if (idx < 0) return
    jobs[idx] = { ...jobs[idx], ...patch }
    ConfigService.set({ scheduledJobs: jobs })
    emit(jobs)
  },

  _recordRun(id: string, run: JobRun): void {
    const jobs = this._stored()
    const idx = jobs.findIndex(j => j.id === id)
    if (idx < 0) return
    jobs[idx] = recordRun(jobs[idx], run)
    ConfigService.set({ scheduledJobs: jobs })
    emit(jobs)
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
  _resolveItem(poster: PosterInfo, cache: Map<string, Promise<ResolvedItem | null>>): Promise<ResolvedItem | null> {
    const cacheKey = poster.isCollection
      ? `collection|${poster.title.toLowerCase()}`
      : `item|${poster.title.toLowerCase()}|${poster.year ?? ''}|${poster.tmdbId ?? ''}`
    let pending = cache.get(cacheKey)
    if (!pending) {
      pending = (async (): Promise<ResolvedItem | null> => {
        if (poster.isCollection) {
          const coll = await PlexService.findCollection({ title: poster.title })
          return coll ? { key: coll.key, title: coll.title, type: 'collection', libraryTitle: coll.libraryTitle } : null
        }
        const item = await PlexService.findInLibrary({
          title: poster.title,
          year: poster.year,
          libraries: [],
          tmdbId: poster.tmdbId,
        })
        if (!item) return null
        return { key: item.key, title: item.title, year: item.year, type: item.type === 'movie' ? 'movie' : 'show', libraryTitle: item.libraryTitle }
      })()
      cache.set(cacheKey, pending)
    }
    return pending
  },

  async _execute(job: ScheduledJob, trigger: JobRun['trigger']): Promise<void> {
    if (running.has(job.id)) return
    running.add(job.id)
    const startedAt = new Date()
    Logger.session('Scheduler', `Running job "${job.name}"`)
    this._updateStatus(job.id, { lastRun: startedAt.toISOString(), lastStatus: 'running' })

    try {
      await this._ensurePlex()
      const applied = job.skipApplied === false ? null : appliedUrlIndex(ConfigService.get().appliedPosters ?? [])
      const tally = emptyTally(job.urls.length)
      const unmatched = new Set<string>()
      const lookups = new Map<string, Promise<ResolvedItem | null>>()
      const records = new Map<string, AppliedRecord>()
      const mainThumb = new Set<string>()

      for (const url of job.urls) {
        let scrapeError: string | undefined
        const posters = await ScraperFactory.scrapeUrl(url, p => {
          if (p.status === 'error') scrapeError = p.error ?? 'Scrape failed'
        })
        if (scrapeError && !posters.length) {
          tally.urlErrors++
          tally.firstError ??= `${url}: ${scrapeError}`
          Logger.warn('Scheduler', `URL failed in job "${job.name}": ${scrapeError}`)
          continue
        }

        const setId = mediuxSetId(url) ?? undefined
        const uploader = job.creator ?? creatorOfUrl(url) ?? undefined
        for (const poster of posters) {
          try {
            const target = await this._resolveItem(poster, lookups)
            if (!target) {
              unmatched.add(`${poster.isCollection ? 'c' : 'i'}|${poster.title.toLowerCase()}|${poster.year ?? ''}`)
              continue
            }
            if (applied?.get(target.key)?.has(poster.url)) {
              tally.skipped++
              continue
            }

            const res = await PlexService.uploadPoster({
              itemKey: target.key,
              imageUrl: poster.url,
              source: poster.source,
              season: poster.season,
              episode: poster.episode,
              isCollection: poster.isCollection,
            })
            if (res.skipped) continue
            if (!res.success) {
              tally.failed++
              tally.firstError ??= res.error
              continue
            }

            tally.uploaded++
            const recKey = `${target.key}|${setId ?? ''}`
            const isMain = poster.season == null && poster.episode == null
            const thumb = poster.thumbUrl ?? poster.url
            const rec = records.get(recKey)
            if (rec) {
              rec.posterUrls = [...(rec.posterUrls ?? []), poster.url]
              if (isMain && !mainThumb.has(recKey)) { rec.thumb = thumb; mainThumb.add(recKey) }
            } else {
              records.set(recKey, {
                itemKey: target.key, title: target.title, year: target.year, type: target.type,
                source: poster.source, libraryTitle: target.libraryTitle, thumb, setId, uploader,
                posterUrls: [poster.url], appliedAt: new Date().toISOString(),
              })
              if (isMain) mainThumb.add(recKey)
            }
          } catch (err) {
            tally.failed++
            tally.firstError ??= errorText(err)
          }
        }
      }

      tally.unmatched = unmatched.size
      if (records.size) {
        const existing = ConfigService.get().appliedPosters ?? []
        ConfigService.set({ appliedPosters: mergeAppliedRecords(existing, [...records.values()]) })
      }

      const run = finishRun(tally, startedAt, new Date(), trigger)
      const summary = describeRun(run)
      if (run.status === 'success') Logger.success('Scheduler', `Job "${job.name}" done - ${summary}`)
      else Logger.warn('Scheduler', `Job "${job.name}" finished with problems - ${summary}`)
      this._recordRun(job.id, run)
    } catch (err) {
      const msg = errorText(err)
      Logger.error('Scheduler', `Job "${job.name}" failed: ${msg}`)
      this._recordRun(job.id, failedRun(msg, startedAt, new Date(), trigger))
    } finally {
      running.delete(job.id)
    }
  },
}
