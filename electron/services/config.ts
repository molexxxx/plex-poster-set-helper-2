import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { AppConfig } from '../ipc/types'
import { getUserDataPath, getLogPath } from '../runtime/paths'
import { isWebMode } from '../runtime/runtime'

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
  libraryPanelWidth: 560,
  plexServerName: '',
  scheduledJobs: [],
  tmdbApiKey: '',
  mediuxSubscriptions: [],
  appliedPosters: [],
  trayNotice: true,
  excludedLibraries: [],
  collectionsEnabled: true,
}

/** Web/Docker store tokens in plain JSON; desktop encrypts with OS keychain when available. */
function persistTokensAsPlaintext(): boolean {
  return isWebMode() || !!process.env.PLEX_HELPER_CONFIG_DIR
}

function jsonConfigPath(): string {
  return path.join(getUserDataPath(), 'config.json')
}

function readJsonStore(): Partial<AppConfig> {
  try {
    const raw = fs.readFileSync(jsonConfigPath(), 'utf8')
    return JSON.parse(raw) as Partial<AppConfig>
  } catch {
    return {}
  }
}

function writeJsonStore(data: Record<string, unknown>): void {
  const dir = getUserDataPath()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(jsonConfigPath(), JSON.stringify(data, null, 2), 'utf8')
}

/** One-time import from legacy electron-store file (app-config.json). */
function migrateLegacyElectronStore(): void {
  const target = jsonConfigPath()
  if (fs.existsSync(target)) return

  const legacyPath = path.join(getUserDataPath(), 'app-config.json')
  if (!fs.existsSync(legacyPath)) return

  try {
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8')) as Record<string, unknown>
    writeJsonStore(legacy)
    fs.renameSync(legacyPath, `${legacyPath}.migrated`)
  } catch {
    /* keep legacy file; fresh config will be created on first write */
  }
}

function readRaw(): Partial<AppConfig> {
  return readJsonStore()
}

function writeKey(key: string, value: unknown): void {
  const current = readJsonStore()
  writeJsonStore({ ...current, [key]: value })
}

function decryptToken(stored: string): string {
  if (!stored) return ''
  if (persistTokensAsPlaintext()) return stored
  try {
    const { safeStorage } = require('electron') as typeof import('electron')
    if (safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(stored, 'base64')
      return safeStorage.decryptString(buf)
    }
  } catch { /* fall through */ }
  return stored
}

function encryptToken(token: string): string {
  if (persistTokensAsPlaintext()) return token
  try {
    const { safeStorage } = require('electron') as typeof import('electron')
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(token).toString('base64')
    }
  } catch { /* fall through */ }
  return token
}

/** Persistent app configuration in userData/config.json (all runtimes). */
export const ConfigService = {
  async init() {
    migrateLegacyElectronStore()
    if (!readRaw().clientIdentifier) {
      writeKey('clientIdentifier', randomUUID())
    }
  },

  get(): AppConfig {
    const raw = readRaw()
    const config = { ...DEFAULTS, ...raw }
    if (config.token) {
      config.token = decryptToken(config.token as string)
    }
    return config
  },

  set(partial: Partial<AppConfig>) {
    const updates = { ...partial }
    if (updates.token !== undefined) {
      updates.token = encryptToken(updates.token)
    }
    Object.entries(updates).forEach(([key, value]) => {
      writeKey(key, value)
    })
  },

  getLogPath(): string {
    return getLogPath()
  },
}
