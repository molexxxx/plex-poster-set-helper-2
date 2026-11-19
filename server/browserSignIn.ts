import { randomBytes } from 'crypto'
import { ConfigService } from '../electron/services/config'
import { Logger } from '../electron/services/logger'
import { describeNetworkError } from '../electron/services/plexConnections'
import { PlexAuthService, checkPin, readAccount, requestPin } from '../electron/services/plexAuthService'
import { appEvents } from '../electron/runtime/events'
import type { PlexAuthStatus } from '../electron/ipc/types'

/** How long a browser has to approve its sign-in, matching the desktop flow. */
const FLOW_TTL_MS = 5 * 60_000
/** plex.tv is asked about a PIN at most this often, however fast the browser polls. */
const CHECK_INTERVAL_MS = 1500
const MAX_FLOWS = 20

export const WRONG_ACCOUNT = 'This app is linked to a different Plex account. Sign in with the account that set it up.'
export const OWNER_UNKNOWN = 'Could not confirm which Plex account this app belongs to. Try again in a moment.'

interface Flow
{
  pinId: number
  createdAt: number
  checkedAt: number
  status: PlexAuthStatus
  checking?: Promise<PlexAuthStatus>
}

const _flows = new Map<string, Flow>()
let _completing: Promise<unknown> = Promise.resolve()

/** Drops flows nobody has asked about since they ended. */
function sweep(): void
{
  const now = Date.now()
  for (const [id, flow] of _flows)
  {
    if (now - flow.createdAt > FLOW_TTL_MS * 2) _flows.delete(id)
  }
}

/**
 * Finishes a flow whose PIN was approved: the first account to sign in on an
 * install with no owner becomes its owner, the owner gets in, and any other
 * account is refused without touching the stored token.
 *
 * @param token - Token for the account that approved the PIN.
 * @returns The flow's final status.
 */
async function complete(token: string): Promise<PlexAuthStatus>
{
  let account
  try
  {
    account = await readAccount(token)
  }
  catch (err)
  {
    return { status: 'error', error: `Could not read your Plex account: ${describeNetworkError(err)}` }
  }
  const owner = await PlexAuthService.ownerAccountId()
  if (owner === null) return { status: 'error', error: OWNER_UNKNOWN }
  if (owner && owner !== account.id)
  {
    Logger.warn('Auth', 'Refused a web sign-in from a Plex account that does not own this app')
    return { status: 'error', error: WRONG_ACCOUNT }
  }
  if (!ConfigService.get().token)
  {
    await PlexAuthService._finalize(token, status => appEvents.emitEvent('auth:statusChange', status), account)
  }
  else
  {
    await PlexAuthService.refreshOwnerToken(token, account)
  }
  Logger.info('Auth', `Web sign-in by ${account.username ?? account.friendlyName ?? 'the owner'}`)
  return { status: 'authorized' }
}

/**
 * Asks plex.tv about a flow's PIN and moves the flow on when it was approved.
 *
 * @param flow - The waiting flow.
 * @returns The flow's status after the check.
 */
async function check(flow: Flow): Promise<PlexAuthStatus>
{
  flow.checkedAt = Date.now()
  const token = await checkPin(flow.pinId).catch(() => null)
  if (!token) return flow.status
  const run = _completing.then(() => complete(token))
  _completing = run.catch(() => undefined)
  flow.status = await run
  return flow.status
}

/** Sign-in flows for web UI browsers, one per browser, tracked by a cookie. */
export const BrowserSignIn = {
  /**
   * Starts a sign-in for one browser. When too many are open, the oldest is
   * dropped rather than refusing new ones, so nobody can lock the owner out
   * by opening sign-ins.
   *
   * @returns The flow id for the browser's cookie, and the waiting status with the plex.tv link.
   * @throws When plex.tv cannot create a PIN.
   */
  async start(): Promise<{ id: string; status: PlexAuthStatus }>
  {
    sweep()
    while (_flows.size >= MAX_FLOWS)
    {
      const oldest = _flows.keys().next().value
      if (oldest === undefined) break
      _flows.delete(oldest)
    }
    const pin = await requestPin()
    const id = randomBytes(24).toString('base64url')
    const status: PlexAuthStatus = { status: 'waiting', pin: pin.code, authUrl: pin.authUrl }
    _flows.set(id, { pinId: pin.id, createdAt: Date.now(), checkedAt: 0, status })
    return { id, status }
  },

  /**
   * Reports a browser's sign-in, checking plex.tv when it is due.
   *
   * @param id - Flow id from the browser's cookie.
   * @returns The status, or null when the browser has no sign-in under way.
   */
  async status(id: string): Promise<PlexAuthStatus | null>
  {
    const flow = _flows.get(id)
    if (!flow) return null
    if (flow.status.status !== 'waiting') return flow.status
    if (Date.now() - flow.createdAt > FLOW_TTL_MS)
    {
      flow.status = { status: 'timeout' }
      return flow.status
    }
    if (flow.checking) return flow.checking
    if (Date.now() - flow.checkedAt < CHECK_INTERVAL_MS) return flow.status
    flow.checking = check(flow).finally(() =>
    {
      flow.checking = undefined
    })
    return flow.checking
  },

  /**
   * Forgets one browser's sign-in.
   *
   * @param id - Flow id from the browser's cookie.
   */
  cancel(id: string): void
  {
    _flows.delete(id)
  },

  /** Forgets every pending sign-in, for when the Plex account is unlinked. */
  cancelAll(): void
  {
    _flows.clear()
  },
}
