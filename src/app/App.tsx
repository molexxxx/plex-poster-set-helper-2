import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import TitleBar from '../components/shell/TitleBar'
import Sidebar from '../components/shell/Sidebar'
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

const PAGE_MAP: Record<NavTab, React.ReactNode> = {
  library:   <LibraryPage />,
  scheduler: <SchedulerPage />,
  mappings:  <MappingsPage />,
  manual:    <ManualPage />,
  reset:     <ResetPage />,
  settings:  <SettingsPage />,
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('library')
  const [prevTab, setPrevTab] = useState<NavTab>('library')
  const [logOpen, setLogOpen] = useState(false)
  const [plexConnected, setPlexConnected] = useState(false)
  // null = still checking, false = setup needed, true = ready
  const [browserReady, setBrowserReady] = useState<boolean | null>(null)

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
      <ParticleField />

      <TitleBar />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        <Sidebar activeTab={activeTab} onNavigate={navigate} onToggleLogs={() => setLogOpen(v => !v)} />

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
              style={{ height: '100%', overflow: 'auto', padding: 'var(--content-padding)' }}
            >
              {PAGE_MAP[activeTab]}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <LogDrawer open={logOpen} onClose={() => setLogOpen(false)} />

      <UpdateToast />

      <StatusBar />
    </div>
    </UpdaterProvider>
    </AppContext.Provider>
  )
}
