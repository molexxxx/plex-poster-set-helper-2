import { Logger } from '../logger'
import { ConfigService } from '../config'
import { describeNetworkError, findServer } from '../plexConnections'
import type { ConnectReq, ConnectRes, Library, LibrarySection } from '../../ipc/types'
import { PlexHttpError, plexFetch, hostOf } from './plexHttp'

interface PlexConnection
{
  baseUrl: string
  token: string
  serverName: string
  libraries: Library[]
}

let _conn: PlexConnection | null = null

/** The connection to the Plex server: connecting, restoring it at launch, and reading its libraries. */
export const plexConnection = {
  /**
   * Returns the active connection.
   *
   * @returns Connection details, or null when not connected.
   */
  getConnection: () => _conn,

  /**
   * Connects to a Plex server, caching its name and library list on success.
   *
   * @param req - Server base URL and token.
   * @returns Success flag with server name and library count, or an error message.
   */
  async connect(req: ConnectReq): Promise<ConnectRes>
  {
    try
    {
      const data = await plexFetch(req.baseUrl, req.token, '/') as { MediaContainer?: { friendlyName?: string } }
      const serverName = data?.MediaContainer?.friendlyName ?? 'Plex Server'
      const libraries = await plexConnection.fetchLibraries(req.baseUrl, req.token)
      _conn = { baseUrl: req.baseUrl, token: req.token, serverName, libraries }
      Logger.success('Plex', `Connected to "${serverName}" - ${libraries.length} libraries`)
      return { success: true, serverName, libraryCount: libraries.length }
    }
    catch (err)
    {
      _conn = null
      if (err instanceof PlexHttpError)
      {
        Logger.error('Plex', `Connection failed: ${err.message}`)
        return { success: false, error: err.message, unreachable: false, status: err.status }
      }
      const error = `Could not reach ${hostOf(req.baseUrl)}: ${describeNetworkError(err, req.baseUrl)}`
      Logger.error('Plex', `Connection failed: ${error}`)
      return { success: false, error, unreachable: true }
    }
  },

  /**
   * Fetches the server's movie and show libraries.
   *
   * @param baseUrl - Server base URL.
   * @param token - Plex auth token.
   * @returns The filtered library list.
   */
  async fetchLibraries(baseUrl: string, token: string): Promise<Library[]>
  {
    const data = await plexFetch(baseUrl, token, '/library/sections') as {
      MediaContainer?: { Directory?: Array<{ key: string; title: string; type: string; agent?: string }> }
    }
    return (data?.MediaContainer?.Directory ?? [])
      .filter(d => d.type === 'movie' || d.type === 'show')
      .map(d => ({ key: d.key, title: d.title, type: d.type as 'movie' | 'show', agent: d.agent }))
  },

  /**
   * Returns the item count for a library section without fetching its items.
   *
   * @param key - Section key.
   * @param type - Section media type.
   * @returns The total item count, or 0 when not connected.
   */
  async getLibraryCount(key: string, type: 'movie' | 'show'): Promise<number>
  {
    if (!_conn) return 0
    const { baseUrl, token } = _conn
    const plexType = type === 'movie' ? 1 : 2
    const data = await plexFetch(
      baseUrl, token,
      `/library/sections/${key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0&type=${plexType}`,
    ) as { MediaContainer?: { totalSize?: number; size?: number } }
    return data?.MediaContainer?.totalSize ?? data?.MediaContainer?.size ?? 0
  },

  /**
   * Returns browsable movie/show sections, honouring the excluded-libraries
   * setting.
   *
   * @returns Sections available to the library browser.
   */
  async getSections(): Promise<LibrarySection[]>
  {
    if (!_conn) return []
    const excluded = ConfigService.get().excludedLibraries ?? []
    return _conn.libraries
      .filter(l => (l.type === 'movie' || l.type === 'show') && !excluded.includes(l.title))
      .map(l => ({ key: l.key, title: l.title, type: l.type as 'movie' | 'show' }))
  },

  /**
   * Reconnects from saved config at startup and before scheduled runs. When
   * the saved address gets no answer at all, the server is looked up on
   * plex.tv again and an address that answers replaces it, so a changed IP or
   * a stale address picked at sign-in heals itself. A token the server rejects
   * (401) is cleared so the UI asks for sign-in again.
   *
   * @returns Success flag with the server name, or tokenInvalid when re-auth is needed.
   */
  async tryRestoreFromConfig(): Promise<{ success: boolean; serverName?: string; tokenInvalid?: boolean }>
  {
    const cfg = ConfigService.get()
    if (!cfg.baseUrl || !cfg.token) return { success: false }
    const result = await plexConnection.connect({ baseUrl: cfg.baseUrl, token: cfg.token })
    if (result.success) return { success: true, serverName: result.serverName }
    if (result.status === 401)
    {
      ConfigService.set({ token: '', plexAccountName: '', plexAccountEmail: '', plexAccountThumb: '' })
      Logger.warn('Plex', 'Stored token rejected (401) - cleared. Please sign in again.')
      return { success: false, tokenInvalid: true }
    }
    if (!result.unreachable) return { success: false }

    const found = await findServer(cfg.token, { serverName: cfg.plexServerName || undefined })
    if (!found.server) return { success: false }
    const moved = await plexConnection.connect({ baseUrl: found.server.url, token: cfg.token })
    if (!moved.success) return { success: false }
    ConfigService.set({ baseUrl: found.server.url, plexServerName: moved.serverName ?? found.server.serverName })
    if (found.server.url !== cfg.baseUrl)
    {
      Logger.info('Plex', `${cfg.baseUrl} did not answer; switched the server address to ${found.server.url}`)
    }
    return { success: true, serverName: moved.serverName }
  },
}
