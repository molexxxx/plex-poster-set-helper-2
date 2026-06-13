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
import { UpdaterProvider } from '../features/updater/UpdaterContext'
import UpdateToast from '../features/updater/UpdateToast'
import { AppContext } from './AppContext'

export type NavTab = 'library' | 'scheduler' | 'mappings' | 'manual' | 'reset' | 'settings'

const NAV_ORDER: NavTab[] = ['library', 'scheduler', 'mappings', 'manual', 'reset', 'settings']

const IS_MAC = /mac/i.test(navigator.platform)

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
  // In Docker/VNC, skip the animated background to keep idle CPU low.
  const [reduceMotion, setReduceMotion] = useState(false)

  const direction = NAV_ORDER.indexOf(activeTab) > NAV_ORDER.indexOf(prevTab) ? 1 : -1

  function navigate(tab: NavTab) {
    setPrevTab(activeTab)
    setActiveTab(tab)
  }

  useEffect(() => {
    window.api.auth.getStatus().then(s => setPlexConnected(s.status === 'authorized'))
    const unsub = window.api.auth.onStatusChange(s => setPlexConnected(s.status === 'authorized'))
    return () => { unsub() }
  }, [])

  // Check browser on mount - SetupScreen handles install if needed
  useEffect(() => {
    window.api.browser.getStatus().then(s => setBrowserReady(s.installed))
    window.api.app.getEnv().then(e => setReduceMotion(e.container))
  }, [])

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

  return (
    <AppContext.Provider value={{ navigate, plexConnected }}>
    <UpdaterProvider>
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
              // The dock floats and overlays content; pages fill the full height and add their
              // own bottom clearance (--dock-clearance) inside their scrollers.
              style={{ height: '100%', overflow: 'auto', padding: 'var(--content-padding)' }}
            >
              {PAGE_MAP[activeTab]}
            </motion.div>
          </AnimatePresence>
        </main>

        <FloatingDock
          activeTab={activeTab}
          logOpen={logOpen}
          onNavigate={navigate}
          onToggleLogs={() => setLogOpen(v => !v)}
          onOpenPalette={() => setPaletteOpen(true)}
          isMac={IS_MAC}
        />
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

      <StatusBar />
    </div>
    </UpdaterProvider>
    </AppContext.Provider>
  )
}
