import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { RateLimitOptions } from '@fastify/rate-limit'
import { ConfigService } from '../electron/services/config'
import type { PlexAuthStatus } from '../electron/ipc/types'
import { BrowserSignIn } from './browserSignIn'
import { SESSION_COOKIE, SIGN_IN_COOKIE, Sessions, cookieHeader, readCookie, sessionCookie } from './session'

/** Routes a browser may call before it has a session. */
const PUBLIC_ROUTES = new Set([
  '/api/health',
  '/api/app/env',
  '/api/app/version',
  '/api/auth/status',
  '/api/auth/sign-in',
  '/api/auth/cancel',
])
const SIGN_IN_COOKIE_MAX_AGE_SEC = 10 * 60
/** Each sign-in asks plex.tv for a PIN, so starting one has a much smaller budget than the API. */
const SIGN_IN_RATE_LIMIT: RateLimitOptions = { max: 10, timeWindow: '1 minute' }
const UNAUTHORIZED = { error: 'Unauthorized - sign in with Plex' }

/** What the auth routes need from the rest of the app. */
export interface AuthDeps
{
  /** The install's auth status, for browsers that are signed in. */
  status: () => PlexAuthStatus | Promise<PlexAuthStatus>
  /** Unlinks the Plex account from this install. */
  unlink: () => Promise<void>
}

/**
 * Tells whether the browser reached the app over HTTPS, directly or through a
 * reverse proxy. A spoofed header only changes the caller's own cookie flags.
 *
 * @param req - The request.
 * @returns true for HTTPS.
 */
function isHttps(req: FastifyRequest): boolean
{
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
  return req.protocol === 'https' || forwarded === 'https'
}

/**
 * Returns the session id from the request's cookie.
 *
 * @param req - The request.
 * @returns The session id, or undefined.
 */
export function sessionIdOf(req: FastifyRequest): string | undefined
{
  return readCookie(req.headers.cookie, SESSION_COOKIE)
}

/**
 * Tells whether the request comes from a signed-in browser of a linked install.
 *
 * @param req - The request.
 * @returns true when the session is valid and a Plex account is linked.
 */
export function isSignedIn(req: FastifyRequest): boolean
{
  return !!ConfigService.get().token && Sessions.isValid(sessionIdOf(req))
}

/**
 * Answers 401 unless the browser is signed in.
 *
 * @param req - The request.
 * @param reply - The reply, sent when the browser is not signed in.
 * @returns true when the route may continue.
 */
export function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean
{
  if (isSignedIn(req)) return true
  reply.code(401).send(UNAUTHORIZED)
  return false
}

/**
 * Puts every API route except sign-in, health, and version behind a session,
 * and registers the sign-in routes. A browser gets a session only after
 * signing in to plex.tv as the account that owns this install.
 *
 * @param app - The Fastify app, before its other routes are added.
 * @param deps - Status and unlink actions from the shared handlers.
 */
export function registerAuth(app: FastifyInstance, deps: AuthDeps): void
{
  app.addHook('onRequest', async (req, reply) =>
  {
    if (!req.url.startsWith('/api/')) return
    const route = req.routeOptions.url ?? req.url.split('?')[0]
    if (PUBLIC_ROUTES.has(route)) return
    if (!isSignedIn(req)) return reply.code(401).send(UNAUTHORIZED)
  })

  app.get('/api/auth/status', async (req, reply) =>
  {
    if (isSignedIn(req)) return deps.status()
    const flowId = readCookie(req.headers.cookie, SIGN_IN_COOKIE)
    const flow = flowId ? await BrowserSignIn.status(flowId) : null
    if (!flowId || !flow) return { status: 'idle' }
    if (flow.status === 'waiting') return flow
    BrowserSignIn.cancel(flowId)
    const cookies = [cookieHeader(SIGN_IN_COOKIE, '', isHttps(req), 0)]
    if (flow.status === 'authorized') cookies.push(sessionCookie(Sessions.create(), isHttps(req)))
    reply.header('Set-Cookie', cookies)
    return flow.status === 'authorized' ? deps.status() : flow
  })

  app.post('/api/auth/sign-in', { config: { rateLimit: SIGN_IN_RATE_LIMIT } }, async (req, reply) =>
  {
    if (isSignedIn(req)) return deps.status()
    const previous = readCookie(req.headers.cookie, SIGN_IN_COOKIE)
    if (previous) BrowserSignIn.cancel(previous)
    try
    {
      const flow = await BrowserSignIn.start()
      reply.header('Set-Cookie', cookieHeader(SIGN_IN_COOKIE, flow.id, isHttps(req), SIGN_IN_COOKIE_MAX_AGE_SEC))
      return flow.status
    }
    catch (err)
    {
      return reply.code(503).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post('/api/auth/cancel', async (req, reply) =>
  {
    const flowId = readCookie(req.headers.cookie, SIGN_IN_COOKIE)
    if (flowId) BrowserSignIn.cancel(flowId)
    reply.header('Set-Cookie', cookieHeader(SIGN_IN_COOKIE, '', isHttps(req), 0))
    return { ok: true }
  })

  app.post('/api/auth/disconnect', async (req, reply) =>
  {
    await deps.unlink()
    BrowserSignIn.cancelAll()
    Sessions.destroyAll()
    reply.header('Set-Cookie', cookieHeader(SESSION_COOKIE, '', isHttps(req), 0))
    return { ok: true }
  })
}
