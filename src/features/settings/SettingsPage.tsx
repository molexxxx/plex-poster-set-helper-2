import { useEffect, useState, useCallback, useRef, useId } from 'react'
import {
  LogIn, LogOut, RefreshCw, Pencil, X, Server, Image as ImageIcon, AppWindow, Wrench,
  CheckCircle2, AlertTriangle, Film, Tv, Copy, ExternalLink, FolderOpen, Trash2,
  Download, RotateCcw, Globe, BookOpen, Eye, EyeOff, ChevronDown, type LucideIcon,
} from 'lucide-react'
import Button from '../../components/ui/Button'
import Spinner from '../../components/ui/Spinner'
import Switch from '../../components/ui/Switch'
import Select from '../../components/ui/Select'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Segmented from '../../components/ui/Segmented'
import { useUpdater } from '../updater/UpdaterContext'
import DockerUpdateModal from '../updater/DockerUpdateModal'
import { useNavStore } from '../../app/navStore'
import { DEFAULT_QUICK_CRON, QUICK_SCHEDULES, describeCron } from '../../../electron/services/scheduleUtils'
import { useAppContext } from '../../app/AppContext'
import type {
  AppConfig, AppEnv, Library, PlexAuthStatus, BrowserStatus, BrowserActionResult, BrowserInstallError,
  BrowserSource, NavDockMode, SchedulerEngineStatus,
} from '../../../electron/ipc/types'
import styles from './SettingsPage.module.css'

type GroupId = 'plex' | 'artwork' | 'app' | 'advanced'

const GROUPS: Array<{ id: GroupId; label: string; Icon: LucideIcon; description: string }> = [
  { id: 'plex',     label: 'Plex',     Icon: Server,    description: 'Your account, your server, and the libraries the app works on.' },
  { id: 'artwork',  label: 'Artwork',  Icon: ImageIcon, description: 'What gets applied to Plex and how titles are matched.' },
  { id: 'app',      label: 'App',      Icon: AppWindow, description: 'Navigation, the tray, startup, and updates.' },
  { id: 'advanced', label: 'Advanced', Icon: Wrench,    description: 'Download speed, the browser engine, logs, and cached data.' },
]

/** Which group holds each command-palette deep-link anchor. */
const ANCHOR_GROUP: Record<string, GroupId> = {
  'plex-account': 'plex', 'plex-server': 'plex', libraries: 'plex',
  'mediux-filters': 'artwork', collections: 'artwork', 'quick-sync': 'artwork', tmdb: 'artwork',
  general: 'app', application: 'app', legacy: 'app',
  scraper: 'advanced', browser: 'advanced', logs: 'advanced',
}

const SOURCE_LABELS: Record<BrowserSource, string> = {
  bundled: 'Bundled with the app',
  managed: 'Downloaded copy',
  system: 'System browser',
  custom: 'Custom path',
}

const NAV_DOCK_OPTIONS: Array<{ value: NavDockMode; label: string }> = [
  { value: 'auto', label: 'Automatic' },
  { value: 'floating', label: 'Floating' },
  { value: 'bar', label: 'Status bar' },
]

const WORKER_OPTIONS = Array.from({ length: 8 }, (_, i) => {
  const n = i + 1
  return { value: String(n), label: n === 1 ? '1 (gentlest)' : n === 8 ? '8 (fastest)' : String(n) }
})

const ASSET_TYPES = [
  { type: 'poster',     name: 'Posters',     desc: 'Movie, show, season, and collection covers' },
  { type: 'backdrop',   name: 'Backdrops',   desc: 'Wide background art behind a title' },
  { type: 'title_card', name: 'Title cards', desc: 'Episode thumbnails for TV shows' },
] as const

/**
 * Maps a Plex agent identifier to a short display label.
 *
 * @param agent - Agent id such as com.plexapp.agents.hama.
 * @returns A label like "HAMA", or an empty string.
 */
function agentLabel(agent: string | undefined): string {
  if (!agent) return ''
  if (agent.includes('hama'))       return 'HAMA agent'
  if (agent.includes('themoviedb')) return 'TMDB agent'
  if (agent.includes('thetvdb'))    return 'TheTVDB agent'
  if (agent.includes('plex'))       return 'Plex agent'
  return agent.split('.').pop() ?? ''
}

/**
 * Pulls the Chromium build number out of a Playwright executable path, e.g.
 * ...\chromium_headless_shell-1223\... -> "1223".
 *
 * @param p - Executable path.
 * @returns The build number, or null when absent.
 */
function chromiumBuild(p?: string): string | null {
  if (!p) return null
  const m = p.match(/chromium\w*-(\d+)/i)
  return m ? m[1] : null
}

/** A titled group of settings rows. */
function Block({ title, description, action, anchor, children }: {
  title: string
  description?: string
  action?: React.ReactNode
  /** Deep-link target used by the command palette. */
  anchor?: string
  children: React.ReactNode
}) {
  const titleId = useId()
  return (
    <section className={styles.block} data-anchor={anchor} aria-labelledby={titleId}>
      <div className={styles.blockHead}>
        <h3 id={titleId} className={styles.blockTitle}>{title}</h3>
        {action}
      </div>
      {description && <p className={styles.blockDesc}>{description}</p>}
      <div className={styles.list}>{children}</div>
    </section>
  )
}

/**
 * One settings row: label and description on the left, its control on the right.
 *
 * @param stacked - Put the control under the text, for wide inputs and lists.
 * @param children - The control, or a function given the label and description
 *   ids so the control can name itself after the row.
 */
function Row({ label, description, stacked, children }: {
  label: React.ReactNode
  description?: React.ReactNode
  stacked?: boolean
  children?: React.ReactNode | ((ids: { labelId: string; descId: string }) => React.ReactNode)
}) {
  const labelId = useId()
  const descId = useId()
  const control = typeof children === 'function' ? children({ labelId, descId }) : children
  return (
    <div className={`${styles.row} ${stacked ? styles.rowStacked : ''}`}>
      <div className={styles.rowText}>
        <span id={labelId} className={styles.rowLabel}>{label}</span>
        {description && <span id={descId} className={styles.rowDesc}>{description}</span>}
      </div>
      {control && <div className={styles.rowControl}>{control}</div>}
    </div>
  )
}

/** Version and update rows. */
function AboutBlock({ env, announce }: { env: AppEnv | null; announce: (message: string) => void }) {
  const { status, info, version, mode, lastChecked, check, download, restart } = useUpdater()
  const [checking, setChecking] = useState(false)
  const [upToDate, setUpToDate] = useState(false)
  const [showDockerGuide, setShowDockerGuide] = useState(false)
  const isDocker = mode === 'docker'
  const devBuild = !!env && !env.packaged && !env.web

  async function onCheck() {
    setChecking(true)
    setUpToDate(false)
    const res = await check()
    setChecking(false)
    if (!res.available) {
      setUpToDate(true)
      announce('You have the latest version')
    }
  }

  const versionNote = devBuild
    ? 'Development build'
    : env?.web
      ? 'Running in Docker'
      : lastChecked
        ? `Last checked for updates at ${new Date(lastChecked).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : 'Not checked for updates yet'
  const updateNote = devBuild
    ? 'Development builds do not update themselves'
    : isDocker
      ? 'The Docker image updates when you pull a new one'
      : upToDate
        ? 'You have the latest version'
        : 'Checks GitHub for a newer release'

  return (
    <Block title="About" anchor="application">
      <Row label="Version" description={versionNote}>
        <span className={styles.versionTag}>v{version || '…'}</span>
      </Row>
      <Row label="Updates" description={updateNote}>
        {isDocker && status === 'available' && (
          <Button variant="primary" size="sm" icon={<BookOpen size={13} />} onClick={() => setShowDockerGuide(true)}>
            How to update to v{info?.version}
          </Button>
        )}
        {!isDocker && status === 'available' && (
          <Button variant="primary" size="sm" icon={<Download size={13} />} onClick={download}>
            Download v{info?.version}
          </Button>
        )}
        {!isDocker && status === 'downloading' && <span className={styles.inlineStatus}><Spinner size="xs" /> Downloading…</span>}
        {!isDocker && status === 'ready' && (
          <Button variant="primary" size="sm" icon={<RefreshCw size={13} />} onClick={restart}>
            Relaunch to update
          </Button>
        )}
        {(status === 'idle' || status === 'checking' || (isDocker && status !== 'available')) && !devBuild && (
          <Button
            variant="secondary" size="sm"
            icon={checking ? <Spinner size="xs" color="current" /> : <RefreshCw size={13} />}
            onClick={onCheck}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
        )}
      </Row>
      <DockerUpdateModal open={showDockerGuide} onClose={() => setShowDockerGuide(false)} version={info?.version} />
    </Block>
  )
}

/** Settings: Plex connection, artwork options, app behavior, and advanced maintenance, one group at a time. */
export default function SettingsPage() {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [group, setGroup] = useState<GroupId>('plex')
  const rootRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Record<GroupId, HTMLButtonElement | null>>({ plex: null, artwork: null, app: null, advanced: null })

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

  const [savedTmdbKey, setSavedTmdbKey] = useState('')
  const [showKey, setShowKey]           = useState(false)

  const [browserStatus, setBrowserStatus]         = useState<BrowserStatus | null>(null)
  const [browserInstalling, setBrowserInstalling] = useState(false)
  const [installLog, setInstallLog]               = useState<string[]>([])
  const [copiedPath, setCopiedPath]               = useState(false)
  const [engineOpen, setEngineOpen]               = useState(false)
  const installLogRef = useRef<HTMLDivElement>(null)

  const [env, setEnv]             = useState<AppEnv | null>(null)
  const [autoStart, setAutoStart] = useState(false)
  const [engine, setEngine]       = useState<SchedulerEngineStatus>({ external: false })

  const [confirm, setConfirm]               = useState<'signout' | 'caches' | null>(null)
  const [logsCleared, setLogsCleared]       = useState(false)
  const [cachesCleared, setCachesCleared]   = useState(false)
  const [clearingCaches, setClearingCaches] = useState(false)
  const [announcement, setAnnouncement]     = useState('')

  const { navDock, setNavDock, showLegacyTools, setShowLegacyTools } = useAppContext()
  const isWeb = !!env?.web

  const announce = useCallback((message: string) => {
    setAnnouncement('')
    setTimeout(() => setAnnouncement(message), 30)
  }, [])

  /** Shows a group and returns the page to its top. */
  const openGroup = useCallback((id: GroupId) => {
    setGroup(id)
    rootRef.current?.parentElement?.scrollTo({ top: 0 })
  }, [])

  // Command-palette deep link: open the group that holds the anchor, then bring it into view.
  const settingsAnchor = useNavStore(s => s.settingsAnchor)
  const clearSettings  = useNavStore(s => s.clearSettings)
  useEffect(() => {
    if (!settingsAnchor || !cfg) return
    const id = settingsAnchor
    let reveal: ReturnType<typeof setTimeout> | undefined
    const open = setTimeout(() => {
      openGroup(ANCHOR_GROUP[id] ?? 'plex')
      reveal = setTimeout(() => {
        const el = document.querySelector(`[data-anchor="${id}"]`)
        if (el) {
          el.scrollIntoView({ block: 'start' })
          el.classList.add(styles.anchorPulse)
          setTimeout(() => el.classList.remove(styles.anchorPulse), 1600)
        }
        clearSettings()
      }, 60)
    }, 0)
    return () => { clearTimeout(open); if (reveal) clearTimeout(reveal) }
  }, [settingsAnchor, cfg, clearSettings, openGroup])

  function autosave<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setCfg(prev => prev ? { ...prev, [key]: value } : prev)
    void window.api.config.set({ [key]: value })
  }

  const loadConfig = useCallback(async () => {
    const c = await window.api.config.get() as AppConfig
    setCfg(c)
    setSavedTmdbKey((c.tmdbApiKey ?? '').trim())
    if (c.plexServerName) setServerName(c.plexServerName)
  }, [])

  const loadLibraries = useCallback(async () => {
    setRefreshLibs(true)
    try {
      const libs = await window.api.plex.getLibraries() as Library[]
      setLibraries(libs)
      if (libs.length > 0) setServerConnected(true)
    } finally {
      setRefreshLibs(false)
    }
  }, [])

  const loadBrowserStatus = useCallback(async () => {
    const s = await window.api.browser.getStatus() as BrowserStatus
    setBrowserStatus(s)
    if (!s.installed) setEngineOpen(true)
  }, [])

  useEffect(() => {
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

  useEffect(() => {
    loadConfig()
    loadBrowserStatus()
    window.api.app.getEnv().then(e => {
      setEnv(e)
      if (e.web) return
      window.api.scheduler.getAutoStart().then(setAutoStart).catch(() => { /* keep off */ })
      window.api.scheduler.engineStatus().then(setEngine).catch(() => { /* assume local */ })
    })

    // Restore state on every mount (handles navigating away and back)
    window.api.auth.getStatus().then(s => {
      const status = s as PlexAuthStatus
      setAuthStatus(status)
      if (status.status === 'authorized') {
        if (status.serverName) {
          setServerConnected(true)
          setServerName(status.serverName)
        }
        loadLibraries()
      }
    })

    const off = window.api.auth.onStatusChange((s: PlexAuthStatus) => {
      setAuthStatus(s)
      if (s.status === 'authorized') {
        setSigningIn(false)
        loadConfig()
        if (s.serverName) {
          setServerConnected(true)
          setServerName(s.serverName)
          loadLibraries()
        }
      }
      if (s.status === 'idle') {
        setLibraries([])
        setServerConnected(false)
        setServerName('')
        setEditingServer(false)
        setTestMsg(null)
      }
    })
    return () => { off() }
  }, [loadConfig, loadLibraries, loadBrowserStatus])

  async function signIn() {
    setSigningIn(true)
    setAuthStatus({ status: 'waiting' })
    try {
      const authUrl = await window.api.auth.signIn()
      if (authUrl) setAuthStatus(prev => prev.status === 'waiting' ? { ...prev, authUrl } : prev)
    } catch {
      setSigningIn(false)
      setAuthStatus({ status: 'idle' })
    }
  }

  async function signOut() {
    setConfirm(null)
    await window.api.auth.disconnect()
    await window.api.config.set({ plexServerName: '' })
    setCfg(prev => prev ? { ...prev, plexServerName: '' } : prev)
    setAuthStatus({ status: 'idle' })
    setLibraries([])
    setServerConnected(false)
    setServerName('')
    setEditingServer(false)
    setTestMsg(null)
    announce('Signed out of Plex')
  }

  async function testConnection() {
    if (!cfg) return
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await window.api.plex.connect(cfg.baseUrl, cfg.token) as { success: boolean; serverName?: string; error?: string }
      if (res.success) {
        const name = res.serverName ?? ''
        setTestMsg({ ok: true, msg: `Connected to ${name || 'your server'}` })
        setServerConnected(true)
        setServerName(name)
        setEditingServer(false)
        await window.api.config.set({ baseUrl: cfg.baseUrl, plexServerName: name })
        setCfg(prev => prev ? { ...prev, baseUrl: cfg.baseUrl, plexServerName: name } : prev)
        await loadLibraries()
      } else {
        setTestMsg({ ok: false, msg: res.error ?? 'Could not reach the server at that address' })
      }
    } catch (err) {
      setTestMsg({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    }
    setTesting(false)
  }

  function toggleLibrary(title: string, include: boolean) {
    if (!cfg) return
    const current = cfg.excludedLibraries ?? []
    autosave('excludedLibraries', include ? current.filter(t => t !== title) : [...current, title])
  }

  function saveTmdbKey(value: string) {
    const key = value.trim()
    autosave('tmdbApiKey', key)
    setSavedTmdbKey(key)
  }

  async function clearLogs() {
    await window.api.log.clear()
    setLogsCleared(true)
    announce('Logs cleared')
    setTimeout(() => setLogsCleared(false), 2500)
  }

  async function clearCaches() {
    setConfirm(null)
    setClearingCaches(true)
    try {
      await window.api.app.clearCaches()
      setCachesCleared(true)
      announce('Cached data cleared. It is read again on next use.')
      setTimeout(() => setCachesCleared(false), 4000)
    } finally {
      setClearingCaches(false)
    }
  }

  async function toggleAutoStart(on: boolean) {
    setAutoStart(on)
    try {
      await window.api.scheduler.setAutoStart(on)
    } catch {
      setAutoStart(!on)
    }
  }

  async function copyPath() {
    if (!browserStatus?.executablePath) return
    try {
      await navigator.clipboard.writeText(browserStatus.executablePath)
      setCopiedPath(true)
      announce('Path copied')
      setTimeout(() => setCopiedPath(false), 1800)
    } catch { /* clipboard may be blocked */ }
  }

  function appendInstallLog(line: string) {
    setInstallLog(prev => [...prev, line])
    setTimeout(() => {
      installLogRef.current?.scrollTo({ top: installLogRef.current.scrollHeight })
    }, 30)
  }

  function reportBrowserError(error: BrowserInstallError | undefined) {
    if (!error) return
    appendInstallLog(`✗ ${error.message}. ${error.hint}`)
    if (error.command) appendInstallLog(`  ${error.command}`)
  }

  async function runBrowserAction(action: () => Promise<BrowserActionResult>) {
    setBrowserInstalling(true)
    setInstallLog([])
    const off = window.api.browser.onInstallProgress(appendInstallLog)
    try {
      const result = await action()
      if (result.ok) {
        appendInstallLog('✓ Browser ready')
        announce('Browser engine ready')
      } else {
        reportBrowserError(result.error)
      }
      setBrowserStatus(result.status)
    } catch (err) {
      appendInstallLog(`✗ ${err instanceof Error ? err.message : String(err)}`)
      await loadBrowserStatus()
    } finally {
      off()
      setBrowserInstalling(false)
    }
  }

  function installBrowser() {
    setEngineOpen(true)
    void runBrowserAction(() => window.api.browser.install({ force: browserStatus?.source === 'managed' }))
  }

  async function cancelBrowserInstall() {
    setBrowserStatus(await window.api.browser.cancelInstall())
  }

  function onTabKey(e: React.KeyboardEvent) {
    const i = GROUPS.findIndex(g => g.id === group)
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (i + 1) % GROUPS.length
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (i - 1 + GROUPS.length) % GROUPS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? GROUPS.length - 1
      : -1
    if (next < 0) return
    e.preventDefault()
    openGroup(GROUPS[next].id)
    tabRefs.current[GROUPS[next].id]?.focus()
  }

  if (!cfg) return (
    <div className={styles.loading}><Spinner size="md" /></div>
  )

  const connected = authStatus.status === 'authorized'
  const movieLibs = libraries.filter(l => l.type === 'movie')
  const showLibs  = libraries.filter(l => l.type === 'show')
  const showAutoStart = !!env && !env.web && !env.container && !engine.external
  const active = GROUPS.find(g => g.id === group) ?? GROUPS[0]
  const build = chromiumBuild(browserStatus?.executablePath)

  function libraryRow(lib: Library, kind: 'movie' | 'show') {
    const included = !(cfg!.excludedLibraries ?? []).includes(lib.title)
    const count = libCounts[lib.key]
    const noun = kind === 'movie' ? 'movies' : 'shows'
    const meta = [
      count != null ? `${count.toLocaleString()} ${noun}` : kind === 'movie' ? 'Movies' : 'TV shows',
      agentLabel(lib.agent) || null,
    ].filter(Boolean).join(' · ')
    const Icon = kind === 'movie' ? Film : Tv
    return (
      <Row key={lib.key} label={<span className={styles.libName}><Icon size={14} aria-hidden /> {lib.title}</span>} description={meta}>
        {({ labelId, descId }) => (
          <Switch checked={included} onChange={on => toggleLibrary(lib.title, on)} ariaLabelledBy={labelId} ariaDescribedBy={descId} />
        )}
      </Row>
    )
  }

  return (
    <div className={styles.page} ref={rootRef}>
      <div className={styles.layout}>
        <nav className={styles.sidebar} aria-label="Settings">
          <div className={styles.sidebarHead}>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">Changes save automatically.</p>
          </div>
          <div className={styles.tabs} role="tablist" aria-orientation="vertical" onKeyDown={onTabKey}>
            {GROUPS.map(g => (
              <button
                key={g.id}
                ref={el => { tabRefs.current[g.id] = el }}
                id={`settings-tab-${g.id}`}
                type="button"
                role="tab"
                aria-selected={group === g.id}
                aria-controls="settings-panel"
                tabIndex={group === g.id ? 0 : -1}
                className={`${styles.tab} ${group === g.id ? styles.tabActive : ''}`}
                onClick={() => openGroup(g.id)}
              >
                <g.Icon size={16} aria-hidden />
                <span>{g.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${group}`} className={styles.content}>
          <header className={styles.groupHead}>
            <h2 className={styles.groupTitle}>{active.label}</h2>
            <p className={styles.groupDesc}>{active.description}</p>
          </header>

          {group === 'plex' && (
            <>
              <Block title="Account" anchor="plex-account">
                {connected ? (
                  <Row
                    label={
                      <span className={styles.account}>
                        {cfg.plexAccountThumb && (
                          <img
                            src={cfg.plexAccountThumb}
                            alt=""
                            className={styles.avatar}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        )}
                        <span className={styles.accountText}>
                          <span>{cfg.plexAccountName || 'Plex user'}</span>
                          <span className={styles.rowDesc}>{cfg.plexAccountEmail ? `${cfg.plexAccountEmail} · Signed in` : 'Signed in'}</span>
                        </span>
                      </span>
                    }
                  >
                    <Button variant="destructive" size="sm" icon={<LogOut size={13} />} onClick={() => setConfirm('signout')}>
                      Sign out
                    </Button>
                  </Row>
                ) : signingIn ? (
                  authStatus.status === 'waiting' && authStatus.authUrl ? (
                    <Row stacked label="Waiting for you to approve the sign-in" description="Open this link on any device, sign in to Plex, and approve. This page updates by itself.">
                      <div className={styles.authLinkRow}>
                        <code className={styles.authLinkUrl} title={authStatus.authUrl}>{authStatus.authUrl}</code>
                        <Button
                          variant="secondary" size="sm"
                          icon={copiedAuth ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                          onClick={async () => {
                            try { await navigator.clipboard.writeText(authStatus.authUrl!); setCopiedAuth(true); setTimeout(() => setCopiedAuth(false), 1800) } catch { /* clipboard may be blocked */ }
                          }}
                        >
                          {copiedAuth ? 'Copied' : 'Copy link'}
                        </Button>
                        <Button variant="secondary" size="sm" icon={<ExternalLink size={13} />} onClick={() => window.open(authStatus.authUrl!, '_blank')}>
                          Open
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { window.api.auth.disconnect(); setSigningIn(false) }}>Cancel</Button>
                      </div>
                    </Row>
                  ) : (
                    <Row label="Starting sign-in…">
                      <Spinner size="sm" />
                      <Button variant="ghost" size="sm" onClick={() => { window.api.auth.disconnect(); setSigningIn(false) }}>Cancel</Button>
                    </Row>
                  )
                ) : (
                  <Row label="Plex account" description="Sign in to browse your libraries and apply art.">
                    <Button variant="primary" size="sm" icon={<LogIn size={13} />} onClick={signIn}>Sign in with Plex</Button>
                  </Row>
                )}
              </Block>

              {connected && (
                <Block title="Server" anchor="plex-server">
                  {serverConnected && !editingServer ? (
                    <Row
                      label={<span className={styles.serverName}><span className={styles.serverDot} aria-hidden />{serverName || 'Plex server'}</span>}
                      description={<span className={styles.serverUrl} title={cfg.baseUrl}>{cfg.baseUrl}</span>}
                    >
                      <Button variant="secondary" size="sm" icon={<Pencil size={12} />} onClick={() => setEditingServer(true)}>Change</Button>
                    </Row>
                  ) : (
                    <Row stacked label="Server address" description="Found automatically after sign-in. Enter it yourself if it was not, for example http://192.168.1.20:32400.">
                      {({ labelId }) => (
                        <>
                          <div className={styles.inputRow}>
                            <input
                              className={styles.textInput}
                              value={cfg.baseUrl}
                              onChange={e => setCfg(prev => prev ? { ...prev, baseUrl: e.target.value } : prev)}
                              onKeyDown={e => { if (e.key === 'Enter' && cfg.baseUrl && !testing) void testConnection() }}
                              placeholder="http://localhost:32400"
                              spellCheck={false}
                              aria-labelledby={labelId}
                            />
                            <Button
                              variant="primary"
                              size="sm"
                              icon={testing ? <Spinner size="xs" color="current" /> : undefined}
                              onClick={testConnection}
                              disabled={testing || !cfg.baseUrl}
                            >
                              {testing ? 'Connecting…' : 'Connect'}
                            </Button>
                            {editingServer && (
                              <Button variant="ghost" size="sm" icon={<X size={13} />} aria-label="Cancel changing the server" onClick={() => { setEditingServer(false); setTestMsg(null) }} />
                            )}
                          </div>
                          {testMsg && (
                            <p className={testMsg.ok ? styles.statusOk : styles.statusErr} role="status">
                              {testMsg.ok ? <CheckCircle2 size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />} {testMsg.msg}
                            </p>
                          )}
                        </>
                      )}
                    </Row>
                  )}
                </Block>
              )}

              {serverConnected && (
                <Block
                  title="Libraries"
                  anchor="libraries"
                  description="Libraries you turn off are skipped by the Library Browser, matching, and scheduled syncs."
                  action={
                    <Button
                      variant="ghost" size="sm"
                      icon={<RefreshCw size={13} className={refreshingLibs ? styles.spin : undefined} />}
                      onClick={loadLibraries}
                      disabled={refreshingLibs}
                    >
                      Reload
                    </Button>
                  }
                >
                  {libraries.length === 0 ? (
                    <Row label="No libraries found" description="The server answered but listed no movie or TV libraries. Reload after adding one in Plex." />
                  ) : (
                    <>
                      {movieLibs.map(lib => libraryRow(lib, 'movie'))}
                      {showLibs.map(lib => libraryRow(lib, 'show'))}
                    </>
                  )}
                </Block>
              )}
            </>
          )}

          {group === 'artwork' && (
            <>
              <Block title="MediUX asset types" anchor="mediux-filters" description="Only these types are applied from MediUX sets, including scheduled syncs.">
                {ASSET_TYPES.map(({ type, name, desc }) => {
                  const on = cfg.mediuxFilters.includes(type)
                  return (
                    <Row key={type} label={name} description={desc}>
                      {({ labelId, descId }) => (
                        <Switch
                          checked={on}
                          onChange={checked => autosave('mediuxFilters', checked ? [...cfg.mediuxFilters, type] : cfg.mediuxFilters.filter(t => t !== type))}
                          ariaLabelledBy={labelId}
                          ariaDescribedBy={descId}
                        />
                      )}
                    </Row>
                  )
                })}
              </Block>

              <Block title="Library Browser" anchor="collections">
                {(movieLibs.length > 0 || !serverConnected) && (
                  <Row label="Show collections" description="Browse and apply art to your Plex collections.">
                    {({ labelId, descId }) => (
                      <Switch
                        checked={cfg.collectionsEnabled !== false}
                        onChange={on => autosave('collectionsEnabled', on)}
                        ariaLabelledBy={labelId}
                        ariaDescribedBy={descId}
                      />
                    )}
                  </Row>
                )}
                <div data-anchor="quick-sync">
                  <Row label="Schedule and Sync timing" description="The schedule a job gets when you use Schedule on a set or Sync on a creator.">
                    {({ labelId }) => {
                      const current = cfg.schedulerQuickCron || DEFAULT_QUICK_CRON
                      const options = (QUICK_SCHEDULES.includes(current) ? QUICK_SCHEDULES : [...QUICK_SCHEDULES, current])
                        .map(expr => ({ value: expr, label: describeCron(expr) }))
                      return (
                        <div className={styles.selectWide}>
                          <Select options={options} value={current} onChange={v => autosave('schedulerQuickCron', v)} ariaLabelledBy={labelId} />
                        </div>
                      )
                    }}
                  </Row>
                </div>
              </Block>

              <Block
                title="Title matching"
                anchor="tmdb"
                description="A free TMDB API key lets the app match titles by ID instead of name and year, which fixes most mismatches, including anime libraries that use HAMA."
              >
                <Row
                  stacked
                  label="TMDB API key"
                  description={savedTmdbKey
                    ? 'Saved. Matching uses TMDB IDs.'
                    : 'No key: matching uses title and year, which can miss renamed titles.'}
                >
                  {({ labelId, descId }) => (
                    <div className={styles.inputRow}>
                      <input
                        className={`${styles.textInput} ${styles.mono}`}
                        type={showKey ? 'text' : 'password'}
                        value={cfg.tmdbApiKey ?? ''}
                        onChange={e => setCfg(prev => prev ? { ...prev, tmdbApiKey: e.target.value } : prev)}
                        onBlur={e => saveTmdbKey(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveTmdbKey((e.target as HTMLInputElement).value) }}
                        placeholder="Paste your API key (v3)"
                        spellCheck={false}
                        autoComplete="off"
                        aria-labelledby={labelId}
                        aria-describedby={descId}
                      />
                      <Button
                        variant="ghost" size="sm"
                        icon={showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        aria-label={showKey ? 'Hide key' : 'Show key'}
                        aria-pressed={showKey}
                        onClick={() => setShowKey(v => !v)}
                      />
                      <Button
                        variant="secondary" size="sm"
                        icon={<ExternalLink size={13} />}
                        onClick={() => window.api.app.openExternal('https://www.themoviedb.org/settings/api')}
                      >
                        Get a key
                      </Button>
                    </div>
                  )}
                </Row>
              </Block>
            </>
          )}

          {group === 'app' && (
            <>
              <Block title="Window" anchor="general">
                <Row label="Navigation dock" description="Where the page buttons sit. Automatic moves them into the status bar on small windows.">
                  {({ labelId }) => (
                    <Segmented options={NAV_DOCK_OPTIONS} value={navDock} onChange={setNavDock} ariaLabelledBy={labelId} />
                  )}
                </Row>
                {!isWeb && (
                  <Row label="Tray notice" description="Show a notice when the app minimizes to the system tray.">
                    {({ labelId, descId }) => (
                      <Switch checked={cfg.trayNotice ?? true} onChange={v => autosave('trayNotice', v)} ariaLabelledBy={labelId} ariaDescribedBy={descId} />
                    )}
                  </Row>
                )}
                {showAutoStart && (
                  <Row label="Launch at login" description="Open the app when you sign in to your computer, so scheduled jobs keep running.">
                    {({ labelId, descId }) => (
                      <Switch checked={autoStart} onChange={v => void toggleAutoStart(v)} ariaLabelledBy={labelId} ariaDescribedBy={descId} />
                    )}
                  </Row>
                )}
              </Block>

              <Block title="Legacy tools" anchor="legacy">
                <Row
                  label="Show legacy tools"
                  description="Adds two older pages to the navigation: Manual Import, for pasting MediUX and ThePosterDB links or running bulk files, and Title Mappings, for pointing a Plex title at a different name on the poster sites. Saved mappings keep applying while the page is hidden. Starts on when either page holds saved work."
                >
                  {({ labelId, descId }) => (
                    <Switch checked={showLegacyTools} onChange={setShowLegacyTools} ariaLabelledBy={labelId} ariaDescribedBy={descId} />
                  )}
                </Row>
              </Block>

              <AboutBlock env={env} announce={announce} />
            </>
          )}

          {group === 'advanced' && (
            <>
              <Block title="Downloads" anchor="scraper">
                <Row label="Sets fetched at once" description="Higher is faster but heavier on MediUX and ThePosterDB.">
                  {({ labelId }) => (
                    <div className={styles.selectWrap}>
                      <Select
                        options={WORKER_OPTIONS}
                        value={String(cfg.maxWorkers)}
                        onChange={v => autosave('maxWorkers', Number(v))}
                        ariaLabelledBy={labelId}
                      />
                    </div>
                  )}
                </Row>
              </Block>

              <Block title="Browser engine" anchor="browser" description="The headless browser that reads MediUX and ThePosterDB pages.">
                {browserStatus ? (
                  <>
                    <Row
                      label={browserStatus.installed ? `Chromium${build ? ` ${build}` : ''}` : 'Not installed'}
                      description={browserStatus.installed
                        ? [browserStatus.source ? SOURCE_LABELS[browserStatus.source] : null, browserStatus.verified ? 'Verified' : 'Not verified yet'].filter(Boolean).join(' · ')
                        : 'Install the Chromium headless shell, or use a browser already on this computer.'}
                    >
                      {!browserStatus.installed && (
                        <Button
                          variant="primary" size="sm"
                          icon={browserInstalling ? <Spinner size="xs" color="current" /> : <Download size={13} />}
                          onClick={installBrowser}
                          disabled={browserInstalling}
                        >
                          {browserInstalling ? 'Installing…' : 'Install Chromium'}
                        </Button>
                      )}
                      <Button
                        variant="secondary" size="sm"
                        icon={<ChevronDown size={13} className={engineOpen ? styles.chevronOpen : undefined} />}
                        aria-expanded={engineOpen}
                        aria-controls="engine-details"
                        onClick={() => setEngineOpen(v => !v)}
                      >
                        {engineOpen ? 'Hide' : 'Change…'}
                      </Button>
                    </Row>
                    {engineOpen && (
                      <div id="engine-details">
                        {browserStatus.installed && (
                          <Row stacked label="Executable">
                            <div className={styles.pathBox}>
                              <code className={styles.pathText} title={browserStatus.executablePath}>{browserStatus.executablePath || '-'}</code>
                              {browserStatus.executablePath && (
                                <Button
                                  variant="ghost" size="sm"
                                  icon={copiedPath ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                                  aria-label="Copy executable path"
                                  onClick={copyPath}
                                />
                              )}
                            </div>
                          </Row>
                        )}
                        <Row stacked label="Use another browser" description="Any Chromium-based browser works. The built-in one is the most reliable.">
                          <div className={styles.buttonRow}>
                            {browserStatus.installed && browserStatus.source === 'managed' && (
                              <Button
                                variant="secondary" size="sm"
                                icon={browserInstalling ? <Spinner size="xs" color="current" /> : <RotateCcw size={13} />}
                                onClick={installBrowser}
                                disabled={browserInstalling}
                              >
                                {browserInstalling ? 'Installing…' : 'Reinstall'}
                              </Button>
                            )}
                            {(browserStatus.source === 'system' || browserStatus.source === 'custom') && (
                              <Button variant="secondary" size="sm" onClick={() => void runBrowserAction(() => window.api.browser.useExecutable(null))} disabled={browserInstalling}>
                                Use the built-in browser
                              </Button>
                            )}
                            {browserStatus.systemBrowsers
                              .filter(browser => browser.path !== browserStatus.executablePath)
                              .map(browser => (
                                <Button
                                  key={browser.path}
                                  variant="secondary" size="sm"
                                  icon={<Globe size={13} />}
                                  onClick={() => void runBrowserAction(() => window.api.browser.useExecutable(browser.path))}
                                  disabled={browserInstalling}
                                  title={browser.path}
                                >
                                  Use {browser.name}
                                </Button>
                              ))}
                            {!isWeb && (
                              <Button
                                variant="secondary" size="sm"
                                icon={<FolderOpen size={13} />}
                                onClick={() => void runBrowserAction(() => window.api.browser.pickExecutable())}
                                disabled={browserInstalling}
                              >
                                Browse…
                              </Button>
                            )}
                            {browserInstalling && (
                              <Button variant="ghost" size="sm" onClick={() => void cancelBrowserInstall()}>Cancel</Button>
                            )}
                          </div>
                          {installLog.length > 0 && (
                            <div className={styles.installLog} ref={installLogRef} role="log" aria-live="polite">
                              {installLog.map((line, i) => (
                                <div key={i} className={styles.installLogLine}>{line}</div>
                              ))}
                            </div>
                          )}
                        </Row>
                      </div>
                    )}
                  </>
                ) : (
                  <Row label="Checking the browser engine…"><Spinner size="sm" /></Row>
                )}
              </Block>

              <Block title="Logs and cached data" anchor="logs">
                <Row label="Log files" description="Logs rotate at 10 MB and keep the 3 most recent files.">
                  <Button variant="secondary" size="sm" icon={<FolderOpen size={13} />} onClick={() => void window.api.app.openLogFolder()}>
                    {isWeb ? 'Copy log path' : 'Open folder'}
                  </Button>
                  <Button variant="destructive" size="sm" icon={logsCleared ? <CheckCircle2 size={13} /> : <Trash2 size={13} />} onClick={clearLogs}>
                    {logsCleared ? 'Cleared' : 'Clear logs'}
                  </Button>
                </Row>
                <Row
                  label="Cached data"
                  description="Creator catalogs, series statuses, and library listings are kept so they load instantly. Clear them if something looks out of date."
                >
                  <Button
                    variant="destructive" size="sm"
                    icon={cachesCleared ? <CheckCircle2 size={13} /> : clearingCaches ? <Spinner size="xs" color="current" /> : <Trash2 size={13} />}
                    onClick={() => setConfirm('caches')}
                    disabled={clearingCaches}
                  >
                    {cachesCleared ? 'Cleared' : 'Clear cached data'}
                  </Button>
                </Row>
              </Block>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'signout'}
        title="Sign out of Plex?"
        body="The app stops reading your libraries and applying art until you sign in again, and scheduled jobs cannot apply art in the meantime. Your library choices, schedules, and history are kept."
        confirmLabel="Sign out"
        onConfirm={() => void signOut()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'caches'}
        title="Clear cached data?"
        body="Creator catalogs, series statuses, and library listings are read again the next time they are used. A large MediUX creator takes several minutes to read again."
        confirmLabel="Clear cached data"
        onConfirm={() => void clearCaches()}
        onCancel={() => setConfirm(null)}
      />

      <p className={styles.srOnly} aria-live="polite">{announcement}</p>
    </div>
  )
}
