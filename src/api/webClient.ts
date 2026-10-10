import type { Api } from '../../electron/preload'
import type {
  AppConfig, ScrapeProgress, LogEntry, PlexAuthStatus, UpdateInfo, UpdateProgress,
  AppEnv, ScheduledJob, SchedulerEngineStatus, CronPreview, ClearCachesRes, AppliedRecord, BrowserStatus, BrowserActionResult, BrowserInstallState,
  SectionItemsReq, BrowseSetsReq, UserSetsReq, CreatorSearchReq, CollectionsReq, CollectionSetsReq,
  CurrentArtReq, CurrentArtRes, UserSetsChunk,
} from '../../electron/ipc/types'

type SseHandler = (event: string, data: unknown) => void

let eventSource: EventSource | null = null
let authEventSource: EventSource | null = null
const sseHandlers = new Map<string, Set<SseHandler>>()
const authSseHandlers = new Set<(status: PlexAuthStatus) => void>()

function ensureAuthSse() {
  if (authEventSource) return
  authEventSource = new EventSource('/api/auth/events')
  authEventSource.addEventListener('auth:statusChange', (e: MessageEvent) => {
    const data = JSON.parse(e.data as string) as PlexAuthStatus
    authSseHandlers.forEach(h => h(data))
    sseHandlers.get('auth:statusChange')?.forEach(h => h('auth:statusChange', data))
  })
  authEventSource.onerror = () => {
    authEventSource?.close()
    authEventSource = null
    setTimeout(ensureAuthSse, 3000)
  }
}

function ensureSse() {
  if (eventSource) return
  eventSource = new EventSource('/api/events')
  eventSource.onmessage = () => { /* named events only */ }
  const events = [
    'scrape:progress', 'scheduler:onChange',
    'browser:installProgress', 'log:stream', 'app:updateAvailable',
    'app:downloadProgress', 'app:updateReady', 'library:userSetsChunk',
  ] as const
  for (const name of events) {
    eventSource.addEventListener(name, (e: MessageEvent) => {
      const data = JSON.parse(e.data as string)
      sseHandlers.get(name)?.forEach(h => h(name, data))
    })
  }
  eventSource.onerror = () => {
    eventSource?.close()
    eventSource = null
    setTimeout(ensureSse, 3000)
  }
}

function onSse(event: string, cb: SseHandler): () => void {
  ensureSse()
  if (!sseHandlers.has(event)) sseHandlers.set(event, new Set())
  sseHandlers.get(event)!.add(cb)
  return () => sseHandlers.get(event)?.delete(cb)
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    // Fastify's default error reply puts the thrown message in `message` and the
    // HTTP status text in `error`; explicit route replies only set `error`.
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; message?: string }
    throw new Error(err.message ?? err.error ?? `Request failed: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function createWebClient(): Api {
  return {
    window: {
      minimize: () => {},
      maximize: () => {},
      close: () => {},
    },

    plex: {
      connect: (baseUrl, token) => apiFetch('/api/plex/connect', { method: 'POST', body: JSON.stringify({ baseUrl, token }) }),
      getLibraries: () => apiFetch('/api/plex/libraries'),
      findItem: (title, year, libraries, tmdbId) =>
        apiFetch('/api/plex/find-item', { method: 'POST', body: JSON.stringify({ title, year, libraries: libraries ?? [], tmdbId }) }),
      findCollection: (title) =>
        apiFetch('/api/plex/find-collection', { method: 'POST', body: JSON.stringify({ title }) }),
      uploadPoster: (itemKey, imageUrl, source, season, episode, isCollection) =>
        apiFetch('/api/plex/upload-poster', { method: 'POST', body: JSON.stringify({ itemKey, imageUrl, source, season, episode, isCollection }) }),
      getLabeledItems: (label) =>
        apiFetch('/api/plex/labeled-items', { method: 'POST', body: JSON.stringify({ label }) }),
      resetPoster: (itemKey, hierarchical, deleteUploads) =>
        apiFetch('/api/plex/reset-poster', { method: 'POST', body: JSON.stringify({ itemKey, hierarchical, deleteUploads }) }),
      cleanBundles: () => apiFetch('/api/plex/clean-bundles', { method: 'POST' }),
      getStats: () => apiFetch('/api/plex/stats'),
      getLibraryCount: (key, type) => apiFetch(`/api/plex/library-count?key=${encodeURIComponent(key)}&type=${type}`),
    },

    library: {
      sections: () => apiFetch('/api/library/sections'),
      items: (req: SectionItemsReq) => apiFetch('/api/library/items', { method: 'POST', body: JSON.stringify(req) }),
      collections: (req: CollectionsReq) => apiFetch('/api/library/collections', { method: 'POST', body: JSON.stringify(req) }),
      collectionSets: (req: CollectionSetsReq) => apiFetch('/api/library/collection-sets', { method: 'POST', body: JSON.stringify(req) }),
      sets: (req: BrowseSetsReq) => apiFetch('/api/library/sets', { method: 'POST', body: JSON.stringify(req) }),
      userSets: (req: UserSetsReq) => apiFetch('/api/library/user-sets', { method: 'POST', body: JSON.stringify(req) }),
      startUserSets: (req: UserSetsReq) => apiFetch('/api/library/start-user-sets', { method: 'POST', body: JSON.stringify(req) }),
      refreshUserSets: (req: UserSetsReq) => apiFetch('/api/library/refresh-user-sets', { method: 'POST', body: JSON.stringify(req) }),
      onUserSetsChunk: (cb: (chunk: UserSetsChunk) => void) =>
        onSse('library:userSetsChunk', (_ev, data) => cb(data as UserSetsChunk)),
      creatorSearch: (req: CreatorSearchReq) => apiFetch('/api/library/creator-search', { method: 'POST', body: JSON.stringify(req) }),
      currentArt: (req: CurrentArtReq) => {
        const params = new URLSearchParams({
          key: req.key,
          type: req.type,
          title: req.title,
        })
        if (req.year != null) params.set('year', String(req.year))
        return apiFetch<CurrentArtRes>(`/api/library/current-art?${params}`)
      },
    },

    scrape: {
      url: (url) => apiFetch('/api/scrape/url', { method: 'POST', body: JSON.stringify({ url }) }),
      cancel: () => apiFetch('/api/scrape/cancel', { method: 'POST' }),
      onProgress: (cb: (progress: ScrapeProgress) => void) =>
        onSse('scrape:progress', (_, data) => cb(data as ScrapeProgress)),
    },

    config: {
      get: (): Promise<AppConfig> => apiFetch('/api/config'),
      set: (partial) => apiFetch('/api/config', { method: 'PATCH', body: JSON.stringify(partial) }),
    },

    bulk: {
      listFiles: () => apiFetch('/api/bulk/files'),
      readFile: (filename) => apiFetch(`/api/bulk/file?name=${encodeURIComponent(filename)}`),
      writeFile: (filename, lines) => apiFetch('/api/bulk/file', { method: 'PUT', body: JSON.stringify({ filename, lines }) }),
      newFile: (filename) => apiFetch('/api/bulk/file', { method: 'POST', body: JSON.stringify({ filename }) }),
      deleteFile: (filename) => apiFetch(`/api/bulk/file?name=${encodeURIComponent(filename)}`, { method: 'DELETE' }),
      renameFile: (oldName, newName) => apiFetch('/api/bulk/rename', { method: 'POST', body: JSON.stringify({ oldName, newName }) }),
    },

    auth: {
      signIn: async () => {
        const status = await apiFetch<PlexAuthStatus>('/api/auth/sign-in', { method: 'POST', body: '{}' })
        return status.authUrl ?? ''
      },
      getStatus: (): Promise<PlexAuthStatus> => apiFetch('/api/auth/status'),
      disconnect: () => apiFetch('/api/auth/disconnect', { method: 'POST' }),
      onStatusChange: (cb: (status: PlexAuthStatus) => void) => {
        ensureAuthSse()
        authSseHandlers.add(cb)
        return () => { authSseHandlers.delete(cb) }
      },
    },

    app: {
      getVersion: () => apiFetch('/api/app/version'),
      getEnv: (): Promise<AppEnv> => apiFetch('/api/app/env'),
      checkUpdate: (): Promise<UpdateInfo> => apiFetch('/api/app/check-update'),
      installUpdate: () => apiFetch('/api/app/install-update', { method: 'POST' }),
      quitAndInstall: () => apiFetch('/api/app/quit-and-install', { method: 'POST' }),
      openExternal: async (url: string) => { window.open(url, '_blank', 'noopener') },
      clearCaches: (): Promise<ClearCachesRes> => apiFetch('/api/app/clear-caches', { method: 'POST' }),
      openLogFolder: async () => {
        const res = await apiFetch<{ path: string }>('/api/app/log-path')
        await navigator.clipboard.writeText(res.path).catch(() => {})
        return res.path
      },
      onUpdateAvailable: (cb: (info: UpdateInfo) => void) =>
        onSse('app:updateAvailable', (_, data) => cb(data as UpdateInfo)),
      onDownloadProgress: (cb: (p: UpdateProgress) => void) =>
        onSse('app:downloadProgress', (_, data) => cb(data as UpdateProgress)),
      onUpdateReady: (cb: () => void) =>
        onSse('app:updateReady', () => cb()),
    },

    applied: {
      record: (records: AppliedRecord[]) => apiFetch('/api/applied/record', { method: 'POST', body: JSON.stringify({ records }) }),
      forget: (itemKey: string) => apiFetch('/api/applied/forget', { method: 'POST', body: JSON.stringify({ itemKey }) }),
    },

    scheduler: {
      list: (): Promise<ScheduledJob[]> => apiFetch('/api/scheduler/jobs'),
      save: (job): Promise<ScheduledJob> => apiFetch('/api/scheduler/jobs', { method: 'PUT', body: JSON.stringify(job) }),
      delete: (id) => apiFetch(`/api/scheduler/jobs?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
      runNow: (id) => apiFetch('/api/scheduler/run', { method: 'POST', body: JSON.stringify({ id }) }),
      setAutoStart: (v) => apiFetch('/api/scheduler/auto-start', { method: 'POST', body: JSON.stringify({ enable: v }) }),
      getAutoStart: async () => {
        const res = await apiFetch<{ enabled: boolean }>('/api/scheduler/auto-start')
        return res.enabled
      },
      engineStatus: (): Promise<SchedulerEngineStatus> => apiFetch('/api/scheduler/engine-status'),
      preview: (expr: string): Promise<CronPreview> => apiFetch(`/api/scheduler/preview?expr=${encodeURIComponent(expr)}`),
      reorder: (ids: string[]): Promise<ScheduledJob[]> => apiFetch('/api/scheduler/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
      onChange: (cb: (jobs: ScheduledJob[]) => void) =>
        onSse('scheduler:onChange', (_, data) => cb(data as ScheduledJob[])),
    },

    browser: {
      getStatus: (): Promise<BrowserStatus> => apiFetch('/api/browser/status'),
      install: (options?: { force?: boolean }): Promise<BrowserActionResult> =>
        apiFetch('/api/browser/install', { method: 'POST', body: JSON.stringify(options ?? {}) }),
      cancelInstall: (): Promise<BrowserStatus> => apiFetch('/api/browser/cancel', { method: 'POST', body: '{}' }),
      verify: (): Promise<BrowserActionResult> => apiFetch('/api/browser/verify', { method: 'POST', body: '{}' }),
      useExecutable: (execPath: string | null): Promise<BrowserActionResult> =>
        apiFetch('/api/browser/executable', { method: 'POST', body: JSON.stringify({ path: execPath }) }),
      pickExecutable: async (): Promise<BrowserActionResult> => ({
        ok: false,
        error: {
          kind: 'launch',
          message: 'Browsing for an executable is only available in the desktop app',
          hint: 'Pick one of the browsers detected on the server instead.',
        },
        status: await apiFetch('/api/browser/status'),
      }),
      onInstallProgress: (cb: (line: string) => void) =>
        onSse('browser:installProgress', (_, data) => cb(data as string)),
      onInstallState: (cb: (state: BrowserInstallState) => void) =>
        onSse('browser:installState', (_, data) => cb(data as BrowserInstallState)),
    },

    log: {
      getHistory: (): Promise<LogEntry[]> => apiFetch('/api/log/history'),
      clear: () => apiFetch('/api/log/clear', { method: 'POST' }),
      onEntry: (cb: (entry: LogEntry) => void) =>
        onSse('log:stream', (_, data) => cb(data as LogEntry)),
    },
  }
}
