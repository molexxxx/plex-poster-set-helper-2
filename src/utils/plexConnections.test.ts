import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PlexResource, ServerCandidate } from '../../electron/services/plexConnections'

vi.mock('../../electron/services/config', () => ({
  ConfigService: { get: () => ({ clientIdentifier: 'client-1' }) },
  DEFAULT_SERVER_URL: 'http://localhost:32400',
}))

const { describeNetworkError, findServer, firstReachable, serverCandidates } = await import('../../electron/services/plexConnections')

const HASH = '1c174d4b0e884fdfac77b0c9f7146871'
const plexDirect = (ip: string, port = 32400) => `https://${ip.replace(/[.:]/g, '-')}.${HASH}.plex.direct:${port}`
const localConnection = (ip: string) =>
  ({ protocol: 'https', address: ip, port: 32400, uri: plexDirect(ip), local: true, relay: false, IPv6: false })

const fetchFailed = (code: string) =>
  Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`connect ${code}`), { code }) })
const abortError = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
const neverAnswers = (_candidate: ServerCandidate, signal: AbortSignal) =>
  new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(abortError())))
const candidate = (url: string): ServerCandidate => ({ url, serverName: 'Plex', serverId: 'machine' })

/** A TrueNAS server as plex.tv lists it: the container bridge comes before the LAN address. */
const trueNas: PlexResource = {
  name: 'TrueNAS',
  clientIdentifier: 'machine-truenas',
  provides: 'server',
  owned: true,
  presence: true,
  connections: [
    localConnection('172.16.0.1'),
    localConnection('192.168.86.101'),
    { protocol: 'https', address: '203.0.113.7', port: 32400, uri: plexDirect('203.0.113.7'), local: false, relay: false },
    { protocol: 'https', address: '198.51.100.20', port: 8443, uri: 'https://198-51-100-20.relay.plex.direct:8443', local: false, relay: true },
  ],
}

describe('serverCandidates', () =>
{
  it('ranks the home LAN address above a container bridge, then remote, then relay', () =>
  {
    expect(serverCandidates([trueNas]).map(c => c.url)).toEqual([
      plexDirect('192.168.86.101'),
      'http://192.168.86.101:32400',
      plexDirect('172.16.0.1'),
      'http://172.16.0.1:32400',
      plexDirect('203.0.113.7'),
      'https://198-51-100-20.relay.plex.direct:8443',
    ])
  })

  it('puts IPv6 after IPv4 and skips plain http when the server requires https', () =>
  {
    const server: PlexResource = {
      ...trueNas,
      connections: [{ ...localConnection('fd00::5'), IPv6: true }, localConnection('10.0.0.5')],
    }
    expect(serverCandidates([server]).map(c => c.url)).toEqual([
      plexDirect('10.0.0.5'),
      'http://10.0.0.5:32400',
      plexDirect('fd00::5'),
      'http://[fd00::5]:32400',
    ])
    expect(serverCandidates([{ ...server, httpsRequired: true }]).map(c => c.url)).toEqual([
      plexDirect('10.0.0.5'),
      plexDirect('fd00::5'),
    ])
  })

  it('lists only servers the user owns, online ones first', () =>
  {
    const resources: PlexResource[] = [
      { name: 'Phone', provides: 'client,player', owned: true, presence: true, connections: [localConnection('192.168.86.50')] },
      { name: 'Friend', provides: 'server', owned: false, presence: true, connections: [localConnection('192.168.1.9')] },
      { name: 'Old', clientIdentifier: 'machine-old', provides: 'server', owned: true, presence: false, connections: [localConnection('192.168.86.7')] },
      trueNas,
    ]
    const names = serverCandidates(resources).map(c => c.serverName)
    expect([...new Set(names)]).toEqual(['TrueNAS', 'Old'])
  })

  it('drops duplicate addresses and keeps plain http servers as listed', () =>
  {
    const plain = { protocol: 'http', address: '192.168.1.5', port: 32400, uri: 'http://192.168.1.5:32400', local: true, relay: false }
    const server: PlexResource = { ...trueNas, connections: [plain, { ...plain, uri: 'http://192.168.1.5:32400/' }] }
    expect(serverCandidates([server])).toEqual([
      { url: 'http://192.168.1.5:32400', serverName: 'TrueNAS', serverId: 'machine-truenas' },
    ])
  })
})

describe('firstReachable', () =>
{
  it('waits for a better address before taking a worse one that answered first', async () =>
  {
    const probe = async (c: ServerCandidate) =>
    {
      if (c.url !== 'a') return 'B'
      await new Promise(resolve => setTimeout(resolve, 20))
      return 'A'
    }
    expect(await firstReachable([candidate('a'), candidate('b')], probe)).toEqual({
      winner: { url: 'a', serverName: 'A' },
      failures: [],
    })
  })

  it('stops waiting on worse addresses once the best one answers, and cancels them', async () =>
  {
    let pending: AbortSignal | undefined
    const probe = (c: ServerCandidate, signal: AbortSignal) =>
    {
      if (c.url === 'a') return Promise.resolve('A')
      pending = signal
      return neverAnswers(c, signal)
    }
    const result = await firstReachable([candidate('a'), candidate('b')], probe, 60_000)
    expect(result.winner?.url).toBe('a')
    expect(pending?.aborted).toBe(true)
  })

  it('falls through a dead address to the next one and says why it was skipped', async () =>
  {
    const probe = (c: ServerCandidate) => (c.url === 'dead' ? Promise.reject(fetchFailed('UND_ERR_CONNECT_TIMEOUT')) : Promise.resolve('Plex'))
    expect(await firstReachable([candidate('dead'), candidate('live')], probe)).toEqual({
      winner: { url: 'live', serverName: 'Plex' },
      failures: [{ url: 'dead', serverName: 'Plex', reason: 'the connection timed out' }],
    })
  })

  it('gives up on addresses that never answer', async () =>
  {
    expect(await firstReachable([candidate('silent')], neverAnswers, 20)).toEqual({
      winner: null,
      failures: [{ url: 'silent', serverName: 'Plex', reason: 'it did not answer in time' }],
    })
  })

  it('settles at once when there is nothing to try', async () =>
  {
    const probe = vi.fn()
    expect(await firstReachable([], probe)).toEqual({ winner: null, failures: [] })
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('describeNetworkError', () =>
{
  it('reads the code Node keeps in the cause of "fetch failed"', () =>
  {
    expect(describeNetworkError(fetchFailed('UND_ERR_CONNECT_TIMEOUT'))).toBe('the connection timed out')
    expect(describeNetworkError(fetchFailed('ECONNREFUSED'))).toBe('the connection was refused')
    expect(describeNetworkError(fetchFailed('DEPTH_ZERO_SELF_SIGNED_CERT'))).toBe('its certificate was not accepted')
    expect(describeNetworkError(fetchFailed('ERR_TLS_CERT_ALTNAME_INVALID'))).toBe('its certificate was not accepted')
  })

  it('looks inside aggregate errors from trying several IPs', () =>
  {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: { errors: [Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH' })] },
    })
    expect(describeNetworkError(err)).toBe('there is no network route to it')
  })

  it('adds the DNS rebinding hint only for plex.direct names', () =>
  {
    expect(describeNetworkError(fetchFailed('ENOTFOUND'), plexDirect('192.168.86.101')))
      .toBe("its name did not resolve; a router's DNS rebinding protection can block plex.direct names")
    expect(describeNetworkError(fetchFailed('ENOTFOUND'), 'http://nas.local:32400')).toBe('its name did not resolve')
  })

  it('names timeouts and otherwise uses the innermost message', () =>
  {
    expect(describeNetworkError(abortError())).toBe('it did not answer in time')
    expect(describeNetworkError(Object.assign(new TypeError('fetch failed'), { cause: new Error('unknown scheme') }))).toBe('unknown scheme')
    expect(describeNetworkError(new Error('it did not accept the sign-in'))).toBe('it did not accept the sign-in')
  })
})

describe('findServer', () =>
{
  const fetchMock = vi.fn()
  type Answer = { id: string; name: string } | number | string

  /**
   * Serves plex.tv's device list and each address's root. A string answer is
   * the error code that address fails with; unknown addresses time out.
   */
  function network(resources: PlexResource[] | number, answers: Record<string, Answer>)
  {
    fetchMock.mockImplementation(async (input: string) =>
    {
      const url = String(input)
      if (url.startsWith('https://plex.tv/'))
      {
        if (typeof resources === 'number') return new Response('', { status: resources })
        return new Response(JSON.stringify(resources), { status: 200 })
      }
      const answer = answers[url.replace(/\/$/, '')] ?? 'UND_ERR_CONNECT_TIMEOUT'
      if (typeof answer === 'string') throw fetchFailed(answer)
      if (typeof answer === 'number') return new Response('', { status: answer })
      return new Response(JSON.stringify({ MediaContainer: { machineIdentifier: answer.id, friendlyName: answer.name } }), { status: 200 })
    })
  }

  const truenasAnswer = { id: 'machine-truenas', name: 'TrueNAS' }

  beforeEach(() =>
  {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() =>
  {
    vi.unstubAllGlobals()
  })

  it('finds the LAN address of a NAS whose first listed address is a container bridge', async () =>
  {
    network([trueNas], { [plexDirect('192.168.86.101')]: truenasAnswer })
    const found = await findServer('token')
    expect(found.server).toEqual({ url: plexDirect('192.168.86.101'), serverName: 'TrueNAS' })
    expect(found.failures).toEqual([])
    expect(found.listed).toEqual(['TrueNAS'])
  })

  it('falls back to plain http when plex.direct names do not resolve', async () =>
  {
    network([trueNas], { [plexDirect('192.168.86.101')]: 'ENOTFOUND', 'http://192.168.86.101:32400': truenasAnswer })
    const found = await findServer('token')
    expect(found.server?.url).toBe('http://192.168.86.101:32400')
    expect(found.failures).toHaveLength(1)
    expect(found.failures[0].reason).toContain('DNS rebinding')
  })

  it('skips a listed address where a different Plex server answers', async () =>
  {
    const stranger = { id: 'machine-other', name: 'Other' }
    network([trueNas], {
      [plexDirect('192.168.86.101')]: stranger,
      'http://192.168.86.101:32400': stranger,
      [plexDirect('172.16.0.1')]: truenasAnswer,
    })
    const found = await findServer('token')
    expect(found.server?.url).toBe(plexDirect('172.16.0.1'))
    expect(found.failures.map(f => f.reason)).toEqual(['a different Plex server answered', 'a different Plex server answered'])
  })

  it('keeps the saved address while it answers, ahead of the listed ones', async () =>
  {
    network([trueNas], { 'http://nas.lan:32400': truenasAnswer, [plexDirect('192.168.86.101')]: truenasAnswer })
    const found = await findServer('token', { savedUrl: 'http://nas.lan:32400' })
    expect(found.server).toEqual({ url: 'http://nas.lan:32400', serverName: 'TrueNAS' })
  })

  it('tries the built-in localhost default only after every listed address', async () =>
  {
    network([trueNas], { 'http://localhost:32400': truenasAnswer, [plexDirect('192.168.86.101')]: truenasAnswer })
    expect((await findServer('token', { savedUrl: 'http://localhost:32400' })).server?.url).toBe(plexDirect('192.168.86.101'))

    network(503, { 'http://localhost:32400': truenasAnswer })
    const offline = await findServer('token', { savedUrl: 'http://localhost:32400' })
    expect(offline.server?.url).toBe('http://localhost:32400')
    expect(offline.listError).toBe('plex.tv answered HTTP 503')
  })

  it('stays on the named server instead of moving to another one the user owns', async () =>
  {
    const basement: PlexResource = { ...trueNas, name: 'Basement', clientIdentifier: 'machine-basement', connections: [localConnection('192.168.86.30')] }
    network([trueNas, basement], { [plexDirect('192.168.86.30')]: { id: 'machine-basement', name: 'Basement' } })
    const found = await findServer('token', { serverName: 'TrueNAS' })
    expect(found.server).toBeNull()
    expect(found.listed).toEqual(['TrueNAS'])
  })

  it('reports a token the server refuses as a failure, not a match', async () =>
  {
    network([trueNas], { [plexDirect('192.168.86.101')]: 401, 'http://192.168.86.101:32400': 401 })
    const found = await findServer('token')
    expect(found.server).toBeNull()
    expect(found.failures.slice(0, 2).map(f => f.reason)).toEqual(['it did not accept the sign-in', 'it did not accept the sign-in'])
  })
})
