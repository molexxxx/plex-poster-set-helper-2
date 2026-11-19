import { ConfigService, DEFAULT_SERVER_URL } from './config'

const RESOURCES_URL = 'https://plex.tv/api/v2/resources?includeHttps=1&includeIPv6=1&includeRelay=1'
/** How long every address gets to answer. A dead address only costs this much when it outranks a live one. */
const PROBE_TIMEOUT_MS = 5000
const RESOURCES_TIMEOUT_MS = 15_000

/** A connection plex.tv lists for a device. */
export interface ResourceConnection
{
  uri: string
  protocol?: string
  address?: string
  port?: number
  local?: boolean
  relay?: boolean
  IPv6?: boolean
}

/** A device from plex.tv's resources API, reduced to what server discovery reads. */
export interface PlexResource
{
  name: string
  clientIdentifier?: string
  provides?: string
  owned?: boolean
  presence?: boolean
  httpsRequired?: boolean
  connections?: ResourceConnection[]
}

/** One address to try for a server. */
export interface ServerCandidate
{
  url: string
  serverName: string
  /** Machine identifier the answer must carry. Unset for the address saved in settings. */
  serverId?: string
}

/** An address where a server answered, with the name it reported. */
export interface ReachableServer
{
  url: string
  serverName: string
}

/** An address that did not work, and why. */
export interface ProbeFailure
{
  url: string
  serverName: string
  reason: string
}

/** What server discovery found. */
export interface DiscoveryResult
{
  server: ReachableServer | null
  /** Names of the owned servers plex.tv listed, best first. */
  listed: string[]
  /** Addresses ranked above the one that answered, or every address when none did. */
  failures: ProbeFailure[]
  /** Why the server list could not be read from plex.tv. */
  listError?: string
}

export interface DiscoveryOptions
{
  /** The address in settings. It is tried first, except the built-in default, which is tried last. */
  savedUrl?: string
  /** Only consider servers with this name, so a server that is down is never swapped for another one. */
  serverName?: string
}

const DNS_REASON = 'its name did not resolve'
const NETWORK_REASONS: Array<[RegExp, string]> = [
  [/^(UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|ETIMEDOUT)$/, 'the connection timed out'],
  [/^ECONNREFUSED$/, 'the connection was refused'],
  [/^(ENOTFOUND|EAI_AGAIN|EAI_FAIL|EAI_NODATA|EAI_NONAME)$/, DNS_REASON],
  [/^(EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ENETDOWN|EADDRNOTAVAIL)$/, 'there is no network route to it'],
  [/^(ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED)$/, 'the connection was dropped'],
  [/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|^ERR_TLS/, 'its certificate was not accepted'],
  [/^(EPROTO|ERR_SSL_)/, 'the secure connection failed'],
  [/^ERR_INVALID_URL$/, 'it is not a valid address; start it with http:// or https://'],
]

/**
 * Builds the X-Plex-* headers for plex.tv account requests.
 *
 * @param clientId - Stable per-install client identifier.
 * @returns Header map to spread into fetch options.
 */
export function plexTvHeaders(clientId: string): Record<string, string>
{
  return {
    'X-Plex-Product': 'Plex Poster Set Helper 2',
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Device': 'Desktop',
    'X-Plex-Device-Name': 'Plex Poster Set Helper 2',
    'X-Plex-Version': '2.0.0',
    'Accept': 'application/json',
  }
}

/**
 * Builds the headers for Plex Media Server requests.
 *
 * @param token - Plex auth token.
 * @returns Header map to spread into fetch options.
 */
export function plexServerHeaders(token: string): Record<string, string>
{
  return {
    'X-Plex-Token': token,
    'X-Plex-Client-Identifier': ConfigService.get().clientIdentifier,
    'X-Plex-Product': 'Plex Poster Set Helper 2',
    'Accept': 'application/json',
  }
}

/** The parts of an error, or of one of its causes, that describe a network failure. */
interface ErrorLink
{
  code?: unknown
  name?: unknown
  message?: unknown
  cause?: unknown
  errors?: unknown
}

/**
 * Follows an error's cause chain, including the first error of an aggregate.
 *
 * @param err - The caught value.
 * @returns The error and its causes, outermost first.
 */
function errorChain(err: unknown): ErrorLink[]
{
  const chain: ErrorLink[] = []
  let current: unknown = err
  while (current !== null && typeof current === 'object' && chain.length < 8)
  {
    const link = current as ErrorLink
    if (chain.includes(link)) break
    chain.push(link)
    current = link.cause ?? (Array.isArray(link.errors) ? link.errors[0] : undefined)
  }
  return chain
}

/**
 * Tests whether an address is a plex.direct name.
 *
 * @param url - The address, if known.
 * @returns true for https://1-2-3-4.<id>.plex.direct:32400 style addresses.
 */
function isPlexDirect(url: string | undefined): boolean
{
  if (!url) return false
  try
  {
    return new URL(url).hostname.toLowerCase().endsWith('.plex.direct')
  }
  catch
  {
    return false
  }
}

/**
 * Turns a failed request into a short reason. Node's fetch reports every
 * network failure as "fetch failed" and keeps the real error in its cause.
 *
 * @param err - The rejection from fetch or a probe.
 * @param url - The address that was tried, used to add a hint for plex.direct names.
 * @returns A short phrase such as "the connection timed out".
 */
export function describeNetworkError(err: unknown, url?: string): string
{
  const chain = errorChain(err)
  for (const link of chain)
  {
    if (typeof link.code !== 'string') continue
    const code = link.code
    const known = NETWORK_REASONS.find(([pattern]) => pattern.test(code))
    if (!known) continue
    if (known[1] === DNS_REASON && isPlexDirect(url))
    {
      return `${DNS_REASON}; a router's DNS rebinding protection can block plex.direct names`
    }
    return known[1]
  }
  if (chain.some(link => link.name === 'TimeoutError' || link.name === 'AbortError')) return 'it did not answer in time'
  const messages = chain
    .map(link => link.message)
    .filter((message): message is string => typeof message === 'string' && message.length > 0)
  return messages.length ? messages[messages.length - 1] : String(err)
}

/**
 * Ranks a private IPv4 address by how likely it is to be the LAN address.
 * Home networks mostly use 192.168/16, then 10/8, while container and VM
 * bridges such as Docker's and TrueNAS's usually sit in 172.16/12.
 *
 * @param address - Dotted IPv4 address.
 * @returns 0 (most likely) to 3.
 */
function privateRangeRank(address: string): number
{
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet))) return 3
  const [first, second] = octets
  if (first === 192 && second === 168) return 0
  if (first === 10) return 1
  if (first === 172 && second >= 16 && second <= 31) return 2
  return 3
}

/**
 * Compares two rank tuples element by element.
 *
 * @param a - First rank.
 * @param b - Second rank.
 * @returns Negative when a ranks first.
 */
function compareRanks(a: number[], b: number[]): number
{
  for (let i = 0; i < a.length; i++)
  {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/**
 * Normalizes an address for comparison.
 *
 * @param url - Server address.
 * @returns The address lowercased, without trailing slashes.
 */
function urlKey(url: string): string
{
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * Lists the addresses to try for the user's own servers, best first. Servers
 * plex.tv reports online come first. Within a server, local addresses beat
 * remote ones, which beat Plex's relay, and IPv4 beats IPv6. A local https
 * address is followed by plain http to the same IP, which still works when a
 * router's DNS rebinding protection blocks plex.direct names, unless the
 * server requires https.
 *
 * @param resources - Devices from plex.tv's resources API.
 * @returns Candidates in the order they should win.
 */
export function serverCandidates(resources: PlexResource[]): ServerCandidate[]
{
  const servers = resources
    .filter(resource => resource.owned && (resource.provides ?? '').split(',').some(role => role.trim() === 'server'))
    .sort((a, b) => Number(b.presence === true) - Number(a.presence === true))
  const seen = new Set<string>()
  const candidates: ServerCandidate[] = []
  for (const server of servers)
  {
    const ranked: Array<{ url: string; rank: number[] }> = []
    const connections = server.connections ?? []
    connections.forEach((connection, index) =>
    {
      if (!connection.uri) return
      const address = connection.address ?? ''
      const ipv6 = connection.IPv6 === true || address.includes(':')
      const place = connection.relay ? 2 : connection.local ? 0 : 1
      const rank = [place, ipv6 ? 1 : 0, place === 0 && !ipv6 ? privateRangeRank(address) : 0, index]
      ranked.push({ url: connection.uri, rank: [...rank, 0] })
      if (place === 0 && !server.httpsRequired && /^https:/i.test(connection.uri) && address && connection.port)
      {
        ranked.push({ url: `http://${ipv6 ? `[${address}]` : address}:${connection.port}`, rank: [...rank, 1] })
      }
    })
    ranked.sort((a, b) => compareRanks(a.rank, b.rank))
    for (const { url } of ranked)
    {
      const key = urlKey(url)
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({ url, serverName: server.name, serverId: server.clientIdentifier })
    }
  }
  return candidates
}

/**
 * Tries every candidate at once and keeps the best-ranked one that answers.
 * It settles as soon as every candidate ranked above an answering one has
 * failed, and cancels the requests still running.
 *
 * @param candidates - Addresses, best first.
 * @param probe - Resolves with the server's name, or rejects with why the address failed.
 * @param timeoutMs - How long any address gets to answer.
 * @returns The winning address, and the failures ranked above it.
 */
export function firstReachable(
  candidates: ServerCandidate[],
  probe: (candidate: ServerCandidate, signal: AbortSignal) => Promise<string>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<{ winner: ReachableServer | null; failures: ProbeFailure[] }>
{
  if (!candidates.length) return Promise.resolve({ winner: null, failures: [] })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const outcomes: Array<{ serverName: string } | { reason: string } | undefined> = candidates.map(() => undefined)
  return new Promise(resolve =>
  {
    let done = false
    const settle = () =>
    {
      if (done) return
      let winner = -1
      for (let i = 0; i < outcomes.length && winner < 0; i++)
      {
        const outcome = outcomes[i]
        if (!outcome) return
        if ('serverName' in outcome) winner = i
      }
      done = true
      clearTimeout(timer)
      controller.abort()
      const failed = winner < 0 ? outcomes : outcomes.slice(0, winner)
      resolve({
        winner: winner < 0 ? null : { url: candidates[winner].url, serverName: (outcomes[winner] as { serverName: string }).serverName },
        failures: failed.map((outcome, i) => ({
          url: candidates[i].url,
          serverName: candidates[i].serverName,
          reason: (outcome as { reason: string }).reason,
        })),
      })
    }
    candidates.forEach((candidate, i) =>
    {
      probe(candidate, controller.signal).then(
        serverName =>
        {
          outcomes[i] = { serverName }
          settle()
        },
        err =>
        {
          outcomes[i] = { reason: describeNetworkError(err, candidate.url) }
          settle()
        },
      )
    })
  })
}

/**
 * Asks one address for the server's root, which needs the token, so an answer
 * proves the whole path works: reachability, TLS, and the server accepting it.
 *
 * @param candidate - The address, and the machine identifier the answer must carry.
 * @param token - Plex account token.
 * @param signal - Cancels the request.
 * @returns The server's name.
 */
async function probeServer(candidate: ServerCandidate, token: string, signal: AbortSignal): Promise<string>
{
  const res = await fetch(`${candidate.url.replace(/\/+$/, '')}/`, { headers: plexServerHeaders(token), signal })
  const text = await res.text()
  if (res.status === 401) throw new Error('it did not accept the sign-in')
  if (!res.ok) throw new Error(`it answered HTTP ${res.status}`)
  let root: { machineIdentifier?: string; friendlyName?: string } | undefined
  try
  {
    root = (JSON.parse(text) as { MediaContainer?: { machineIdentifier?: string; friendlyName?: string } }).MediaContainer
  }
  catch
  {
    root = undefined
  }
  if (!root) throw new Error('the answer did not come from Plex')
  if (candidate.serverId && root.machineIdentifier !== candidate.serverId) throw new Error('a different Plex server answered')
  return root.friendlyName || candidate.serverName || 'Plex server'
}

/**
 * Reads the account's devices from plex.tv.
 *
 * @param token - Plex account token.
 * @returns The devices, or why they could not be read.
 */
async function listResources(token: string): Promise<{ resources: PlexResource[]; error?: string }>
{
  try
  {
    const res = await fetch(RESOURCES_URL, {
      headers: { ...plexTvHeaders(ConfigService.get().clientIdentifier), 'X-Plex-Token': token },
      signal: AbortSignal.timeout(RESOURCES_TIMEOUT_MS),
    })
    if (!res.ok) return { resources: [], error: `plex.tv answered HTTP ${res.status}` }
    const body = await res.json() as unknown
    return { resources: Array.isArray(body) ? body as PlexResource[] : [] }
  }
  catch (err)
  {
    return { resources: [], error: describeNetworkError(err) }
  }
}

/**
 * Finds an address where one of the user's own servers answers from this
 * machine. Multi-homed servers list addresses other machines cannot reach,
 * such as a NAS's container bridge, so every listed address is tried rather
 * than trusting the first local one.
 *
 * @param token - Plex account token.
 * @param options - The saved address to include, and a server name to stay on.
 * @returns The address that answered, if any, with what failed along the way.
 */
export async function findServer(token: string, options: DiscoveryOptions = {}): Promise<DiscoveryResult>
{
  const { resources, error: listError } = await listResources(token)
  const listed = serverCandidates(resources).filter(candidate => !options.serverName || candidate.serverName === options.serverName)
  const candidates = [...listed]
  const saved = options.savedUrl?.trim()
  if (saved && !listed.some(candidate => urlKey(candidate.url) === urlKey(saved)))
  {
    const entry: ServerCandidate = { url: saved, serverName: options.serverName ?? '' }
    if (urlKey(saved) === urlKey(DEFAULT_SERVER_URL)) candidates.push(entry)
    else candidates.unshift(entry)
  }
  const outcome = await firstReachable(candidates, (candidate, signal) => probeServer(candidate, token, signal))
  return {
    server: outcome.winner,
    listed: [...new Set(listed.map(candidate => candidate.serverName))],
    failures: outcome.failures,
    listError,
  }
}
