import { useCallback, useEffect, useState } from 'react'
import type { AppConfig, Library, PlexAuthStatus } from '../../../../electron/ipc/types'
import type { SettingsConfig } from './useSettingsConfig'

interface PlexAccountOptions
{
  cfg: AppConfig | null
  setCfg: SettingsConfig['setCfg']
  autosave: SettingsConfig['autosave']
  loadConfig: SettingsConfig['loadConfig']
  /** The config as last read; its saved server name is adopted on every read. */
  loaded: SettingsConfig['loaded']
  announce: (message: string) => void
}

/**
 * The Plex sign-in, the server connection, and the server's libraries.
 * Restores the sign-in state on mount, follows sign-in changes made anywhere
 * in the app, and takes the saved server name from each config read.
 *
 * @returns Sign-in and server state, the libraries with their item counts, and the actions on them.
 */
export function usePlexAccount({ cfg, setCfg, autosave, loadConfig, loaded, announce }: PlexAccountOptions)
{
  const [authStatus, setAuthStatus] = useState<PlexAuthStatus>({ status: 'idle' })
  const [signingIn, setSigningIn]   = useState(false)
  const [copiedAuth, setCopiedAuth] = useState(false)

  const [testing, setTesting]                 = useState(false)
  const [testMsg, setTestMsg]                 = useState<{ ok: boolean; msg: string } | null>(null)
  const [serverConnected, setServerConnected] = useState(false)
  const [serverName, setServerName]           = useState('')
  const [editingServer, setEditingServer]     = useState(false)

  const [libraries, setLibraries]        = useState<Library[]>([])
  const [refreshingLibs, setRefreshLibs] = useState(false)
  const [libCounts, setLibCounts]        = useState<Record<string, number>>({})

  // Adjusted during render so the name lands in the same commit as the config it was read with.
  const [adopted, setAdopted] = useState<AppConfig | null>(null)
  if (loaded !== adopted)
  {
    setAdopted(loaded)
    if (loaded?.plexServerName) setServerName(loaded.plexServerName)
  }

  const loadLibraries = useCallback(async () =>
  {
    setRefreshLibs(true)
    try
    {
      const libs = await window.api.plex.getLibraries() as Library[]
      setLibraries(libs)
      if (libs.length > 0) setServerConnected(true)
    }
    finally
    {
      setRefreshLibs(false)
    }
  }, [])

  useEffect(() =>
  {
    if (!libraries.length) return
    setLibCounts({})
    Promise.all(
      libraries.map(lib =>
        (window.api.plex.getLibraryCount as (k: string, t: 'movie' | 'show') => Promise<number>)(lib.key, lib.type as 'movie' | 'show')
          .then(count => [lib.key, count] as const)
          .catch(() => [lib.key, 0] as const)
      )
    ).then(entries => setLibCounts(Object.fromEntries(entries)))
  }, [libraries])

  useEffect(() =>
  {
    // Restore state on every mount (handles navigating away and back)
    window.api.auth.getStatus().then(s =>
    {
      const status = s as PlexAuthStatus
      setAuthStatus(status)
      if (status.status === 'authorized')
      {
        if (status.serverName)
        {
          setServerConnected(true)
          setServerName(status.serverName)
        }
        loadLibraries()
      }
    })

    const off = window.api.auth.onStatusChange((s: PlexAuthStatus) =>
    {
      setAuthStatus(s)
      if (s.status === 'authorized')
      {
        setSigningIn(false)
        loadConfig()
        if (s.serverName)
        {
          setServerConnected(true)
          setServerName(s.serverName)
          loadLibraries()
        }
        else if (s.serverError)
        {
          setTestMsg({ ok: false, msg: s.serverError })
        }
      }
      if (s.status === 'idle')
      {
        setLibraries([])
        setServerConnected(false)
        setServerName('')
        setEditingServer(false)
        setTestMsg(null)
      }
    })
    return () => { off() }
  }, [loadConfig, loadLibraries])

  async function signIn()
  {
    setSigningIn(true)
    setAuthStatus({ status: 'waiting' })
    try
    {
      const authUrl = await window.api.auth.signIn()
      if (authUrl) setAuthStatus(prev => prev.status === 'waiting' ? { ...prev, authUrl } : prev)
    }
    catch
    {
      setSigningIn(false)
      setAuthStatus({ status: 'idle' })
    }
  }

  async function signOut()
  {
    await window.api.auth.disconnect()
    setCfg(prev => prev ? { ...prev, plexServerName: '' } : prev)
    setAuthStatus({ status: 'idle' })
    setLibraries([])
    setServerConnected(false)
    setServerName('')
    setEditingServer(false)
    setTestMsg(null)
    announce('Signed out of Plex')
  }

  async function testConnection()
  {
    if (!cfg) return
    setTesting(true)
    setTestMsg(null)
    try
    {
      const res = await window.api.plex.connect(cfg.baseUrl, cfg.token) as { success: boolean; serverName?: string; error?: string }
      if (res.success)
      {
        const name = res.serverName ?? ''
        setTestMsg({ ok: true, msg: `Connected to ${name || 'your server'}` })
        setServerConnected(true)
        setServerName(name)
        setEditingServer(false)
        await window.api.config.set({ baseUrl: cfg.baseUrl, plexServerName: name })
        setCfg(prev => prev ? { ...prev, baseUrl: cfg.baseUrl, plexServerName: name } : prev)
        await loadLibraries()
      }
      else
      {
        setTestMsg({ ok: false, msg: res.error ?? 'Could not reach the server at that address' })
      }
    }
    catch (err)
    {
      setTestMsg({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    }
    setTesting(false)
  }

  function toggleLibrary(title: string, include: boolean)
  {
    if (!cfg) return
    const current = cfg.excludedLibraries ?? []
    autosave('excludedLibraries', include ? current.filter(t => t !== title) : [...current, title])
  }

  return {
    authStatus, signingIn, setSigningIn, copiedAuth, setCopiedAuth,
    testing, testMsg, setTestMsg, serverConnected, serverName, editingServer, setEditingServer,
    libraries, refreshingLibs, libCounts, loadLibraries, signIn, signOut, testConnection, toggleLibrary,
  }
}

/** The sign-in, server, and library state and actions `usePlexAccount` returns. */
export type PlexAccount = ReturnType<typeof usePlexAccount>
