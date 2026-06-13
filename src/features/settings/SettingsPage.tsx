import { useEffect, useState, useCallback, useRef, Fragment } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LogIn, LogOut, RefreshCw, ServerCrash, Pencil, X,
  Server, User, Sliders, SlidersHorizontal, Filter, Wrench,
  CheckCircle2, Circle, Globe, Download, RotateCcw, AlertTriangle, Film, Tv, Copy, ExternalLink,
  Package, FolderOpen, Sparkles, MinusCircle, Trash2,
} from 'lucide-react'
import Button from '../../components/ui/Button'
import Spinner from '../../components/ui/Spinner'
import Switch from '../../components/ui/Switch'
import Slider from '../../components/ui/Slider'
import Checkbox from '../../components/ui/Checkbox'
import { useUpdater } from '../updater/UpdaterContext'
import { useNavStore } from '../../app/navStore'
import type { AppConfig, Library, PlexAuthStatus, BrowserStatus } from '../../../electron/ipc/types'
import styles from './SettingsPage.module.css'

const DOCKER_UPDATE_GUIDE = 'https://github.com/tonywied17/plex-poster-set-helper-2/blob/main/docker/README.md#updating-to-a-new-version'

/**
 * Maps a Plex agent identifier to a short display label.
 *
 * @param agent - Agent id such as com.plexapp.agents.hama.
 * @returns A label like "HAMA", or an empty string.
 */
function agentLabel(agent: string | undefined): string {
  if (!agent) return ''
  if (agent.includes('hama'))         return 'HAMA'
  if (agent.includes('themoviedb'))   return 'TMDb agent'
  if (agent.includes('thetvdb'))      return 'TheTVDB agent'
  if (agent.includes('plex'))         return 'Plex'
  return agent.split('.').pop() ?? ''
}

/** Application section: version, update checks/installs, and log-folder access. */
function ApplicationSection() {
  const { status, info, version, mode, env, lastChecked, check, download, restart } = useUpdater()
  const [checking, setChecking] = useState(false)
  const [noUpdate, setNoUpdate] = useState(false)
  const isDocker = mode === 'docker'

  async function onCheck() {
    setChecking(true)
    setNoUpdate(false)
    const res = await check()
    setChecking(false)
    if (!res.available) setNoUpdate(true)
  }

  const lastText = lastChecked
    ? `Last checked ${new Date(lastChecked).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : 'Not checked yet'

  return (
    <Section icon={<Package size={15} />} title="Application" anchor="application">
      <FieldRow label="Version" hint={env?.container ? 'Running in Docker' : lastText}>
        <span className={styles.versionTag}>v{version || '…'}</span>
      </FieldRow>

      <FieldRow label="Updates" hint={isDocker ? 'Docker is updated by pulling a new image' : 'Check GitHub for a newer release'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {/* Docker can't self-update; link to the pull-and-recreate guide */}
          {isDocker && status === 'available' && (
            <Button variant="primary" size="sm" icon={<ExternalLink size={13} />}
              onClick={() => window.api.app.openExternal(info?.releaseUrl || DOCKER_UPDATE_GUIDE)}>
              v{info?.version} available - how to update
            </Button>
          )}
          {!isDocker && status === 'available' && (
            <Button variant="primary" size="sm" icon={<Download size={13} />} onClick={download}>
              Download v{info?.version}
            </Button>
          )}
          {!isDocker && status === 'downloading' && <span className={styles.updHint}><Spinner size="xs" /> Downloading…</span>}
          {!isDocker && status === 'ready' && (
            <Button variant="primary" size="sm" icon={<RefreshCw size={13} />} onClick={restart}>
              Relaunch to update
            </Button>
          )}
          {(status === 'idle' || status === 'checking' || (isDocker && status !== 'available')) && (
            <Button
              variant="ghost" size="sm"
              icon={checking ? <Spinner size="xs" color="current" /> : <RefreshCw size={13} />}
              onClick={onCheck}
              disabled={checking}
            >
              {checking ? 'Checking…' : 'Check for updates'}
            </Button>
          )}
          {noUpdate && status !== 'available' && (
            <span className={styles.updHint}><Sparkles size={12} /> Up to date</span>
          )}
        </div>
      </FieldRow>

      <FieldRow label="Logs" hint="Open the folder containing the app log files">
        <Button variant="ghost" size="sm" icon={<FolderOpen size={13} />} onClick={() => window.api.app.openLogFolder()}>
          Open log folder
        </Button>
      </FieldRow>
    </Section>
  )
}

/** Settings section wrapper with icon, title, and optional description/action. */
function Section({
  icon,
  title,
  description,
  action,
  anchor,
  children,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  /** Deep-link target id used by the command palette to scroll here. */
  anchor?: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.section} data-anchor={anchor}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionIcon}>{icon}</span>
        <div style={{ flex: 1 }}>
          <h2 className={styles.sectionTitle}>{title}</h2>
          {description && <p className={styles.sectionDesc}>{description}</p>}
        </div>
        {action && <div className={styles.sectionAction}>{action}</div>}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  )
}

/** Labelled settings row with an optional hint. */
function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={styles.fieldRow}>
      <div className={styles.fieldLabel}>
        <span>{label}</span>
        {hint && <span className={styles.fieldHint}>{hint}</span>}
      </div>
      <div className={styles.fieldControl}>{children}</div>
    </div>
  )
}

type StepState = 'done' | 'active' | 'waiting'

/** Two-step getting-started stepper: authenticate, then connect the server. */
function SetupFlow({ step1, step2 }: { step1: StepState; step2: StepState }) {
  const steps: Array<{ label: string; sub: string; state: StepState }> = [
    {
      label: 'Authenticate',
      sub: step1 === 'done' ? 'Signed in' : 'Sign in with Plex',
      state: step1,
    },
    {
      label: 'Connect Server',
      sub: step2 === 'done' ? 'Server connected' : step2 === 'active' ? 'Enter URL below' : 'Waiting…',
      state: step2,
    },
  ]

  return (
    <div className={styles.setupFlow}>
      <span className={styles.setupHeading}>Getting Started</span>
      <div className={styles.setupSteps}>
        {steps.map((s, i) => (
          <Fragment key={i}>
            <div className={`${styles.setupStep} ${styles[`step_${s.state}`]}`}>
              <span className={styles.setupBubble}>
                {s.state === 'done'
                  ? <CheckCircle2 size={14} />
                  : s.state === 'active'
                    ? <span className={styles.setupNumActive}>{i + 1}</span>
                    : <Circle size={14} />}
              </span>
              <div className={styles.setupStepText}>
                <span className={styles.setupStepLabel}>{s.label}</span>
                <span className={styles.setupStepSub}>{s.sub}</span>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className={`${styles.setupConnector} ${steps[i + 1].state !== 'waiting' ? styles.setupConnectorActive : ''}`} />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/** Settings page: Plex auth/server/libraries, scraper options, browser engine, and app updates. */
export default function SettingsPage() {
  const [cfg, setCfg] = useState<AppConfig | null>(null)

  const [authStatus, setAuthStatus] = useState<PlexAuthStatus>({ status: 'idle' })
  const [signingIn, setSigningIn]   = useState(false)
  const [copiedAuth, setCopiedAuth] = useState(false)

  const [testing, setTesting]               = useState(false)
  const [testMsg, setTestMsg]               = useState<{ ok: boolean; msg: string } | null>(null)
  const [serverConnected, setServerConnected] = useState(false)
  const [serverName, setServerName]         = useState('')
  const [editingServer, setEditingServer]   = useState(false)

  const [libraries, setLibraries]       = useState<Library[]>([])
  const [refreshingLibs, setRefreshLibs] = useState(false)
  const [libCounts, setLibCounts]       = useState<Record<string, number>>({})

  const [browserStatus,    setBrowserStatus]    = useState<BrowserStatus | null>(null)
  const [browserInstalling, setBrowserInstalling] = useState(false)
  const [installLog,       setInstallLog]       = useState<string[]>([])
  const installLogRef = useRef<HTMLDivElement>(null)

  // cfg is the single source of truth - no draft layer
  const merged = cfg

  // Command-palette deep link: scroll to and briefly pulse the requested section.
  const settingsAnchor = useNavStore(s => s.settingsAnchor)
  const clearSettings   = useNavStore(s => s.clearSettings)
  useEffect(() => {
    if (!settingsAnchor || !cfg) return
    const id = settingsAnchor
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-anchor="${id}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.classList.add(styles.anchorPulse)
        setTimeout(() => el.classList.remove(styles.anchorPulse), 1600)
      }
      clearSettings()
    }, 120)
    return () => clearTimeout(t)
  }, [settingsAnchor, cfg, clearSettings])

  const [logsCleared, setLogsCleared] = useState(false)
  async function clearLogs() {
    await window.api.log.clear()
    setLogsCleared(true)
    setTimeout(() => setLogsCleared(false), 1800)
  }

  function autosave<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setCfg(prev => prev ? { ...prev, [key]: value } : prev)
    void window.api.config.set({ [key]: value })
  }

  const loadConfig = useCallback(async () => {
    const c = await window.api.config.get() as AppConfig
    setCfg(c)
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
      await window.api.auth.signIn()
    } catch {
      setSigningIn(false)
      setAuthStatus({ status: 'idle' })
    }
  }

  async function disconnect() {
    await window.api.auth.disconnect()
    await window.api.config.set({ excludedLibraries: [], plexServerName: '' })
    setCfg(prev => prev ? { ...prev, excludedLibraries: [], plexServerName: '' } : prev)
    setAuthStatus({ status: 'idle' })
    setLibraries([])
    setServerConnected(false)
    setServerName('')
    setEditingServer(false)
    setTestMsg(null)
  }

  async function testConnection() {
    if (!merged) return
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await window.api.plex.connect(merged.baseUrl, merged.token) as { success: boolean; serverName?: string; error?: string }
      if (res.success) {
        const name = res.serverName ?? ''
        setTestMsg({ ok: true, msg: `Connected to "${name}"` })
        setServerConnected(true)
        setServerName(name)
        setEditingServer(false)
        await window.api.config.set({ baseUrl: merged.baseUrl, plexServerName: name })
        setCfg(prev => prev ? { ...prev, baseUrl: merged.baseUrl, plexServerName: name } : prev)
        await loadLibraries()
      } else {
        setTestMsg({ ok: false, msg: res.error ?? 'Connection failed' })
      }
    } catch (err) {
      setTestMsg({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    }
    setTesting(false)
  }

  function toggleExcludeLibrary(title: string) {
    if (!merged) return
    const current = merged.excludedLibraries ?? []
    const next = current.includes(title)
      ? current.filter(t => t !== title)
      : [...current, title]
    autosave('excludedLibraries', next)
  }

  async function installBrowser() {
    setBrowserInstalling(true)
    setInstallLog([])
    const off = window.api.browser.onInstallProgress((line: string) => {
      setInstallLog(prev => [...prev, line])
      setTimeout(() => {
        installLogRef.current?.scrollTo({ top: installLogRef.current.scrollHeight, behavior: 'smooth' })
      }, 30)
    })
    try {
      await window.api.browser.install()
      await loadBrowserStatus()
    } catch {
      setInstallLog(prev => [...prev, '✗ Installation failed. Ensure Node.js is on your PATH.'])
    } finally {
      off()
      setBrowserInstalling(false)
    }
  }

  if (!merged) return (
    <div className={styles.loading}><Spinner size="md" /></div>
  )

  const connected = authStatus.status === 'authorized'
  const movieLibs = libraries.filter(l => l.type === 'movie')
  const showLibs  = libraries.filter(l => l.type === 'show')

  // Setup flow is only 2 steps; libraries default to all-included
  const step1: StepState = connected ? 'done' : 'active'
  const step2: StepState = serverConnected ? 'done' : connected ? 'active' : 'waiting'
  const setupDone = step1 === 'done' && step2 === 'done'

  return (
    <div className={styles.page}>

      {/* Page header */}
      <div className={styles.pageHeader}>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Changes are saved automatically.</p>
      </div>

      {/* Scrollable body */}
      <div className={styles.body}>

        {/* Group: Plex Connection */}
        <div className={styles.groupDivider}>
          <div className={styles.groupDividerLine} />
          <span className={styles.groupDividerLabel}>
            <span className={styles.groupDividerDot} />
            Plex Connection
            <span className={styles.groupDividerDot} />
          </span>
          <div className={styles.groupDividerLine} />
        </div>

        {/* Setup flow stepper */}
        <AnimatePresence initial={false}>
          {!setupDone && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.28 }}
              style={{ overflow: 'hidden' }}
            >
              <SetupFlow step1={step1} step2={step2} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Plex account */}
        <Section icon={<User size={15} />} title="Plex Account" anchor="plex-account" description="Authenticate with your plex.tv account to enable automatic library matching.">
          {connected ? (
            <div className={styles.accountCard}>
              {merged.plexAccountThumb && (
                <img
                  src={merged.plexAccountThumb}
                  alt={merged.plexAccountName ?? ''}
                  className={styles.avatar}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div className={styles.accountInfo}>
                <span className={styles.accountName}>{merged.plexAccountName || 'Plex User'}</span>
                {merged.plexAccountEmail && (
                  <span className={styles.accountEmail}>{merged.plexAccountEmail}</span>
                )}
                <span className={styles.accountBadge}>Connected</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<LogOut size={13} />}
                onClick={disconnect}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <div className={styles.signInRow}>
              {signingIn ? (
                authStatus.status === 'waiting' && authStatus.authUrl ? (
                  <div className={styles.authLinkBox}>
                    <div className={styles.authLinkHeader}>
                      <Spinner size="xs" />
                      <span>Waiting for you to authorize…</span>
                    </div>
                    <p className={styles.authLinkHint}>
                      Open this link on any device, sign in, and approve. This window finishes automatically.
                    </p>
                    <div className={styles.authLinkRow}>
                      <code className={styles.authLinkUrl} title={authStatus.authUrl}>{authStatus.authUrl}</code>
                      <button
                        className={styles.authCopyBtn}
                        onClick={async () => {
                          try { await navigator.clipboard.writeText(authStatus.authUrl!); setCopiedAuth(true); setTimeout(() => setCopiedAuth(false), 1800) } catch { /* clipboard may be blocked */ }
                        }}
                        title="Copy link"
                      >
                        {copiedAuth ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                      </button>
                      <button
                        className={styles.authOpenBtn}
                        onClick={() => window.open(authStatus.authUrl!, '_blank')}
                        title="Try to open"
                      >
                        <ExternalLink size={14} />
                      </button>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { window.api.auth.disconnect(); setSigningIn(false) }}>Cancel</Button>
                  </div>
                ) : (
                <>
                  <Spinner size="sm" />
                  <span className={styles.waitingText}>Connecting…</span>
                  <Button variant="ghost" size="sm" onClick={() => { window.api.auth.disconnect(); setSigningIn(false) }}>
                    Cancel
                  </Button>
                </>
                )
              ) : (
                <>
                  <p className={styles.signInDesc}>
                    Sign in to allow the tool to search your Plex libraries and upload posters automatically.
                  </p>
                  <Button variant="primary" size="sm" icon={<LogIn size={13} />} onClick={signIn}>
                    Sign in with Plex
                  </Button>
                </>
              )}
            </div>
          )}
        </Section>

        {/* Plex server - only shown once authenticated */}
        {connected && (
        <Section icon={<Server size={15} />} title="Plex Server" anchor="plex-server" description="Your local Plex Media Server address - auto-detected after sign-in.">
          {serverConnected && !editingServer ? (
            /* Connected card */
            <div className={styles.serverCard}>
              <div className={styles.serverCardLeft}>
                <span className={styles.serverDot} />
                <div className={styles.serverInfo}>
                  <span className={styles.serverName}>{serverName || 'Plex Server'}</span>
                  <span className={styles.serverUrl}>{merged.baseUrl}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<Pencil size={12} />}
                onClick={() => setEditingServer(true)}
              >
                Edit
              </Button>
            </div>
          ) : (
            /* URL input (edit / first-time manual) */
            <FieldRow label="Server URL" hint="e.g. http://192.168.1.x:32400">
              <div className={styles.inputWithAction}>
                <input
                  className={styles.textInput}
                  value={merged.baseUrl}
                  onChange={e => setCfg(prev => prev ? { ...prev, baseUrl: e.target.value } : prev)}
                  placeholder="http://localhost:32400"
                  spellCheck={false}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={testing ? <Spinner size="xs" color="current" /> : <RefreshCw size={12} />}
                  onClick={testConnection}
                  disabled={testing || !merged.baseUrl}
                >
                  {testing ? 'Connecting…' : 'Connect'}
                </Button>
                {editingServer && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<X size={12} />}
                    onClick={() => { setEditingServer(false); setTestMsg(null) }}
                  />
                )}
              </div>
              <AnimatePresence>
                {testMsg && (
                  <motion.p
                    className={testMsg.ok ? styles.testOk : styles.testErr}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {testMsg.ok ? '✓' : '✗'} {testMsg.msg}
                  </motion.p>
                )}
              </AnimatePresence>
            </FieldRow>
          )}
        </Section>
        )}

        {/* Libraries - only appear once server connection is established */}
        {serverConnected && (
          <Section
            icon={<SlidersHorizontal size={15} />}
            title="Libraries"
            anchor="libraries"
            description="All libraries are included by default. Uncheck any library to exclude it from scraping, matching, and the library browser."
            action={
              <button
                className={styles.refreshBtn}
                onClick={loadLibraries}
                disabled={refreshingLibs}
                title="Refresh libraries from server"
              >
                <RefreshCw size={12} className={refreshingLibs ? styles.spin : ''} />
              </button>
            }
          >
            {libraries.length === 0 ? (
              <div className={styles.libsEmpty}>
                <ServerCrash size={14} />
                <span>No libraries loaded - ensure your server URL is connected above.</span>
              </div>
            ) : (
              <div className={styles.libList}>
                {movieLibs.length > 0 && (
                  <>
                    <span className={styles.libGroupLabel}>Movies</span>
                    {movieLibs.map(lib => {
                      const included = !(merged.excludedLibraries ?? []).includes(lib.title)
                      const count = libCounts[lib.key]
                      const agent = agentLabel(lib.agent)
                      const meta = [count != null ? `${count.toLocaleString()} movies` : null, agent || null].filter(Boolean).join(' · ')
                      return (
                        <button key={lib.key} className={`${styles.libCard} ${included ? styles.libCardOn : styles.libCardOff}`} onClick={() => toggleExcludeLibrary(lib.title)}>
                          <div className={`${styles.libCardIcon} ${styles.libCardIconMovie}`}><Film size={15} /></div>
                          <div className={styles.libCardBody}>
                            <span className={styles.libCardName}>{lib.title}</span>
                            {meta && <span className={styles.libCardMeta}>{meta}</span>}
                          </div>
                          <div className={styles.libCardStatus}>
                            {included
                              ? <CheckCircle2 size={15} className={styles.libCardStatusOn} />
                              : <MinusCircle  size={15} className={styles.libCardStatusOff} />}
                          </div>
                        </button>
                      )
                    })}
                  </>
                )}
                {showLibs.length > 0 && (
                  <>
                    <span className={`${styles.libGroupLabel} ${movieLibs.length > 0 ? styles.libGroupLabelSpaced : ''}`}>TV Shows</span>
                    {showLibs.map(lib => {
                      const included = !(merged.excludedLibraries ?? []).includes(lib.title)
                      const count = libCounts[lib.key]
                      const agent = agentLabel(lib.agent)
                      const meta = [count != null ? `${count.toLocaleString()} shows` : null, agent || null].filter(Boolean).join(' · ')
                      return (
                        <button key={lib.key} className={`${styles.libCard} ${included ? styles.libCardOn : styles.libCardOff}`} onClick={() => toggleExcludeLibrary(lib.title)}>
                          <div className={`${styles.libCardIcon} ${styles.libCardIconShow}`}><Tv size={15} /></div>
                          <div className={styles.libCardBody}>
                            <span className={styles.libCardName}>{lib.title}</span>
                            {meta && <span className={styles.libCardMeta}>{meta}</span>}
                          </div>
                          <div className={styles.libCardStatus}>
                            {included
                              ? <CheckCircle2 size={15} className={styles.libCardStatusOn} />
                              : <MinusCircle  size={15} className={styles.libCardStatusOff} />}
                          </div>
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </Section>
        )}

        {/* Group divider */}
        <div className={styles.groupDivider}>
          <div className={styles.groupDividerLine} />
          <span className={styles.groupDividerLabel}>
            <span className={styles.groupDividerDot} />
            Import &amp; Scraper Settings
            <span className={styles.groupDividerDot} />
          </span>
          <div className={styles.groupDividerLine} />
        </div>

        {/* MediUX filters */}
        <Section icon={<Filter size={15} />} title="MediUX Asset Types" anchor="mediux-filters" description="When applying a MediUX set, only these asset types are uploaded to Plex. Unchecked types are skipped everywhere - scrape, bulk, and scheduled syncs.">
          <div className={styles.filterOptions}>
            {([
              { type: 'poster',     name: 'Posters',     desc: 'Show, movie, season & collection cover art (portrait).' },
              { type: 'backdrop',   name: 'Backdrops',   desc: 'Wide background art shown behind a title in Plex.' },
              { type: 'title_card', name: 'Title Cards', desc: 'Per-episode thumbnails for TV shows (landscape).' },
            ] as const).map(({ type, name, desc }) => {
              const on = merged.mediuxFilters.includes(type)
              return (
                <label key={type} className={styles.filterOption}>
                  <Checkbox
                    checked={on}
                    onChange={checked => {
                      const next = checked
                        ? [...merged.mediuxFilters, type]
                        : merged.mediuxFilters.filter(t => t !== type)
                      autosave('mediuxFilters', next)
                    }}
                  />
                  <span className={styles.filterOptionText}>
                    <span className={styles.filterOptionName}>{name}</span>
                    <span className={styles.filterOptionDesc}>{desc}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </Section>

        {/* Scraper */}
        <Section icon={<Sliders size={15} />} title="Scraper" anchor="scraper" description="Timing and anti-detection are tuned automatically. The only knob is how many sets are fetched in parallel - higher is faster but heavier on the source sites.">
          <FieldRow label="Max Workers" hint="Sets fetched at the same time (1 = safest, 8 = fastest)">
            <Slider
              min={1} max={8} step={1}
              value={merged.maxWorkers}
              onChange={v => autosave('maxWorkers', v)}
              ticks={8}
            />
          </FieldRow>
        </Section>

        {/* Library browser */}
        <Section
          icon={<Film size={15} />}
          title="Library Browser"
          anchor="tmdb"
          description="MediUX matches titles by TMDB ID. A free TMDB API key is optional but recommended: it lets the tool match your library by ID instead of guessing by title and year, which fixes most matching and title-mapping issues automatically (and resolves TVDB/IMDb-agent libraries such as anime via HAMA)."
        >
          <FieldRow label="TMDB API Key" hint="Optional but recommended - paste your themoviedb.org v3 API key">
            <div className={styles.inputWithAction}>
              <input
                className={styles.textInput}
                type="password"
                value={merged.tmdbApiKey ?? ''}
                onChange={e => setCfg(prev => prev ? { ...prev, tmdbApiKey: e.target.value } : prev)}
                onBlur={e => autosave('tmdbApiKey', e.target.value.trim())}
                placeholder="Paste TMDB v3 API key…"
                spellCheck={false}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<ExternalLink size={12} />}
                onClick={() => window.api.app.openExternal('https://www.themoviedb.org/settings/api')}
              >
                Get key
              </Button>
            </div>
            <p className={styles.browserNotice}>
              {(merged.tmdbApiKey ?? '').trim()
                ? 'Key saved. Library matching now prefers exact TMDB IDs.'
                : 'Without a key, matching falls back to title and year, which can miss renamed or subtitled titles.'}
            </p>
          </FieldRow>
        </Section>

        {/* Browser engine */}
        <Section
          icon={<Globe size={15} />}
          title="Browser Engine"
          anchor="browser"
          description="Playwright Chromium is used for scraping poster sets from MediUX and ThePosterDB."
          action={browserStatus && (
            <span className={browserStatus.installed ? styles.browserBadgeOk : styles.browserBadgeWarn}>
              {browserStatus.installed ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
              {browserStatus.installed ? 'Installed' : 'Not installed'}
            </span>
          )}
        >
          {browserStatus ? (
            <div className={styles.browserSection}>
              {browserStatus.installed ? (
                <div className={styles.browserPath}>
                  <span className={styles.browserPathLabel}>Executable</span>
                  <span className={styles.browserPathValue} title={browserStatus.executablePath}>
                    {browserStatus.executablePath || '-'}
                  </span>
                </div>
              ) : (
                <p className={styles.browserNotice}>
                  Chromium is not installed yet. Click Install to download it automatically.
                  Node.js must be available on your system PATH.
                </p>
              )}

              <div className={styles.browserActions}>
                <Button
                  variant={browserStatus.installed ? 'ghost' : 'primary'}
                  size="sm"
                  icon={browserInstalling
                    ? <Spinner size="xs" color="current" />
                    : browserStatus.installed ? <RotateCcw size={13} /> : <Download size={13} />}
                  onClick={installBrowser}
                  disabled={browserInstalling}
                >
                  {browserInstalling
                    ? 'Installing…'
                    : browserStatus.installed ? 'Reinstall' : 'Install Chromium'}
                </Button>
              </div>

              <AnimatePresence>
                {installLog.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className={styles.installLog} ref={installLogRef}>
                      {installLog.map((line, i) => (
                        <div key={i} className={styles.installLogLine}>{line}</div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className={styles.loading}><Spinner size="sm" /></div>
          )}
        </Section>

        {/* Group: General */}
        <div className={styles.groupDivider}>
          <div className={styles.groupDividerLine} />
          <span className={styles.groupDividerLabel}>
            <span className={styles.groupDividerDot} />
            General
            <span className={styles.groupDividerDot} />
          </span>
          <div className={styles.groupDividerLine} />
        </div>

        {/* General */}
        <Section icon={<Wrench size={15} />} title="General" anchor="general">
          <FieldRow label="Tray Notification" hint="Show a notice when the app minimizes to the system tray">
            <Switch
              checked={merged.trayNotice ?? true}
              onChange={v => autosave('trayNotice', v)}
            />
          </FieldRow>
          <FieldRow label="Log File" hint="Logs rotate automatically at 10 MB, keeping the 3 most recent files. Clear empties the current log.">
            <Button
              variant="ghost"
              size="sm"
              icon={logsCleared ? <CheckCircle2 size={13} /> : <Trash2 size={13} />}
              onClick={clearLogs}
            >
              {logsCleared ? 'Cleared' : 'Clear logs'}
            </Button>
          </FieldRow>
        </Section>

        {/* Application / updates */}
        <ApplicationSection />

      </div>
    </div>
  )
}
