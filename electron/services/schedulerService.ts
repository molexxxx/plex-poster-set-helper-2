import cron, { type ScheduledTask } from 'node-cron'
import type { BrowserWindow } from 'electron'
import { ConfigService } from './config'
import { Logger } from './logger'
import { PlexService } from './plexService'
import { ScraperFactory } from '../scrapers/scraperFactory'
import type { ScheduledJob } from '../ipc/types'

// --- Internal state -----------------------------------------------------------

const tasks = new Map<string, ScheduledTask>()
let _win: BrowserWindow | null = null

function emit(jobs: ScheduledJob[]) {
  _win?.webContents.send('scheduler:onChange', jobs)
}

// --- Service ------------------------------------------------------------------

export const SchedulerService = {
  init(win: BrowserWindow | null) {
    _win = win
    const jobs = ConfigService.get().scheduledJobs ?? []
    for (const job of jobs) {
      if (job.enabled) this._schedule(job)
    }
    Logger.info('Scheduler', `Loaded ${jobs.length} job(s)`)
  },

  list(): ScheduledJob[] {
    return ConfigService.get().scheduledJobs ?? []
  },

  save(job: ScheduledJob): ScheduledJob {
    const jobs = this.list()
    const idx = jobs.findIndex(j => j.id === job.id)
    if (idx >= 0) jobs[idx] = job
    else jobs.push(job)
    ConfigService.set({ scheduledJobs: jobs })

    this._unschedule(job.id)
    if (job.enabled && cron.validate(job.cronExpr)) this._schedule(job)

    emit(jobs)
    return job
  },

  delete(id: string): void {
    this._unschedule(id)
    const jobs = this.list().filter(j => j.id !== id)
    ConfigService.set({ scheduledJobs: jobs })
    emit(jobs)
  },

  async runNow(id: string): Promise<void> {
    const job = this.list().find(j => j.id === id)
    if (!job) throw new Error(`Job "${id}" not found`)
    await this._execute(job)
  },

  setAutoStart(enable: boolean): void {
    const { app } = require('electron') as typeof import('electron')
    app.setLoginItemSettings({ openAtLogin: enable })
    Logger.info('Scheduler', `Auto-start ${enable ? 'enabled' : 'disabled'}`)
  },

  getAutoStart(): boolean {
    const { app } = require('electron') as typeof import('electron')
    return app.getLoginItemSettings().openAtLogin
  },

  // -- Private ------------------------------------------------------------------

  _schedule(job: ScheduledJob): void {
    if (!cron.validate(job.cronExpr)) {
      Logger.warn('Scheduler', `Invalid cron for "${job.name}": ${job.cronExpr}`)
      return
    }
    const task = cron.schedule(job.cronExpr, () => { void this._execute(job) })
    tasks.set(job.id, task)
    Logger.info('Scheduler', `Scheduled "${job.name}" [${job.cronExpr}]`)
  },

  _unschedule(id: string): void {
    const t = tasks.get(id)
    if (t) { t.stop(); tasks.delete(id) }
  },

  _updateStatus(id: string, patch: Partial<ScheduledJob>): void {
    const jobs = this.list()
    const idx = jobs.findIndex(j => j.id === id)
    if (idx < 0) return
    jobs[idx] = { ...jobs[idx], ...patch }
    ConfigService.set({ scheduledJobs: jobs })
    emit(jobs)
  },

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
