import type { BrowserWindow } from 'electron'
import { ConfigService } from './config'
import { Logger } from './logger'
import { PlexService } from './plexService'
import type { PlexAuthStatus } from '../ipc/types'
import { isWebMode } from '../runtime/runtime'

const PLEX_TV = 'https://plex.tv'
const POLL_INTERVAL_MS = 2000
const POLL_MAX_ATTEMPTS = 150

/**
 * Builds the standard X-Plex-* headers for plex.tv API requests.
 *
 * @param clientId - Stable per-install client identifier.
 * @returns Header map to spread into fetch options.
 */
function clientHeaders(clientId: string): Record<string, string> {
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
 * Tests whether a connection URI points at a plain address.
 *
 * @param uri - Connection URI from plex.tv resources.
 * @returns true when the host is localhost or a literal IPv4 address.
 */
function isPlainIp(uri: string): boolean {
  try {
    const host = new URL(uri).hostname
    return host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host)
  } catch { return false }
}

/**
 * Discovers the user's primary owned Plex server from plex.tv resources and
 * picks the best connection URI.
 *
 * @param token - Authenticated Plex token.
 * @param hdrs - X-Plex headers from clientHeaders().
 * @returns The server's name and URI, or null when none is found.
 */
async function discoverPrimaryServer(
  token: string,
  hdrs: Record<string, string>,
): Promise<{ name: string; url: string } | null> {
  try {
    const res = await fetch(
      `${PLEX_TV}/api/v2/resources?includeHttps=1&includeIPv6=1&includeRelay=1`,
      { headers: { ...hdrs, 'X-Plex-Token': token } },
    )
    if (!res.ok) return null

    const resources = await res.json() as Array<{
      name: string
      provides: string
      owned: boolean
      connections: Array<{ uri: string; local: boolean; relay: boolean; protocol: string }>
    }>

    const servers = resources.filter(r => r.provides?.includes('server') && r.owned)
    if (!servers.length) return null

    const conns = servers[0].connections
    // Prefer: local plain-IP HTTP > local plain-IP HTTPS > local HTTP > local HTTPS > non-relay > any
    const best =
      conns.find(c => c.local && !c.relay && c.protocol === 'http'  && isPlainIp(c.uri)) ??
      conns.find(c => c.local && !c.relay && c.protocol === 'https' && isPlainIp(c.uri)) ??
      conns.find(c => c.local && !c.relay && c.protocol === 'http') ??
      conns.find(c => c.local && !c.relay) ??
      conns.find(c => !c.relay) ??
      conns[0]

    return best ? { name: servers[0].name, url: best.uri } : null
  } catch {
    return null
  }
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
    const hdrs = clientHeaders(clientId)

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
            await PlexAuthService._finalise(data.authToken, clientId, hdrs, onStatus)
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
   * Finalises auth: saves the token, fetches account info, and auto-discovers
   * the server.
   *
   * @param token - Token returned by the PIN poll.
   * @param clientId - Stable per-install client identifier.
   * @param hdrs - X-Plex headers from clientHeaders().
   * @param onStatus - Receives the final authorized status.
   */
  async _finalise(
    token: string,
    clientId: string,
    hdrs: Record<string, string>,
    onStatus: (status: PlexAuthStatus) => void,
  ) {
    try {
      const userRes = await fetch(`${PLEX_TV}/api/v2/user`, {
        headers: { ...hdrs, 'X-Plex-Token': token },
      })
      if (userRes.ok) {
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
      } else {
        ConfigService.set({ token })
        Logger.success('PlexAuth', 'Authenticated (user info unavailable)')
      }
    } catch {
      ConfigService.set({ token })
      Logger.success('PlexAuth', 'Authenticated (user info fetch failed)')
    }

    let serverName: string | undefined
    try {
      const discovered = await discoverPrimaryServer(token, hdrs)
      if (discovered) {
        Logger.info('PlexAuth', `Discovered server "${discovered.name}" at ${discovered.url}`)
        const result = await PlexService.connect({ baseUrl: discovered.url, token })
        if (result.success) {
          serverName = result.serverName
          ConfigService.set({ baseUrl: discovered.url, plexServerName: result.serverName ?? discovered.name })
          Logger.success('PlexAuth', `Auto-connected to "${result.serverName}"`)
        } else {
          // Discovery found it but couldn't connect - save URL for user to retry
          ConfigService.set({ baseUrl: discovered.url })
          Logger.warn('PlexAuth', `Auto-connect failed: ${result.error}`)
        }
      }
    } catch {
      // Server discovery is best-effort - never block auth
    }

    onStatus({ status: 'authorized', token, serverName })
    void clientId
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
