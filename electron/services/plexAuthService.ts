import type { BrowserWindow } from 'electron'
import { ConfigService } from './config'
import { Logger } from './logger'
import { PlexService } from './plexService'
import { describeNetworkError, findServer, plexTvHeaders } from './plexConnections'
import type { PlexAuthStatus } from '../ipc/types'
import { isWebMode } from '../runtime/runtime'

const PLEX_TV = 'https://plex.tv'
const POLL_INTERVAL_MS = 2000
const POLL_MAX_ATTEMPTS = 150
const PLEX_TV_TIMEOUT_MS = 15_000

/** The Plex account a token belongs to. */
export interface PlexAccount
{
  /** plex.tv account id, as a string. */
  id: string
  username?: string
  friendlyName?: string
  email?: string
  thumb?: string
}

/** A plex.tv sign-in PIN and the link that approves it. */
export interface SignInPin
{
  id: number
  code: string
  authUrl: string
}

/**
 * Creates a plex.tv sign-in PIN and the link that approves it.
 *
 * @returns The PIN id, its code, and the plex.tv link to open.
 * @throws When plex.tv refuses or cannot be reached.
 */
export async function requestPin(): Promise<SignInPin>
{
  const clientId = ConfigService.get().clientIdentifier
  const res = await fetch(`${PLEX_TV}/api/v2/pins`, {
    method: 'POST',
    headers: { ...plexTvHeaders(clientId), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'strong=true',
    signal: AbortSignal.timeout(PLEX_TV_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`PIN request failed: ${res.status}`)
  const pin = await res.json() as { id: number; code: string }
  const authUrl =
    `https://app.plex.tv/auth#?` +
    `clientID=${encodeURIComponent(clientId)}` +
    `&code=${encodeURIComponent(pin.code)}` +
    `&context[device][product]=${encodeURIComponent('Plex Poster Set Helper 2')}`
  return { id: pin.id, code: pin.code, authUrl }
}

/**
 * Asks plex.tv whether a sign-in PIN has been approved.
 *
 * @param pinId - The PIN from requestPin().
 * @returns The new account token once approved, otherwise null.
 */
export async function checkPin(pinId: number): Promise<string | null>
{
  const res = await fetch(`${PLEX_TV}/api/v2/pins/${pinId}`, {
    headers: plexTvHeaders(ConfigService.get().clientIdentifier),
    signal: AbortSignal.timeout(PLEX_TV_TIMEOUT_MS),
  })
  if (!res.ok) return null
  const data = await res.json() as { authToken?: string | null }
  return data.authToken || null
}

/**
 * Reads the Plex account a token belongs to.
 *
 * @param token - Plex account token.
 * @returns The account, with its id as a string.
 * @throws When plex.tv rejects the token, cannot be reached, or names no account.
 */
export async function readAccount(token: string): Promise<PlexAccount>
{
  const res = await fetch(`${PLEX_TV}/api/v2/user`, {
    headers: { ...plexTvHeaders(ConfigService.get().clientIdentifier), 'X-Plex-Token': token },
    signal: AbortSignal.timeout(PLEX_TV_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`plex.tv answered HTTP ${res.status}`)
  const user = await res.json() as {
    id?: number | string; uuid?: string; username?: string; friendlyName?: string; email?: string; thumb?: string
  }
  const id = user.id != null ? String(user.id) : user.uuid ?? ''
  if (!id) throw new Error('plex.tv did not say which account this is')
  return { id, username: user.username, friendlyName: user.friendlyName, email: user.email, thumb: user.thumb }
}

/**
 * Builds the account fields saved in config.
 *
 * @param account - The account read from plex.tv.
 * @returns Config fields for its id, name, email, and avatar.
 */
function accountFields(account: PlexAccount)
{
  return {
    plexAccountId: account.id,
    plexAccountName: account.username ?? account.friendlyName ?? '',
    plexAccountEmail: account.email ?? '',
    plexAccountThumb: account.thumb ?? '',
  }
}

/**
 * Connects to the user's server after sign-in. The saved address is kept when
 * it still answers; otherwise every address plex.tv lists is tried. An address
 * that does not answer is never saved, so settings keep what worked before.
 *
 * @param token - The new account token.
 * @returns The connected server's name, or why no address answered.
 */
async function connectAfterSignIn(token: string): Promise<{ serverName?: string; serverError?: string }>
{
  const found = await findServer(token, { savedUrl: ConfigService.get().baseUrl })
  if (found.listError) Logger.warn('PlexAuth', `Could not read your server list from plex.tv: ${found.listError}`)
  for (const failure of found.failures)
  {
    Logger.info('PlexAuth', `No answer from ${failure.url}: ${failure.reason}`)
  }
  if (!found.server)
  {
    const serverError = found.listed.length
      ? `${found.listed[0]} did not answer at any address Plex lists for it. Enter the address you reach it at on this network.`
      : found.listError
        ? 'Could not get your server list from plex.tv. Enter your server address.'
        : 'No Plex server you own was found on this account. Enter your server address.'
    Logger.warn('PlexAuth', serverError)
    return { serverError }
  }
  Logger.info('PlexAuth', `Found "${found.server.serverName}" at ${found.server.url}`)
  const result = await PlexService.connect({ baseUrl: found.server.url, token })
  if (!result.success) return { serverError: result.error }
  const serverName = result.serverName ?? found.server.serverName
  ConfigService.set({ baseUrl: found.server.url, plexServerName: serverName })
  Logger.success('PlexAuth', `Auto-connected to "${serverName}"`)
  return { serverName }
}

let _pollTimer: ReturnType<typeof setInterval> | null = null
let _activeSignIn: Promise<string> | null = null
let _signInReject: ((err: Error) => void) | null = null

function stopPoll()
{
  if (_pollTimer)
  {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
}

/** Handles the plex.tv PIN auth flow, token storage, and server auto-discovery. */
export const PlexAuthService = {
  /**
   * Starts the desktop sign-in: requests a strong PIN, opens the auth URL,
   * and returns the waiting status at once while polling continues until the
   * user approves or it times out. A sign-in already running is canceled
   * first. The web UI signs browsers in through its own per-browser flow.
   *
   * @param _win - Unused; kept for the IPC call signature.
   * @param onStatus - Receives status updates to forward to the renderer.
   * @returns The waiting status, carrying the PIN and auth URL.
   */
  async beginSignIn(
    _win: BrowserWindow | null,
    onStatus: (status: PlexAuthStatus) => void,
  ): Promise<PlexAuthStatus>
  {
    if (_activeSignIn)
    {
      PlexAuthService.cancel()
      await _activeSignIn.catch(() => undefined)
    }

    onStatus({ status: 'waiting' })
    const pin = await requestPin()
    const waitingStatus: PlexAuthStatus = { status: 'waiting', pin: pin.code, authUrl: pin.authUrl }

    Logger.info('PlexAuth', `PIN flow started - code: ${pin.code}`)
    onStatus(waitingStatus)

    if (!isWebMode())
    {
      try
      {
        const { shell } = require('electron') as typeof import('electron')
        await shell.openExternal(pin.authUrl)
      }
      catch (err)
      {
        Logger.warn('PlexAuth', `Could not open a browser automatically - use the link shown in the app: ${err instanceof Error ? err.message : err}`)
      }
    }

    _activeSignIn = new Promise<string>((resolve, reject) =>
    {
      _signInReject = reject
      let attempts = 0

      _pollTimer = setInterval(async () =>
      {
        attempts++
        if (attempts >= POLL_MAX_ATTEMPTS)
        {
          stopPoll()
          Logger.warn('PlexAuth', 'Auth timed out after 5 minutes')
          onStatus({ status: 'timeout' })
          reject(new Error('Plex auth timed out (5 minutes)'))
          return
        }

        try
        {
          const token = await checkPin(pin.id)
          if (token)
          {
            stopPoll()
            await PlexAuthService._finalize(token, onStatus)
            resolve(token)
          }
        }
        catch
        {
          // A failed check is retried on the next tick.
        }
      }, POLL_INTERVAL_MS)
    }).finally(() =>
    {
      _activeSignIn = null
      _signInReject = null
    })

    return waitingStatus
  },

  /** Awaits the in-flight sign-in started by beginSignIn. */
  waitForActiveSignIn(): Promise<string>
  {
    if (!_activeSignIn) return Promise.reject(new Error('No sign-in in progress'))
    return _activeSignIn
  },

  /**
   * Finalizes auth: saves the token and the account it belongs to, then
   * connects to the user's server.
   *
   * @param token - Token returned by the PIN poll.
   * @param onStatus - Receives the final authorized status.
   * @param account - The token's account when the caller already read it.
   */
  async _finalize(
    token: string,
    onStatus: (status: PlexAuthStatus) => void,
    account?: PlexAccount,
  )
  {
    let user = account
    if (!user)
    {
      try
      {
        user = await readAccount(token)
      }
      catch (err)
      {
        Logger.warn('PlexAuth', `Could not read the Plex account: ${describeNetworkError(err)}`)
      }
    }
    if (user)
    {
      ConfigService.set({ token, ...accountFields(user) })
      Logger.success('PlexAuth', `Authenticated as ${user.username ?? user.friendlyName ?? 'unknown'}`)
    }
    else
    {
      ConfigService.set({ token })
      Logger.success('PlexAuth', 'Authenticated (account details unavailable)')
    }

    let server: { serverName?: string; serverError?: string }
    try
    {
      server = await connectAfterSignIn(token)
    }
    catch (err)
    {
      server = { serverError: err instanceof Error ? err.message : String(err) }
    }

    onStatus({ status: 'authorized', serverName: server.serverName, serverError: server.serverError })
  },

  /**
   * Returns the plex.tv id of the account this install belongs to. Installs
   * signed in by older versions did not save it, so it is read once with the
   * stored token.
   *
   * @returns The id, '' when no account is linked, or null when it could not be read.
   */
  async ownerAccountId(): Promise<string | null>
  {
    const cfg = ConfigService.get()
    if (cfg.plexAccountId) return cfg.plexAccountId
    if (!cfg.token) return ''
    try
    {
      const account = await readAccount(cfg.token)
      ConfigService.set(accountFields(account))
      return account.id
    }
    catch (err)
    {
      Logger.warn('PlexAuth', `Could not read the linked Plex account: ${describeNetworkError(err)}`)
      return null
    }
  },

  /**
   * Stores a newer token from the owner's own sign-in. plex.tv may replace the
   * previous token for this install when it issues one, so the newest is kept
   * and the server connection moves to it.
   *
   * @param token - Token from the owner's browser sign-in.
   * @param account - The owner's account, already checked by the caller.
   */
  async refreshOwnerToken(token: string, account: PlexAccount): Promise<void>
  {
    const previous = ConfigService.get().token
    ConfigService.set({ token, ...accountFields(account) })
    if (token === previous) return
    const conn = PlexService.getConnection()
    if (conn) await PlexService.connect({ baseUrl: conn.baseUrl, token })
  },

  /** Cancels an in-progress sign-in poll. */
  cancel()
  {
    stopPoll()
    _signInReject?.(new Error('Sign-in cancelled'))
    Logger.info('PlexAuth', 'Auth flow cancelled by user')
  },

  /** Unlinks the Plex account: clears the stored token, the account, and the server name. */
  async disconnect()
  {
    stopPoll()
    ConfigService.set({
      token: '',
      plexAccountId: '',
      plexAccountName: '',
      plexAccountEmail: '',
      plexAccountThumb: '',
      plexServerName: '',
    })
    Logger.info('PlexAuth', 'Disconnected from Plex')
  },

  /**
   * Returns the current auth status derived from the stored token.
   *
   * @returns authorized when a token is stored, otherwise idle.
   */
  getStatus(): PlexAuthStatus
  {
    const cfg = ConfigService.get()
    return cfg.token ? { status: 'authorized' } : { status: 'idle' }
  },
}
