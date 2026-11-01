import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import TitleBar from '../components/shell/TitleBar'
import FloatingDock from '../components/shell/FloatingDock'
import CommandPalette from '../components/shell/CommandPalette'
import StatusBar from '../components/shell/StatusBar'
import ParticleField from '../components/shell/ParticleField'
import LogDrawer from '../features/logs/LogDrawer'
import LibraryPage from '../features/library/LibraryPage'
import ManualPage from '../features/manual/ManualPage'
import SchedulerPage from '../features/scheduler/SchedulerPage'
import MappingsPage from '../features/mappings/MappingsPage'
import ResetPage from '../features/reset/ResetPage'
import SettingsPage from '../features/settings/SettingsPage'
import SetupScreen from '../features/setup/SetupScreen'
import WebSignInScreen from '../features/auth/WebSignInScreen'
import { UpdaterProvider } from '../features/updater/UpdaterContext'
import { ResetProvider } from '../features/reset/ResetContext'
import UpdateToast from '../features/updater/UpdateToast'
import { AppContext } from './AppContext'
import type { NavDockMode } from '../../electron/ipc/types'

export type NavTab = 'library' | 'scheduler' | 'mappings' | 'manual' | 'reset' | 'settings'

const NAV_ORDER: NavTab[] = ['library', 'scheduler', 'manual', 'mappings', 'reset', 'settings']

const IS_MAC = /mac/i.test(navigator.platform)

/**
 * Windows too short or narrow for the floating dock to stay clear of content.
 * Media queries measure CSS pixels after display scaling: a 1366x768 screen
 * or a 1080p one at 150% matches, while a 1080p one at 125% (about 1536x816)
 * keeps the floating dock, which already moves aside for the sets panel.
 */
const COMPACT_WINDOW_QUERY = '(max-height: 799px), (max-width: 1099px)'

/**
 * Tracks a media query.
 *
 * @param query - The media query.
 * @returns Whether it currently matches.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

const PAGE_MAP: Record<NavTab, React.ReactNode> = {
  library:   <LibraryPage />,
  scheduler: <SchedulerPage />,
  mappings:  <MappingsPage />,
  manual:    <ManualPage />,
  reset:     <ResetPage />,
  settings:  <SettingsPage />,
}

/** Root component: gates on first-run browser setup, then renders the app shell. */
export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('library')
  const [prevTab, setPrevTab] = useState<NavTab>('library')
  const [logOpen, setLogOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [plexConnected, setPlexConnected] = useState(false)
  // null = still checking, false = setup needed, true = ready
  const [browserReady, setBrowserReady] = useState<boolean | null>(null)
  // Web mode: null = checking env, then SSO gate until Plex authorizes
  const [isWeb, setIsWeb] = useState<boolean | null>(null)
  const [authReady, setAuthReady] = useState(false)
  // In Docker/VNC, skip the animated background to keep idle CPU low.
  const [reduceMotion, setReduceMotion] = useState(false)
  const [navDock, setNavDockState] = useState<NavDockMode>('auto')
  const compactWindow = useMediaQuery(COMPACT_WINDOW_QUERY)
  // Docked, the dock is a row of the status bar and covers nothing.
  const docked = navDock === 'bar' || (navDock === 'auto' && compactWindow)

  const direction = NAV_ORDER.indexOf(activeTab) > NAV_ORDER.indexOf(prevTab) ? 1 : -1

  function navigate(tab: NavTab) {
    setPrevTab(activeTab)
    setActiveTab(tab)
  }

  function setNavDock(mode: NavDockMode) {
    setNavDockState(mode)
    void window.api.config.set({ navDock: mode })
  }

  useEffect(() => {
    window.api.config.get().then(c => setNavDockState(c.navDock ?? 'auto')).catch(() => { /* keep the default */ })
  }, [authReady])

  // Pages size their bottom clearance from this (see tokens.css).
  useEffect(() => {
    document.documentElement.dataset.dock = docked ? 'bar' : 'floating'
  }, [docked])

  useEffect(() => {
    window.api.auth.getStatus().then(s => setPlexConnected(s.status === 'authorized'))
    const unsub = window.api.auth.onStatusChange(s => setPlexConnected(s.status === 'authorized'))
    return () => { unsub() }
  }, [])

  // Web vs desktop + Plex SSO gate (web only)
  useEffect(() => {
    window.api.app.getEnv().then(e => {
      const web = !!e.web
      setIsWeb(web)
      setReduceMotion(e.container || web)
      if (!web) {
        setAuthReady(true)
        return
      }
      window.api.auth.getStatus().then(s => {
        const ok = s.status === 'authorized'
        setAuthReady(ok)
        setPlexConnected(ok)
      })
    })
  }, [])

  useEffect(() => {
    if (!isWeb) return
    const off = window.api.auth.onStatusChange(s => {
      const ok = s.status === 'authorized'
      setAuthReady(ok)
      setPlexConnected(ok)
    })
    return () => { off() }
  }, [isWeb])

  // Check browser on mount - SetupScreen handles install if needed
  useEffect(() => {
    if (isWeb === false || (isWeb && authReady)) {
      window.api.browser.getStatus().then(s => setBrowserReady(s.installed))
    }
  }, [isWeb, authReady])

  // Global Ctrl/Cmd+F toggles the command palette (search).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setPaletteOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (isWeb === null) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--color-bg-base)',
        color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)',
      }}>
        Loading…
      </div>
    )
  }

  if (isWeb && !authReady) {
    return (
      <WebSignInScreen onAuthorized={() => {
        setAuthReady(true)
        setPlexConnected(true)
      }} />
    )
  }

  return (
    <AppContext.Provider value={{ navigate, plexConnected, navDock, setNavDock }}>
    <UpdaterProvider>
    <ResetProvider>
    {/* Setup gate - shown on first launch until Chromium is installed */}
    <AnimatePresence>
      {browserReady === false && (
        <SetupScreen onComplete={() => setBrowserReady(true)} />
      )}
    </AnimatePresence>
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--color-bg-base)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <ParticleField animate={!reduceMotion} />

      <TitleBar />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        <main
          style={{
            flex: 1,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={activeTab}
              custom={direction}
              initial={{ opacity: 0, x: direction * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -24 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              // A floating dock overlays content; pages fill the full height and add their
              // own bottom clearance (--dock-clearance) inside their scrollers.
              style={{ height: '100%', overflow: 'auto', padding: 'var(--content-padding)' }}
            >
              {PAGE_MAP[activeTab]}
            </motion.div>
          </AnimatePresence>
        </main>

        {!docked && (
          <FloatingDock
            activeTab={activeTab}
            logOpen={logOpen}
            onNavigate={navigate}
            onToggleLogs={() => setLogOpen(v => !v)}
            onOpenPalette={() => setPaletteOpen(true)}
            isMac={IS_MAC}
          />
        )}
      </div>

      <LogDrawer open={logOpen} onClose={() => setLogOpen(false)} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigate}
        onToggleLogs={() => setLogOpen(v => !v)}
        plexConnected={plexConnected}
        isMac={IS_MAC}
      />

      <UpdateToast />

      <StatusBar
        nav={docked ? (
          <FloatingDock
            variant="bar"
            activeTab={activeTab}
            logOpen={logOpen}
            onNavigate={navigate}
            onToggleLogs={() => setLogOpen(v => !v)}
            onOpenPalette={() => setPaletteOpen(true)}
            isMac={IS_MAC}
          />
        ) : undefined}
      />
    </div>
    </ResetProvider>
    </UpdaterProvider>
    </AppContext.Provider>
  )
}
