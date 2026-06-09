import Store from 'electron-store'
import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import type { AppConfig } from '../ipc/types'

const DEFAULTS: AppConfig = {
  baseUrl: 'http://localhost:32400',
  token: '',
  tvLibraries: [],
  movieLibraries: [],
  mediuxFilters: ['poster', 'backdrop', 'title_card'],
  titleMappings: {},
  maxWorkers: 4,
  bulkFiles: [],
  scraperMinDelay: 0.1,
  scraperMaxDelay: 0.5,
  scraperInitialDelay: 0.0,
  scraperBatchDelay: 2.0,
  scraperPageWaitMin: 0.0,
  scraperPageWaitMax: 0.5,
  logAppend: true,
  clientIdentifier: '',
  logDrawerHeight: 300,
  plexServerName: '',
  scheduledJobs: [],
  tmdbApiKey: '',
  mediuxSubscriptions: [],
  appliedSetIds: [],
  appliedPosters: [],
  trayNotice: true,
  excludedLibraries: [],
}

const store = new Store<Record<string, unknown>>({ name: 'app-config' })

export const ConfigService = {
  async init() {
    if (!store.get('clientIdentifier')) {
      store.set('clientIdentifier', randomUUID())
    }
  },

  get(): AppConfig {
    const raw = store.store as Partial<AppConfig>
    const config = { ...DEFAULTS, ...raw }

    if (config.token && safeStorage.isEncryptionAvailable()) {
      try {
        const buf = Buffer.from(config.token as string, 'base64')
        config.token = safeStorage.decryptString(buf)
      } catch {
        config.token = ''
      }
    }

    return config
  },

  set(partial: Partial<AppConfig>) {
    const updates = { ...partial }

    if (updates.token !== undefined && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(updates.token)
      updates.token = encrypted.toString('base64')
    }

    Object.entries(updates).forEach(([key, value]) => {
      store.set(key, value)
    })
  },

  getLogPath(): string {
    return app.getPath('logs')
  },
}
