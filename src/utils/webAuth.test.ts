import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import Fastify from 'fastify'

const state = vi.hoisted(() =>
{
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  const fs = require('fs') as typeof import('fs')
  return {
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'pps-web-auth-')),
    config: {} as Record<string, unknown>,
    owner: '' as string | null,
    now: 0,
  }
})

vi.mock('../../electron/services/config', () => ({
  ConfigService: {
    get: () => state.config,
    set: (partial: Record<string, unknown>) => { Object.assign(state.config, partial) },
  },
  DEFAULT_SERVER_URL: 'http://localhost:32400',
}))
vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../electron/runtime/paths', () => ({ getUserDataPath: () => state.dir }))
vi.mock('../../electron/runtime/events', () => ({ appEvents: { emitEvent: vi.fn(), onEvent: vi.fn(() => () => {}) } }))
vi.mock('../../electron/services/plexAuthService', () => ({
  requestPin: vi.fn(),
  checkPin: vi.fn(),
  readAccount: vi.fn(),
  PlexAuthService: {
    ownerAccountId: vi.fn(async () => state.owner),
    _finalize: vi.fn(async (token: string, _onStatus: unknown, account: { id: string }) =>
    {
      state.config.token = token
      state.owner = account.id
    }),
    refreshOwnerToken: vi.fn(async (token: string) => { state.config.token = token }),
  },
}))

const { Sessions, SESSION_COOKIE, SIGN_IN_COOKIE } = await import('../../server/session')
const { BrowserSignIn, OWNER_UNKNOWN, WRONG_ACCOUNT } = await import('../../server/browserSignIn')
const { registerAuth } = await import('../../server/auth')
const { PlexAuthService, checkPin, readAccount, requestPin } = await import('../../electron/services/plexAuthService')

const OWNER = { id: '42', username: 'owner' }
const STRANGER = { id: '7', username: 'stranger' }
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/** Makes plex.tv approve PINs for this account from now on. */
function approveAs(account: { id: string; username: string })
{
  vi.mocked(checkPin).mockResolvedValue(`token-of-${account.id}`)
  vi.mocked(readAccount).mockResolvedValue(account)
}

/**
 * Reads the cookies a reply sets.
 *
 * @param headers - Reply headers from Fastify inject.
 * @returns name=value pairs keyed by name, '' for cleared cookies.
 */
function setCookies(headers: Record<string, unknown>): Record<string, string>
{
  const raw = headers['set-cookie']
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : []
  return Object.fromEntries(list.map(c => String(c).split(';')[0].split('=')).map(([k, ...v]) => [k, v.join('=')]))
}

beforeEach(() =>
{
  vi.clearAllMocks()
  state.now = Date.UTC(2026, 10, 19)
  vi.spyOn(Date, 'now').mockImplementation(() => state.now)
  state.config = { token: 'owner-token', clientIdentifier: 'client-1' }
  state.owner = OWNER.id
  vi.mocked(requestPin).mockImplementation(async () => ({ id: 1, code: 'ABCD', authUrl: 'https://app.plex.tv/auth#?code=ABCD' }))
  vi.mocked(checkPin).mockResolvedValue(null)
  BrowserSignIn.cancelAll()
  Sessions.destroyAll()
})

afterEach(() =>
{
  vi.restoreAllMocks()
})

describe('Sessions', () =>
{
  it('keep only hashes on disk and survive a restart', () =>
  {
    const id = Sessions.create()
    const onDisk = fs.readFileSync(path.join(state.dir, 'sessions.json'), 'utf8')
    expect(onDisk).not.toContain(id)
    Sessions.reload()
    expect(Sessions.isValid(id)).toBe(true)
  })

  it('end after 30 idle days, while use keeps them going', () =>
  {
    const kept = Sessions.create()
    const idle = Sessions.create()
    state.now += 20 * DAY
    expect(Sessions.isValid(kept)).toBe(true)
    state.now += 15 * DAY
    expect(Sessions.isValid(kept)).toBe(true)
    expect(Sessions.isValid(idle)).toBe(false)
  })

  it('end one at a time or all at once', () =>
  {
    const a = Sessions.create()
    const b = Sessions.create()
    Sessions.destroy(a)
    expect([Sessions.isValid(a), Sessions.isValid(b)]).toEqual([false, true])
    Sessions.destroyAll()
    expect(Sessions.isValid(b)).toBe(false)
    expect(Sessions.isValid(undefined)).toBe(false)
  })
})

describe('BrowserSignIn', () =>
{
  it('lets the owner in and keeps the newest token', async () =>
  {
    const { id } = await BrowserSignIn.start()
    approveAs(OWNER)
    expect(await BrowserSignIn.status(id)).toEqual({ status: 'authorized' })
    expect(PlexAuthService.refreshOwnerToken).toHaveBeenCalledWith('token-of-42', OWNER)
    expect(PlexAuthService._finalize).not.toHaveBeenCalled()
  })

  it('refuses another Plex account and leaves the stored token alone', async () =>
  {
    const { id } = await BrowserSignIn.start()
    approveAs(STRANGER)
    expect(await BrowserSignIn.status(id)).toEqual({ status: 'error', error: WRONG_ACCOUNT })
    expect(state.config.token).toBe('owner-token')
    expect(PlexAuthService.refreshOwnerToken).not.toHaveBeenCalled()
  })

  it('links the first account on an install nobody owns yet, then refuses a second one', async () =>
  {
    state.config.token = ''
    state.owner = ''
    const first = await BrowserSignIn.start()
    const second = await BrowserSignIn.start()
    vi.mocked(checkPin).mockResolvedValue('token-a')
    vi.mocked(readAccount).mockResolvedValueOnce(OWNER).mockResolvedValueOnce(STRANGER)
    const [a, b] = await Promise.all([BrowserSignIn.status(first.id), BrowserSignIn.status(second.id)])
    expect(a).toEqual({ status: 'authorized' })
    expect(b).toEqual({ status: 'error', error: WRONG_ACCOUNT })
    expect(PlexAuthService._finalize).toHaveBeenCalledTimes(1)
  })

  it('refuses when it cannot tell who owns the install', async () =>
  {
    state.owner = null
    const { id } = await BrowserSignIn.start()
    approveAs(OWNER)
    expect(await BrowserSignIn.status(id)).toEqual({ status: 'error', error: OWNER_UNKNOWN })
  })

  it('asks plex.tv at most every 1.5 seconds and times out after 5 minutes', async () =>
  {
    const { id } = await BrowserSignIn.start()
    await BrowserSignIn.status(id)
    await BrowserSignIn.status(id)
    expect(checkPin).toHaveBeenCalledTimes(1)
    state.now += 2000
    await BrowserSignIn.status(id)
    expect(checkPin).toHaveBeenCalledTimes(2)
    state.now += 5 * MINUTE
    expect(await BrowserSignIn.status(id)).toEqual({ status: 'timeout' })
  })
})

describe('web auth routes', () =>
{
  let sideEffects = 0
  const unlink = vi.fn(async () => { state.config.token = '' })

  /** Builds an app with the auth gate, the auth routes, and two app routes. */
  async function app()
  {
    sideEffects = 0
    const fastify = Fastify()
    registerAuth(fastify, { status: () => ({ status: 'authorized', serverName: 'TrueNAS' }), unlink })
    fastify.get('/api/plex/stats', async () => ({ ok: true }))
    fastify.post('/api/plex/clean-bundles', async () =>
    {
      sideEffects++
      return { ok: true }
    })
    await fastify.ready()
    return fastify
  }

  /** Signs a browser in as the given account and returns its session cookie. */
  async function signIn(fastify: Awaited<ReturnType<typeof app>>, account: { id: string; username: string })
  {
    const started = await fastify.inject({ method: 'POST', url: '/api/auth/sign-in' })
    const flow = setCookies(started.headers)[SIGN_IN_COOKIE]
    approveAs(account)
    state.now += 2000
    const done = await fastify.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie: `${SIGN_IN_COOKIE}=${flow}` } })
    return { reply: done, session: setCookies(done.headers)[SESSION_COOKIE] }
  }

  it('turns away a browser without a session before the route runs', async () =>
  {
    const fastify = await app()
    expect((await fastify.inject({ method: 'GET', url: '/api/plex/stats' })).statusCode).toBe(401)
    expect((await fastify.inject({ method: 'POST', url: '/api/plex/clean-bundles' })).statusCode).toBe(401)
    expect(sideEffects).toBe(0)
  })

  it('never hands out a session for asking', async () =>
  {
    const fastify = await app()
    const reply = await fastify.inject({ method: 'GET', url: '/api/auth/status' })
    expect(reply.json()).toEqual({ status: 'idle' })
    expect(reply.headers['set-cookie']).toBeUndefined()
  })

  it('gives the owner a session after a plex.tv sign-in', async () =>
  {
    const fastify = await app()
    const started = await fastify.inject({ method: 'POST', url: '/api/auth/sign-in' })
    expect(started.json()).toMatchObject({ status: 'waiting', authUrl: 'https://app.plex.tv/auth#?code=ABCD' })
    expect(setCookies(started.headers)[SIGN_IN_COOKIE]).toBeTruthy()

    const { reply, session } = await signIn(fastify, OWNER)
    expect(reply.json()).toEqual({ status: 'authorized', serverName: 'TrueNAS' })
    expect(session).toBeTruthy()
    const stats = await fastify.inject({ method: 'GET', url: '/api/plex/stats', headers: { cookie: `${SESSION_COOKIE}=${session}` } })
    expect(stats.statusCode).toBe(200)
  })

  it('gives another Plex account no session', async () =>
  {
    const fastify = await app()
    const { reply, session } = await signIn(fastify, STRANGER)
    expect(reply.json()).toEqual({ status: 'error', error: WRONG_ACCOUNT })
    expect(session).toBeUndefined()
  })

  it('needs a session to unlink, and unlinking signs every browser out', async () =>
  {
    const fastify = await app()
    expect((await fastify.inject({ method: 'POST', url: '/api/auth/disconnect' })).statusCode).toBe(401)
    expect(unlink).not.toHaveBeenCalled()

    const first = await signIn(fastify, OWNER)
    const second = await signIn(fastify, OWNER)
    const out = await fastify.inject({ method: 'POST', url: '/api/auth/disconnect', headers: { cookie: `${SESSION_COOKIE}=${first.session}` } })
    expect(out.statusCode).toBe(200)
    expect(unlink).toHaveBeenCalledOnce()
    expect(Sessions.isValid(first.session)).toBe(false)
    expect(Sessions.isValid(second.session)).toBe(false)
  })

  it('cancels only the calling browser\'s sign-in', async () =>
  {
    const fastify = await app()
    const started = await fastify.inject({ method: 'POST', url: '/api/auth/sign-in' })
    const flow = setCookies(started.headers)[SIGN_IN_COOKIE]
    await fastify.inject({ method: 'POST', url: '/api/auth/cancel', headers: { cookie: `${SIGN_IN_COOKIE}=${flow}` } })
    approveAs(OWNER)
    const status = await fastify.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie: `${SIGN_IN_COOKIE}=${flow}` } })
    expect(status.json()).toEqual({ status: 'idle' })
    expect(unlink).not.toHaveBeenCalled()
    expect(state.config.token).toBe('owner-token')
  })
})
