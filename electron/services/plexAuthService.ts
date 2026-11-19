import type { BrowserWindow } from 'electron'
import { ConfigService } from './config'
import { Logger } from './logger'
import { PlexService } from './plexService'
import { findServer, plexTvHeaders } from './plexConnections'
import type { PlexAuthStatus } from '../ipc/types'
import { isWebMode } from '../runtime/runtime'

const PLEX_TV = 'https://plex.tv'
const POLL_INTERVAL_MS = 2000
const POLL_MAX_ATTEMPTS = 150

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

function stopPoll() {
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
}

/** Handles the plex.tv PIN auth flow, token storage, and server auto-discovery. */
export const PlexAuthService = {
  /**
   * Starts the plex.tv PIN flow: requests a strong PIN, opens the auth URL on
   * the desktop (the web UI shows it instead), and returns the waiting status
   * at once while polling continues until the user authorizes or it times out.
   *
   * @param _win - Unused; kept for the IPC call signature.
   * @param onStatus - Receives status updates to forward to the renderer.
   * @returns The waiting status, carrying the PIN and auth URL.
   */
  async beginSignIn(
    _win: BrowserWindow | null,
    onStatus: (status: PlexAuthStatus) => void,
  ): Promise<PlexAuthStatus> {
    stopPoll()
    if (_activeSignIn) throw new Error('Sign-in already in progress')

    const clientId = ConfigService.get().clientIdentifier
    const hdrs = plexTvHeaders(clientId)

    onStatus({ status: 'waiting' })

    const pinRes = await fetch(`${PLEX_TV}/api/v2/pins`, {
      method: 'POST',
      headers: { ...hdrs, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'strong=true',
    })
    if (!pinRes.ok) throw new Error(`PIN request failed: ${pinRes.status}`)
    const pin = await pinRes.json() as { id: number; code: string }

    const authUrl =
      `https://app.plex.tv/auth#?` +
      `clientID=${encodeURIComponent(clientId)}` +
      `&code=${encodeURIComponent(pin.code)}` +
      `&context[device][product]=${encodeURIComponent('Plex Poster Set Helper 2')}`

    const waitingStatus: PlexAuthStatus = { status: 'waiting', pin: pin.code, authUrl }

    Logger.info('PlexAuth', `PIN flow started - code: ${pin.code}`)
    onStatus(waitingStatus)

    if (!isWebMode()) {
      try {
        const { shell } = require('electron') as typeof import('electron')
        await shell.openExternal(authUrl)
      } catch (err) {
        Logger.warn('PlexAuth', `Could not open a browser automatically - use the link shown in the app: ${err instanceof Error ? err.message : err}`)
      }
    }

    _activeSignIn = new Promise<string>((resolve, reject) => {
      _signInReject = reject
      let attempts = 0

      _pollTimer = setInterval(async () => {
        attempts++
        if (attempts >= POLL_MAX_ATTEMPTS) {
          stopPoll()
          Logger.warn('PlexAuth', 'Auth timed out after 5 minutes')
          onStatus({ status: 'timeout' })
          reject(new Error('Plex auth timed out (5 minutes)'))
          return
        }

        try {
          const checkRes = await fetch(`${PLEX_TV}/api/v2/pins/${pin.id}`, { headers: hdrs })
          if (!checkRes.ok) return
          const data = await checkRes.json() as { authToken?: string }
          if (data.authToken) {
            stopPoll()
            await PlexAuthService._finalize(data.authToken, hdrs, onStatus)
            resolve(data.authToken)
          }
        } catch {
          // transient network error - keep polling
        }
      }, POLL_INTERVAL_MS)
    }).finally(() => {
      _activeSignIn = null
      _signInReject = null
    })

    return waitingStatus
  },

  /** Awaits the in-flight sign-in started by beginSignIn. */
  waitForActiveSignIn(): Promise<string> {
    if (!_activeSignIn) return Promise.reject(new Error('No sign-in in progress'))
    return _activeSignIn
  },

  /**
   * Finalizes auth: saves the token, fetches account info, and connects to
   * the user's server.
   *
   * @param token - Token returned by the PIN poll.
   * @param hdrs - X-Plex headers from plexTvHeaders().
   * @param onStatus - Receives the final authorized status.
   */
  async _finalize(
    token: string,
    hdrs: Record<string, string>,
    onStatus: (status: PlexAuthStatus) => void,
  )
  {
    try
    {
      const userRes = await fetch(`${PLEX_TV}/api/v2/user`, {
        headers: { ...hdrs, 'X-Plex-Token': token },
      })
      if (userRes.ok)
      {
        const user = await userRes.json() as {
          username?: string; friendlyName?: string; email?: string; thumb?: string
        }
        ConfigService.set({
          token,
          plexAccountName:  user.username ?? user.friendlyName ?? '',
          plexAccountEmail: user.email ?? '',
          plexAccountThumb: user.thumb ?? '',
        })
        Logger.success('PlexAuth', `Authenticated as ${user.username ?? user.friendlyName ?? 'unknown'}`)
      }
      else
      {
        ConfigService.set({ token })
        Logger.success('PlexAuth', 'Authenticated (user info unavailable)')
      }
    }
    catch
    {
      ConfigService.set({ token })
      Logger.success('PlexAuth', 'Authenticated (user info fetch failed)')
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

    onStatus({ status: 'authorized', token, serverName: server.serverName, serverError: server.serverError })
  },

  /** Cancels an in-progress sign-in poll. */
  cancel() {
    stopPoll()
    _signInReject?.(new Error('Sign-in cancelled'))
    Logger.info('PlexAuth', 'Auth flow cancelled by user')
  },

  /** Clears the stored token and account info. */
  async disconnect() {
    stopPoll()
    ConfigService.set({
      token: '',
      plexAccountName: '',
      plexAccountEmail: '',
      plexAccountThumb: '',
    })
    Logger.info('PlexAuth', 'Disconnected from Plex')
  },

  /**
   * Returns the current auth status derived from the stored token.
   *
   * @returns authorized when a token is stored, otherwise idle.
   */
  getStatus(): PlexAuthStatus {
    const cfg = ConfigService.get()
    return cfg.token ? { status: 'authorized' } : { status: 'idle' }
  },
}
