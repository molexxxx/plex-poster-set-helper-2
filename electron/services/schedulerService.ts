import cron, { type ScheduledTask } from 'node-cron'
import fs from 'fs'
import path from 'path'
import { app, type BrowserWindow } from 'electron'
import { ConfigService } from './config'
import { Logger } from './logger'
import { PlexService } from './plexService'
import { ScraperFactory } from '../scrapers/scraperFactory'
import type { ScheduledJob, SchedulerEngineStatus } from '../ipc/types'

/*
 * Engine coordination: the GUI and the headless container can share one config
 * volume. To keep a job from running twice, the headless process acts as the
 * "engine": it writes a heartbeat file next to the config, and any GUI instance
 * that sees a fresh heartbeat stands down from cron firing (manual Run-now
 * still works locally). On desktop installs the file never exists, so
 * behaviour is unchanged.
 */

const ENGINE_FILE     = 'scheduler-engine.json'
const ENGINE_WRITE_MS = 30_000
const ENGINE_FRESH_MS = 90_000
const WATCH_MS        = 30_000

const tasks = new Map<string, ScheduledTask>()
let _win: BrowserWindow | null = null
let _isEngine = false
let _engineTimer: NodeJS.Timeout | null = null
let _watchTimer: NodeJS.Timeout | null = null
let _activeSignature = ''
let _lastSnapshot = ''

function emit(jobs: ScheduledJob[]) {
  _lastSnapshot = JSON.stringify(jobs)
  _win?.webContents.send('scheduler:onChange', jobs)
}

function enginePath(): string {
  return path.join(app.getPath('userData'), ENGINE_FILE)
}

/**
 * Builds a signature from only the parts that affect cron registration -
 * status fields (lastRun etc.) change on every run and must not trigger a
 * reschedule.
 *
 * @param jobs - The full job list.
 * @returns A stable string over the enabled jobs' ids and cron expressions.
 */
function cronSignature(jobs: ScheduledJob[]): string {
  return jobs.filter(j => j.enabled).map(j => `${j.id}@${j.cronExpr}`).sort().join('|')
}

/** Runs scheduled scrape-and-apply jobs via node-cron, coordinating with a headless engine when present. */
export const SchedulerService = {
  /**
   * Loads saved jobs, registers their cron tasks, and starts the cross-process
   * config watcher.
   *
   * @param win - Window that receives scheduler:onChange events, or null when headless.
   */
  init(win: BrowserWindow | null) {
    _win = win
    const jobs = ConfigService.get().scheduledJobs ?? []
    this._rescheduleAll(jobs)
    _lastSnapshot = JSON.stringify(jobs)
    this._startConfigWatcher()
    Logger.info('Scheduler', `Loaded ${jobs.length} job(s)`)
  },

  /**
   * Returns the saved jobs from config.
   *
   * @returns The job list, possibly empty.
   */
  list(): ScheduledJob[] {
    return ConfigService.get().scheduledJobs ?? []
  },

  /**
   * Creates or updates a job, then reschedules all cron tasks.
   *
   * @param job - Job to upsert, matched by id.
   * @returns The saved job.
   */
  save(job: ScheduledJob): ScheduledJob {
    const jobs = this.list()
    const idx = jobs.findIndex(j => j.id === job.id)
    if (idx >= 0) jobs[idx] = job
    else jobs.push(job)
    ConfigService.set({ scheduledJobs: jobs })

    this._rescheduleAll(jobs)
    emit(jobs)
    return job
  },

  /**
   * Deletes a job and reschedules the remainder.
   *
   * @param id - Id of the job to remove.
   */
  delete(id: string): void {
    const jobs = this.list().filter(j => j.id !== id)
    ConfigService.set({ scheduledJobs: jobs })
    this._rescheduleAll(jobs)
    emit(jobs)
  },

  /**
   * Executes a job immediately, regardless of its schedule.
   *
   * @param id - Id of the job to run; throws when unknown.
   */
  async runNow(id: string): Promise<void> {
    const job = this.list().find(j => j.id === id)
    if (!job) throw new Error(`Job "${id}" not found`)
    await this._execute(job)
  },

  /**
   * Toggles launching the app at OS login.
   *
   * @param enable - Whether to open at login.
   */
  setAutoStart(enable: boolean): void {
    const { app } = require('electron') as typeof import('electron')
    app.setLoginItemSettings({ openAtLogin: enable })
    Logger.info('Scheduler', `Auto-start ${enable ? 'enabled' : 'disabled'}`)
  },

  /**
   * Returns whether the app launches at OS login.
   *
   * @returns The current login-item setting.
   */
  getAutoStart(): boolean {
    const { app } = require('electron') as typeof import('electron')
    return app.getLoginItemSettings().openAtLogin
  },

  /**
   * Claims the engine role. Headless containers call this once at boot so GUI
   * instances sharing the same config volume stop firing jobs themselves.
   */
  startEngineHeartbeat(): void {
    _isEngine = true
    const write = () => {
      try {
        fs.writeFileSync(enginePath(), JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString() }))
      } catch (err) {
        Logger.warn('Scheduler', `Could not write engine heartbeat: ${err instanceof Error ? err.message : err}`)
      }
    }
    write()
    _engineTimer = setInterval(write, ENGINE_WRITE_MS)

    const cleanup = () => {
      if (_engineTimer) { clearInterval(_engineTimer); _engineTimer = null }
      try { fs.unlinkSync(enginePath()) } catch { /* already gone */ }
    }
    app.once('will-quit', cleanup)
    process.once('SIGTERM', () => { cleanup(); app.quit() })
    process.once('SIGINT',  () => { cleanup(); app.quit() })
    Logger.info('Scheduler', 'Running as the 24/7 engine - GUI instances on this config will defer to it')
  },

  /**
   * Reports whether an external engine owns this config's jobs.
   *
   * @returns external: true with the heartbeat timestamp when a fresh
   *   heartbeat file exists and this process isn't the engine.
   */
  engineStatus(): SchedulerEngineStatus {
    if (_isEngine) return { external: false }
    try {
      const raw = JSON.parse(fs.readFileSync(enginePath(), 'utf8')) as { updatedAt?: string }
      const ts = Date.parse(raw.updatedAt ?? '')
      if (!Number.isNaN(ts) && Date.now() - ts < ENGINE_FRESH_MS) {
        return { external: true, updatedAt: raw.updatedAt }
      }
    } catch { /* no heartbeat - no engine */ }
    return { external: false }
  },

  /**
   * Polls the config for changes made by the other process (GUI edits picked
   * up by the engine, engine run-statuses reflected in the GUI). conf re-reads
   * the file on every access, so this sees cross-process writes.
   */
  _startConfigWatcher(): void {
    if (_watchTimer) return
    _watchTimer = setInterval(() => {
      try {
        const jobs = ConfigService.get().scheduledJobs ?? []
        if (cronSignature(jobs) !== _activeSignature) {
          this._rescheduleAll(jobs)
          Logger.info('Scheduler', 'Schedules changed on disk - reloaded')
        }
        const snap = JSON.stringify(jobs)
        if (snap !== _lastSnapshot) emit(jobs)
      } catch { /* config mid-write; next tick catches up */ }
    }, WATCH_MS)
  },

  /**
   * Stops all cron tasks and re-registers the enabled jobs.
   *
   * @param jobs - The full job list to schedule from.
   */
  _rescheduleAll(jobs: ScheduledJob[]): void {
    for (const t of tasks.values()) t.stop()
    tasks.clear()
    for (const job of jobs) {
      if (job.enabled) this._schedule(job)
    }
    _activeSignature = cronSignature(jobs)
  },

  /**
   * Registers a single job's cron task.
   *
   * @param job - Job whose cronExpr is validated and scheduled.
   */
  _schedule(job: ScheduledJob): void {
    if (!cron.validate(job.cronExpr)) {
      Logger.warn('Scheduler', `Invalid cron for "${job.name}": ${job.cronExpr}`)
      return
    }
    const task = cron.schedule(job.cronExpr, () => {
      // Re-read at fire time: the job may have been edited (possibly from the
      // other container) since this task was registered.
      const fresh = this.list().find(j => j.id === job.id)
      if (!fresh?.enabled) return
      if (this.engineStatus().external) {
        Logger.info('Scheduler', `"${fresh.name}" is handled by the 24/7 engine - skipping local run`)
        return
      }
      void this._execute(fresh)
    })
    tasks.set(job.id, task)
    Logger.info('Scheduler', `Scheduled "${job.name}" [${job.cronExpr}]`)
  },

  /**
   * Patches a job's status fields in config and notifies the renderer.
   *
   * @param id - Id of the job to update.
   * @param patch - Fields to merge into the stored job.
   */
  _updateStatus(id: string, patch: Partial<ScheduledJob>): void {
    const jobs = this.list()
    const idx = jobs.findIndex(j => j.id === id)
    if (idx < 0) return
    jobs[idx] = { ...jobs[idx], ...patch }
    ConfigService.set({ scheduledJobs: jobs })
    emit(jobs)
  },

  /**
   * Scrapes each of the job's URLs and applies the resulting posters to
   * matching library items, recording results into the applied history.
   *
   * @param job - Job to execute.
   */
  async _execute(job: ScheduledJob): Promise<void> {
    Logger.session('Scheduler', `Running job "${job.name}"`)
    this._updateStatus(job.id, { lastRun: new Date().toISOString(), lastStatus: 'running' })

    try {
      let uploaded = 0
      let errors = 0
      const appliedItems = new Map<string, { key: string; title: string; year?: number; type: 'movie' | 'show'; libraryTitle: string; source: 'mediux' | 'posterdb' }>()

      for (const url of job.urls) {
        try {
          const posters = await ScraperFactory.scrapeUrl(url, () => {})
          for (const poster of posters) {
            try {
              const item = await PlexService.findInLibrary({
                title: poster.title,
                year: poster.year,
                libraries: [],
                tmdbId: poster.tmdbId,
              })
              if (!item) continue
              const res = await PlexService.uploadPoster({
                itemKey: item.key,
                imageUrl: poster.url,
                source: poster.source,
                season: poster.season,
                episode: poster.episode,
              })
              if (res.success) {
                uploaded++
                appliedItems.set(item.key, {
                  key: item.key, title: item.title, year: item.year,
                  type: item.type === 'movie' ? 'movie' : 'show',
                  libraryTitle: item.libraryTitle, source: poster.source,
                })
              }
            } catch { errors++ }
          }
        } catch (err) {
          errors++
          Logger.warn('Scheduler', `URL failed in job "${job.name}": ${err instanceof Error ? err.message : err}`)
        }
      }

      // Record into the local applied history (drives Reset Posters tracking)
      if (appliedItems.size) {
        const existing = ConfigService.get().appliedPosters ?? []
        const now = new Date().toISOString()
        const fresh = [...appliedItems.values()].map(i => ({
          itemKey: i.key, title: i.title, year: i.year, type: i.type,
          source: i.source, libraryTitle: i.libraryTitle, appliedAt: now,
        }))
        const keys = new Set(fresh.map(f => f.itemKey))
        ConfigService.set({ appliedPosters: [...fresh, ...existing.filter(r => !keys.has(r.itemKey))].slice(0, 2000) })
      }

      const summary = `${uploaded} poster${uploaded !== 1 ? 's' : ''} uploaded` + (errors ? `, ${errors} error${errors !== 1 ? 's' : ''}` : '')
      Logger.success('Scheduler', `Job "${job.name}" done - ${summary}`)
      this._updateStatus(job.id, { lastStatus: 'success', lastError: undefined })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      Logger.error('Scheduler', `Job "${job.name}" failed: ${msg}`)
      this._updateStatus(job.id, { lastStatus: 'error', lastError: msg })
    }
  },
}
