import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  web: false,
}))

vi.mock('../../electron/services/config', () => ({
  ConfigService: {
    get: () => state.config,
    set: (partial: Record<string, unknown>) => { Object.assign(state.config, partial) },
  },
  DEFAULT_SERVER_URL: 'http://localhost:32400',
}))
vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn(), scrape: vi.fn(), session: vi.fn() },
}))
vi.mock('../../electron/runtime/runtime', () => ({ isWebMode: () => state.web }))
vi.mock('../../electron/services/animeMappingService', () => ({ AnimeMappingService: {} }))
vi.mock('../../electron/services/showStatusService', () => ({ ShowStatusService: {} }))

const { PlexService } = await import('../../electron/services/plexService')
const { PlexAuthService } = await import('../../electron/services/plexAuthService')

const HASH = '1c174d4b0e884fdfac77b0c9f7146871'
const LAN = `https://192-168-86-101.${HASH}.plex.direct:32400`
const BRIDGE = `https://172-16-0-1.${HASH}.plex.direct:32400`
const THUMB = '%2Flibrary%2Fmetadata%2F5%2Fthumb%2F123'

/** A TrueNAS server as plex.tv lists it: the container bridge comes before the LAN address. */
const resources = [{
  name: 'TrueNAS',
  clientIdentifier: 'machine-truenas',
  provides: 'server',
  owned: true,
  presence: true,
  connections: [
    { protocol: 'https', address: '172.16.0.1', port: 32400, uri: BRIDGE, local: true, relay: false },
    { protocol: 'https', address: '192.168.86.101', port: 32400, uri: LAN, local: true, relay: false },
  ],
}]

const fetchMock = vi.fn()
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const connectTimeout = () =>
  Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
  })

/**
 * Serves plex.tv and the TrueNAS server at the given addresses. Every other
 * address times out, the way the container bridge does from a LAN PC.
 */
function serveAt(addresses: string[], rootStatus = 200)
{
  fetchMock.mockImplementation(async (input: string) =>
  {
    const url = String(input)
    if (url.startsWith('https://plex.tv/api/v2/resources')) return json(resources)
    if (url.startsWith('https://plex.tv/')) return json({ username: 'viewer' })
    const base = addresses.find(address => url.startsWith(address))
    if (!base) throw connectTimeout()
    const path = url.slice(base.length)
    if (path === '/')
    {
      if (rootStatus !== 200) return new Response('', { status: rootStatus, statusText: rootStatus === 401 ? 'Unauthorized' : 'Server Error' })
      return json({ MediaContainer: { machineIdentifier: 'machine-truenas', friendlyName: 'TrueNAS' } })
    }
    if (path === '/library/sections') return json({ MediaContainer: { Directory: [{ key: '1', title: 'Movies', type: 'movie' }] } })
    if (path.startsWith('/library/sections/1/all')) return json({ MediaContainer: { Metadata: [{ ratingKey: '5', title: 'Heat', thumb: '/library/metadata/5/thumb/123' }] } })
    if (path.startsWith('/photo/:/transcode')) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    return new Response('', { status: 404 })
  })
}

beforeEach(() =>
{
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  state.web = false
  state.config = { baseUrl: BRIDGE, token: 'token-1', clientIdentifier: 'client-1', plexServerName: '' }
})

afterEach(() =>
{
  vi.unstubAllGlobals()
})

describe('PlexService.connect', () =>
{
  it('says why an address never answered instead of "fetch failed"', async () =>
  {
    serveAt([LAN])
    expect(await PlexService.connect({ baseUrl: BRIDGE, token: 'token-1' })).toEqual({
      success: false,
      unreachable: true,
      error: `Could not reach 172-16-0-1.${HASH}.plex.direct:32400: the connection timed out`,
    })
  })

  it('keeps the status when Plex answers with an error', async () =>
  {
    serveAt([LAN], 500)
    const result = await PlexService.connect({ baseUrl: LAN, token: 'token-1' })
    expect(result).toMatchObject({ success: false, unreachable: false, status: 500 })
    expect(result.error).toContain('Plex 500')
  })
})

describe('PlexService.tryRestoreFromConfig', () =>
{
  it('moves a saved address that stopped answering to one that does', async () =>
  {
    serveAt([LAN])
    expect(await PlexService.tryRestoreFromConfig()).toEqual({ success: true, serverName: 'TrueNAS' })
    expect(state.config).toMatchObject({ baseUrl: LAN, plexServerName: 'TrueNAS' })
  })

  it('never moves to a different server than the one saved', async () =>
  {
    state.config.plexServerName = 'Basement'
    serveAt([LAN])
    expect(await PlexService.tryRestoreFromConfig()).toEqual({ success: false })
    expect(state.config.baseUrl).toBe(BRIDGE)
  })

  it('does not look for another address when the server answers with an error', async () =>
  {
    state.config.baseUrl = LAN
    serveAt([LAN], 500)
    expect(await PlexService.tryRestoreFromConfig()).toEqual({ success: false })
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://plex.tv/'))).toBe(false)
  })

  it('clears a token the server rejects', async () =>
  {
    state.config.baseUrl = LAN
    serveAt([LAN], 401)
    expect(await PlexService.tryRestoreFromConfig()).toEqual({ success: false, tokenInvalid: true })
    expect(state.config.token).toBe('')
  })

  it('keeps the token when an address that merely contains 401 does not answer', async () =>
  {
    state.config.baseUrl = 'https://10-0-4-1.c401c401c401c401c401c401c401c401.plex.direct:32401'
    serveAt([])
    expect(await PlexService.tryRestoreFromConfig()).toEqual({ success: false })
    expect(state.config.token).toBe('token-1')
  })
})

describe('sign-in', () =>
{
  it('connects to the address that answers and saves it', async () =>
  {
    state.config.baseUrl = 'http://localhost:32400'
    serveAt([LAN])
    const onStatus = vi.fn()
    await PlexAuthService._finalize('token-2', {}, onStatus)
    expect(onStatus).toHaveBeenCalledWith({ status: 'authorized', token: 'token-2', serverName: 'TrueNAS', serverError: undefined })
    expect(state.config).toMatchObject({ baseUrl: LAN, plexServerName: 'TrueNAS', token: 'token-2' })
  })

  it('saves no address and says why when none answers', async () =>
  {
    serveAt([])
    const onStatus = vi.fn()
    await PlexAuthService._finalize('token-2', {}, onStatus)
    expect(onStatus).toHaveBeenCalledWith({
      status: 'authorized',
      token: 'token-2',
      serverName: undefined,
      serverError: 'TrueNAS did not answer at any address Plex lists for it. Enter the address you reach it at on this network.',
    })
    expect(state.config.baseUrl).toBe(BRIDGE)
  })
})

describe('Plex images', () =>
{
  it('load from the server in the desktop app and through this app in the web UI', async () =>
  {
    serveAt([LAN])
    await PlexService.connect({ baseUrl: LAN, token: 'token-1' })
    const [desktop] = await PlexService.getLabeledItems({ label: 'MediUX' })
    expect(desktop.thumb).toBe(`${LAN}/photo/:/transcode?width=120&height=180&minSize=1&upscale=1&url=${THUMB}&X-Plex-Token=token-1`)

    state.web = true
    const [web] = await PlexService.getLabeledItems({ label: 'MediUX' })
    expect(web.thumb).toBe(`/api/plex/photo?width=120&height=180&url=${THUMB}`)
  })

  it('are fetched for the web UI with the token in a header, not the URL', async () =>
  {
    serveAt([LAN])
    await PlexService.connect({ baseUrl: LAN, token: 'token-1' })
    fetchMock.mockClear()
    const photo = await PlexService.fetchPhoto('/library/metadata/5/thumb/123', 99_999, Number.NaN)
    expect(photo.status).toBe(200)
    expect(photo.contentType).toBe('image/jpeg')
    expect([...(photo.body ?? [])]).toEqual([1, 2, 3])
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(url).toBe(`${LAN}/photo/:/transcode?width=2000&height=360&minSize=1&upscale=1&url=${THUMB}`)
    expect(init.headers['X-Plex-Token']).toBe('token-1')
  })

  it('are only fetched from a path on the connected server', async () =>
  {
    serveAt([LAN])
    await PlexService.connect({ baseUrl: LAN, token: 'token-1' })
    expect((await PlexService.fetchPhoto('https://example.com/a.jpg', 240, 360)).status).toBe(400)
    expect((await PlexService.fetchPhoto('//example.com/a.jpg', 240, 360)).status).toBe(400)
    await PlexService.connect({ baseUrl: BRIDGE, token: 'token-1' })
    expect((await PlexService.fetchPhoto('/library/metadata/5/thumb/123', 240, 360)).status).toBe(503)
  })
})
