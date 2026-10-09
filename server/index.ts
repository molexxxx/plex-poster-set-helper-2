import path from 'path'
import fs from 'fs'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import rateLimit from '@fastify/rate-limit'
import { ConfigService } from '../electron/services/config'
import { Logger } from '../electron/services/logger'
import { PlexService } from '../electron/services/plexService'
import { SchedulerService } from '../electron/services/schedulerService'
import { PlaywrightService } from '../electron/services/playwrightService'
import { handlers } from '../electron/handlers'
import { appEvents } from '../electron/runtime/events'
import {
  createSession, destroySession, isValidSession, parseSessionCookie,
  sessionCookieHeader, clearSessionCookie,
} from './session'
import type { FastifyRequest, FastifyReply } from 'fastify'

const PORT = parseInt(process.env.PORT ?? '3939', 10)

function staticDir(): string {
  const candidates = [
    path.join(__dirname, '../../../src/dist'),
    path.join(__dirname, '../../src/dist'),
    path.join(process.cwd(), 'src/dist'),
  ]
  const dir = candidates.find(p => fs.existsSync(path.join(p, 'index.html'))) ?? candidates[0]
  const indexPath = path.join(dir, 'index.html')
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, 'utf8')
    if (!html.includes('id="root"') && !html.includes("id='root'")) {
      Logger.warn('Server', `Frontend build missing or stale in ${dir} - run "npm run build:web" and restart`)
    }
  } else {
    Logger.warn('Server', `No frontend build at ${indexPath} - run "npm run build:web" and restart`)
  }
  return dir
}

function hasPlexToken(): boolean {
  return !!ConfigService.get().token
}

function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  const sessionId = parseSessionCookie(req.headers.cookie)
  if (!isValidSession(sessionId) || !hasPlexToken()) {
    reply.code(401).send({ error: 'Unauthorized - sign in with Plex' })
    return false
  }
  return true
}

export async function startServer() {
  await ConfigService.init()
  Logger.init(null)
  PlaywrightService.setupEnv()
  SchedulerService.init(null)
  SchedulerService.startEngineHeartbeat()

  const app = Fastify({ logger: false })

  // Per-client request budget for the web API: generous enough for the
  // UI's bursts, tight enough to blunt brute force. The browser routes below
  // carry their own, much smaller budget because they launch processes.
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' })

  // --- Public routes ---
  app.get('/api/health', async () => ({ ok: true }))

  app.get('/api/auth/status', async (req, reply) => {
    const sessionId = parseSessionCookie(req.headers.cookie)
    const status = await handlers.auth.getStatus()
    if (status.status === 'authorized' && isValidSession(sessionId)) {
      return status
    }
    if (status.status === 'authorized' && hasPlexToken()) {
      const newSession = createSession()
      reply.header('Set-Cookie', sessionCookieHeader(newSession))
      return status
    }
    return { status: 'idle' as const }
  })

  app.post('/api/auth/sign-in', async (_req, reply) => {
    try {
      return await handlers.auth.beginSignIn(null)
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // Public SSE for auth status during sign-in (main /api/events requires a session)
  app.get('/api/auth/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const send = (data: unknown) => {
      reply.raw.write(`event: auth:statusChange\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const unsub = appEvents.onEvent('auth:statusChange', send)
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25000)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      unsub()
    })
  })

  app.post('/api/auth/disconnect', async (req, reply) => {
    const sessionId = parseSessionCookie(req.headers.cookie)
    if (sessionId) destroySession(sessionId)
    await handlers.auth.disconnect()
    reply.header('Set-Cookie', clearSessionCookie())
    return { ok: true }
  })

  // --- SSE (requires auth) ---
  app.get('/api/events', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const unsubs = [
      appEvents.onEvent('scrape:progress', d => send('scrape:progress', d)),
      appEvents.onEvent('auth:statusChange', d => send('auth:statusChange', d)),
      appEvents.onEvent('scheduler:onChange', d => send('scheduler:onChange', d)),
      appEvents.onEvent('browser:installProgress', d => send('browser:installProgress', d)),
      appEvents.onEvent('browser:installState', d => send('browser:installState', d)),
      appEvents.onEvent('log:stream', d => send('log:stream', d)),
      appEvents.onEvent('app:updateAvailable', d => send('app:updateAvailable', d)),
      appEvents.onEvent('app:downloadProgress', d => send('app:downloadProgress', d)),
      appEvents.onEvent('app:updateReady', () => send('app:updateReady', {})),
      appEvents.onEvent('library:userSetsChunk', d => send('library:userSetsChunk', d)),
    ]

    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25000)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubs.forEach(u => u())
    })
  })

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return
    const publicPaths = [
      '/api/health',
      '/api/auth/status',
      '/api/auth/sign-in',
      '/api/auth/disconnect',
      '/api/auth/events',
      '/api/events',
      '/api/browser/status',
      '/api/browser/install',
      '/api/app/env',
      '/api/app/version',
    ]
    // Reading config is public so the sign-in screen can render (the token is
    // blanked for unauthenticated reads); changing it always needs a session.
    const publicReadPaths = ['/api/config']
    const urlPath = req.url.split('?')[0]
    if (publicPaths.includes(urlPath)) return
    if (req.method === 'GET' && publicReadPaths.includes(urlPath)) return
    if (!requireAuth(req, reply)) return
  })

  // Plex
  app.post('/api/plex/connect', async (req) => handlers.plex.connect((req.body as { baseUrl: string; token: string })))
  app.get('/api/plex/libraries', async () => handlers.plex.getLibraries())
  app.get('/api/plex/library-count', async (req) => {
    const q = req.query as { key: string; type: 'movie' | 'show' }
    return handlers.plex.getLibraryCount(q.key, q.type)
  })
  app.post('/api/plex/find-item', async (req) => handlers.plex.findItem(req.body as Parameters<typeof handlers.plex.findItem>[0]))
  app.post('/api/plex/find-collection', async (req) => handlers.plex.findCollection(req.body as Parameters<typeof handlers.plex.findCollection>[0]))
  app.post('/api/plex/upload-poster', async (req) => handlers.plex.uploadPoster(req.body as Parameters<typeof handlers.plex.uploadPoster>[0]))
  app.post('/api/plex/labeled-items', async (req) => handlers.plex.getLabeledItems(req.body as Parameters<typeof handlers.plex.getLabeledItems>[0]))
  app.post('/api/plex/reset-poster', async (req) => handlers.plex.resetPoster(req.body as Parameters<typeof handlers.plex.resetPoster>[0]))
  app.post('/api/plex/clean-bundles', async () => handlers.plex.cleanBundles())
  app.get('/api/plex/stats', async () => handlers.plex.getStats())

  // Library
  app.get('/api/library/sections', async () => handlers.library.sections())
  app.post('/api/library/items', async (req) => handlers.library.items(req.body as Parameters<typeof handlers.library.items>[0]))
  app.post('/api/library/collections', async (req) => handlers.library.collections(req.body as Parameters<typeof handlers.library.collections>[0]))
  app.post('/api/library/collection-sets', async (req) => handlers.library.collectionSets(req.body as Parameters<typeof handlers.library.collectionSets>[0]))
  app.post('/api/library/sets', async (req) => handlers.library.sets(req.body as Parameters<typeof handlers.library.sets>[0]))
  app.post('/api/library/user-sets', async (req) => handlers.library.userSets(req.body as Parameters<typeof handlers.library.userSets>[0]))
  app.post('/api/library/start-user-sets', async (req) => handlers.library.startUserSets(req.body as Parameters<typeof handlers.library.startUserSets>[0]))
  app.post('/api/library/refresh-user-sets', async (req) => handlers.library.refreshUserSets(req.body as Parameters<typeof handlers.library.refreshUserSets>[0]))
  app.post('/api/library/creator-search', async (req) => handlers.library.creatorSearch(req.body as Parameters<typeof handlers.library.creatorSearch>[0]))
  app.get('/api/library/current-art', async (req) => {
    const q = req.query as { key: string; type: string; title: string; year?: string }
    return handlers.library.currentArt({
      key: q.key,
      type: q.type as 'movie' | 'show' | 'collection',
      title: q.title,
      year: q.year ? parseInt(q.year, 10) : undefined,
    })
  })

  // Scrape
  app.post('/api/scrape/url', async (req) => handlers.scrape.url(req.body as Parameters<typeof handlers.scrape.url>[0]))
  app.post('/api/scrape/cancel', async () => handlers.scrape.cancel())

  app.get('/api/config', async (req) => {
    const cfg = handlers.config.get()
    const sessionId = parseSessionCookie(req.headers.cookie)
    if (!isValidSession(sessionId) || !hasPlexToken()) {
      return { ...cfg, token: '' }
    }
    return cfg
  })
  app.patch('/api/config', async (req) => { handlers.config.set(req.body as Parameters<typeof handlers.config.set>[0]); return { ok: true } })

  // Bulk
  app.get('/api/bulk/files', async () => handlers.bulk.listFiles())
  app.get('/api/bulk/file', async (req) => {
    const q = req.query as { name: string }
    return handlers.bulk.readFile(q.name)
  })
  app.put('/api/bulk/file', async (req) => handlers.bulk.writeFile(req.body as Parameters<typeof handlers.bulk.writeFile>[0]))
  app.post('/api/bulk/file', async (req) => {
    const b = req.body as { filename: string }
    handlers.bulk.newFile(b.filename)
    return { ok: true }
  })
  app.delete('/api/bulk/file', async (req) => {
    const q = req.query as { name: string }
    handlers.bulk.deleteFile(q.name)
    return { ok: true }
  })
  app.post('/api/bulk/rename', async (req) => {
    const b = req.body as { oldName: string; newName: string }
    handlers.bulk.renameFile(b.oldName, b.newName)
    return { ok: true }
  })

  // App
  app.get('/api/app/version', async () => handlers.app.getVersion())
  app.get('/api/app/env', async () => handlers.app.getEnv())
  app.get('/api/app/check-update', async () => handlers.app.checkUpdate())
  app.post('/api/app/install-update', async () => { handlers.app.installUpdate(); return { ok: true } })
  app.post('/api/app/quit-and-install', async () => { handlers.app.quitAndInstall(); return { ok: true } })
  app.get('/api/app/log-path', async () => ({ path: ConfigService.getLogPath() }))

  // Scheduler
  app.get('/api/scheduler/jobs', async () => handlers.scheduler.list())
  app.put('/api/scheduler/jobs', async (req) => handlers.scheduler.save(req.body as Parameters<typeof handlers.scheduler.save>[0]))
  app.delete('/api/scheduler/jobs', async (req) => {
    const q = req.query as { id: string }
    handlers.scheduler.delete(q.id)
    return { ok: true }
  })
  app.post('/api/scheduler/run', async (req) => {
    const b = req.body as { id: string }
    await handlers.scheduler.runNow(b.id)
    return { ok: true }
  })
  app.post('/api/scheduler/auto-start', async (req) => {
    const b = req.body as { enable: boolean }
    handlers.scheduler.setAutoStart(b.enable)
    return { ok: true }
  })
  app.get('/api/scheduler/auto-start', async () => ({ enabled: handlers.scheduler.getAutoStart() }))
  app.get('/api/scheduler/engine-status', async () => handlers.scheduler.engineStatus())
  app.get('/api/scheduler/preview', async (req) => {
    const q = req.query as { expr?: string }
    return handlers.scheduler.preview(q.expr ?? '')
  })

  // Browser
  app.get('/api/browser/status', async () => handlers.browser.getStatus())
  app.post('/api/browser/install', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) =>
    handlers.browser.install((req.body ?? {}) as { force?: boolean }))
  app.post('/api/browser/cancel', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async () =>
    handlers.browser.cancelInstall())
  app.post('/api/browser/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async () =>
    handlers.browser.verify())
  app.post('/api/browser/executable', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) =>
    handlers.browser.useExecutable(((req.body ?? {}) as { path?: string | null }).path ?? null))

  // Log
  app.get('/api/log/history', async () => handlers.log.getHistory())
  app.post('/api/log/clear', async () => { handlers.log.clear(); return { ok: true } })

  // Static files
  const dist = staticDir()
  await app.register(fastifyStatic, {
    root: dist,
    prefix: '/',
  })

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Not found' })
    }
    return reply.sendFile('index.html')
  })

  await app.listen({ port: PORT, host: '0.0.0.0' })
  Logger.success('Server', `Plex Poster Helper web UI at http://0.0.0.0:${PORT}`)

  void PlaywrightService.bootstrap()

  PlexService.tryRestoreFromConfig().then(result => {
    if (result.success) {
      appEvents.emitEvent('auth:statusChange', { status: 'authorized', serverName: result.serverName })
      Logger.info('App', 'Auto-reconnected to Plex from saved config')
    }
  }).catch(() => {})
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Server failed to start:', err)
    process.exit(1)
  })
}
