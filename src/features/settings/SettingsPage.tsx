import { useEffect, useState, useCallback, Fragment } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LogIn, LogOut, RefreshCw, Save, ServerCrash,
  Server, User, Sliders, SlidersHorizontal, Filter, Wrench,
  CheckCircle2, Circle, Info,
} from 'lucide-react'
import Button from '../../components/ui/Button'
import Spinner from '../../components/ui/Spinner'
import Switch from '../../components/ui/Switch'
import Slider from '../../components/ui/Slider'
import RangeSlider from '../../components/ui/RangeSlider'
import Checkbox from '../../components/ui/Checkbox'
import type { AppConfig, Library, PlexAuthStatus } from '../../../electron/ipc/types'
import styles from './SettingsPage.module.css'

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={styles.section}>
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

// ─── Field row ────────────────────────────────────────────────────────────────

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

// ─── Setup flow stepper ───────────────────────────────────────────────────────

type StepState = 'done' | 'active' | 'waiting'

function SetupFlow({ step1, step2, step3 }: { step1: StepState; step2: StepState; step3: StepState }) {
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
    {
      label: 'Select Libraries',
      sub: step3 === 'done' ? 'Libraries selected' : step3 === 'active' ? 'Choose below' : 'Waiting…',
      state: step3,
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [cfg, setCfg]           = useState<AppConfig | null>(null)
  const [draft, setDraft]       = useState<Partial<AppConfig>>({})
  const [saving, setSaving]     = useState(false)

  // auth
  const [authStatus, setAuthStatus] = useState<PlexAuthStatus>({ status: 'idle' })
  const [signingIn, setSigningIn]   = useState(false)

  // server
  const [testing, setTesting]         = useState(false)
  const [testMsg, setTestMsg]         = useState<{ ok: boolean; msg: string } | null>(null)
  const [serverConnected, setServerConnected] = useState(false)

  // libraries
  const [libraries, setLibraries]       = useState<Library[]>([])
  const [refreshingLibs, setRefreshLibs] = useState(false)

  const isDirty = Object.keys(draft).length > 0

  // ── Merge helper ───────────────────────────────────────────────────────────

  const merged = cfg ? { ...cfg, ...draft } : null

  function patch<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadConfig = useCallback(async () => {
    const c = await window.api.config.get() as AppConfig
    setCfg(c)
    setDraft({})
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

  useEffect(() => {
    loadConfig()
    window.api.auth.getStatus().then(s => setAuthStatus(s as PlexAuthStatus))

    const off = window.api.auth.onStatusChange((s: PlexAuthStatus) => {
      setAuthStatus(s)
      if (s.status === 'authorized') {
        setSigningIn(false)
        loadConfig()
        loadLibraries()
      }
      if (s.status === 'idle') {
        setLibraries([])
        setServerConnected(false)
      }
    })
    return () => { off() }
  }, [loadConfig, loadLibraries])

  useEffect(() => {
    if (authStatus.status === 'authorized') loadLibraries()
  }, [authStatus.status, loadLibraries])

  // ── Auth ───────────────────────────────────────────────────────────────────

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
    setAuthStatus({ status: 'idle' })
    setLibraries([])
    setServerConnected(false)
  }

  // ── Test connection ────────────────────────────────────────────────────────

  async function testConnection() {
    if (!merged) return
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await window.api.plex.connect(merged.baseUrl, merged.token) as { success: boolean; serverName?: string; error?: string }
      if (res.success) {
        setTestMsg({ ok: true, msg: `Connected to "${res.serverName}"` })
        setServerConnected(true)
        await loadLibraries()
        // persist baseUrl + token from the merged draft
        await window.api.config.set({ baseUrl: merged.baseUrl })
        setDraft(d => { const n = { ...d }; delete n.baseUrl; return n })
      } else {
        setTestMsg({ ok: false, msg: res.error ?? 'Connection failed' })
      }
    } catch (err) {
      setTestMsg({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    }
    setTesting(false)
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function save() {
    if (!isDirty) return
    setSaving(true)
    await window.api.config.set(draft)
    await loadConfig()
    setSaving(false)
  }

  // ── Library toggle ─────────────────────────────────────────────────────────

  function toggleLibrary(key: string, type: 'movie' | 'show') {
    if (!merged) return
    const field = type === 'movie' ? 'movieLibraries' : 'tvLibraries'
    const current = merged[field] as string[]
    const next = current.includes(key)
      ? current.filter(k => k !== key)
      : [...current, key]
    patch(field, next)
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!merged) return (
    <div className={styles.loading}><Spinner size="md" /></div>
  )

  const connected = authStatus.status === 'authorized'
  const movieLibs = libraries.filter(l => l.type === 'movie')
  const showLibs  = libraries.filter(l => l.type === 'show')
  const libsSelected = (merged.movieLibraries.length + merged.tvLibraries.length) > 0

  // Setup flow state
  const step1: StepState = connected ? 'done' : 'active'
  const step2: StepState = serverConnected ? 'done' : connected ? 'active' : 'waiting'
  const step3: StepState = libsSelected ? 'done' : serverConnected ? 'active' : 'waiting'
  const setupDone = step1 === 'done' && step2 === 'done' && step3 === 'done'

  return (
    <div className={styles.page}>

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure your Plex connection, scraper behaviour, and library preferences.</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={saving ? <Spinner size="xs" color="current" /> : <Save size={13} />}
          onClick={save}
          disabled={!isDirty || saving}
        >
          Save Changes
        </Button>
      </div>

      {/* ── Scrollable body ────────────────────────────────────────────────── */}
      <div className={styles.body}>

        {/* ── Setup flow stepper ─────────────────────────────────────────── */}
        <AnimatePresence initial={false}>
          {!setupDone && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.28 }}
              style={{ overflow: 'hidden' }}
            >
              <SetupFlow step1={step1} step2={step2} step3={step3} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Plex account ───────────────────────────────────────────────── */}
        <Section icon={<User size={15} />} title="Plex Account" description="Authenticate with your plex.tv account to enable automatic library matching.">
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
                <>
                  <Spinner size="sm" />
                  <span className={styles.waitingText}>
                    {authStatus.status === 'waiting'
                      ? 'Waiting for authorization in browser…'
                      : 'Connecting…'}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => { window.api.auth.disconnect(); setSigningIn(false) }}>
                    Cancel
                  </Button>
                </>
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

        {/* ── Plex server ────────────────────────────────────────────────── */}
        <Section icon={<Server size={15} />} title="Plex Server" description="Local server address. Required even when signed in via plex.tv.">
          {!connected && (
            <div className={styles.authFirstNote}>
              <Info size={13} />
              <span>Sign in with Plex above first — your auth token is needed to connect to the server.</span>
            </div>
          )}
          <FieldRow label="Server URL" hint="e.g. http://localhost:32400">
            <div className={styles.inputWithAction}>
              <input
                className={styles.textInput}
                value={merged.baseUrl}
                onChange={e => patch('baseUrl', e.target.value)}
                placeholder="http://localhost:32400"
                spellCheck={false}
                disabled={!connected}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={testing ? <Spinner size="xs" color="current" /> : <RefreshCw size={12} />}
                onClick={testConnection}
                disabled={testing || !merged.baseUrl || !connected}
              >
                Connect
              </Button>
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
        </Section>

        {/* ── Libraries — only appear once server connection is established ── */}
        {serverConnected && (
          <Section
            icon={<SlidersHorizontal size={15} />}
            title="Libraries"
            description="Choose which Plex libraries to include when matching titles for poster uploads."
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
                <span>No libraries loaded — ensure your server URL is connected above.</span>
              </div>
            ) : (
              <div className={styles.libsGrid}>
                {movieLibs.length > 0 && (
                  <div className={styles.libGroup}>
                    <span className={styles.libGroupLabel}>Movies</span>
                    {movieLibs.map(lib => (
                      <Checkbox
                        key={lib.key}
                        label={lib.title}
                        checked={merged.movieLibraries.includes(lib.title)}
                        onChange={() => toggleLibrary(lib.title, 'movie')}
                      />
                    ))}
                  </div>
                )}
                {showLibs.length > 0 && (
                  <div className={styles.libGroup}>
                    <span className={styles.libGroupLabel}>TV Shows</span>
                    {showLibs.map(lib => (
                      <Checkbox
                        key={lib.key}
                        label={lib.title}
                        checked={merged.tvLibraries.includes(lib.title)}
                        onChange={() => toggleLibrary(lib.title, 'show')}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {/* ── MediUX filters ─────────────────────────────────────────────── */}
        <Section icon={<Filter size={15} />} title="MediUX Filters" description="Choose which asset types to import from MediUX sets.">
          <div className={styles.checkGroup}>
            {((['poster', 'backdrop', 'title_card'] as const)).map(type => (
              <Checkbox
                key={type}
                label={type === 'title_card' ? 'Title Cards' : type.charAt(0).toUpperCase() + type.slice(1) + 's'}
                checked={merged.mediuxFilters.includes(type)}
                onChange={checked => {
                  const next = checked
                    ? [...merged.mediuxFilters, type]
                    : merged.mediuxFilters.filter(t => t !== type)
                  patch('mediuxFilters', next)
                }}
              />
            ))}
          </div>
        </Section>

        {/* ── Scraper ────────────────────────────────────────────────────── */}
        <Section icon={<Sliders size={15} />} title="Scraper" description="Tune delays and concurrency to balance speed against detection risk.">
          <div className={styles.sliderGrid}>
            <FieldRow label="Max Workers" hint="Concurrent scrape jobs">
              <Slider
                min={1} max={8} step={1}
                value={merged.maxWorkers}
                onChange={v => patch('maxWorkers', v)}
                ticks={8}
              />
            </FieldRow>
            <FieldRow label="Request Delay" hint="Random pause between each request">
              <RangeSlider
                min={0} max={10} step={0.1}
                minVal={merged.scraperMinDelay}
                maxVal={merged.scraperMaxDelay}
                onChange={(lo, hi) => { patch('scraperMinDelay', lo); patch('scraperMaxDelay', hi) }}
                unit="s"
                ticks={6}
              />
            </FieldRow>
            <FieldRow label="Page Wait" hint="Random pause after page load">
              <RangeSlider
                min={0} max={5} step={0.1}
                minVal={merged.scraperPageWaitMin}
                maxVal={merged.scraperPageWaitMax}
                onChange={(lo, hi) => { patch('scraperPageWaitMin', lo); patch('scraperPageWaitMax', hi) }}
                unit="s"
                ticks={6}
              />
            </FieldRow>
            <FieldRow label="Batch Delay" hint="Pause between paginated pages">
              <Slider
                min={0} max={10} step={0.5}
                value={merged.scraperBatchDelay}
                onChange={v => patch('scraperBatchDelay', v)}
                unit="s"
                ticks={5}
              />
            </FieldRow>
          </div>
        </Section>

        {/* ── General ────────────────────────────────────────────────────── */}
        <Section icon={<Wrench size={15} />} title="General">
          <FieldRow label="Append Logs" hint="Add to existing log file on restart (vs. overwrite)">
            <Switch
              checked={merged.logAppend}
              onChange={v => patch('logAppend', v)}
            />
          </FieldRow>
        </Section>

      </div>
    </div>
  )
}
